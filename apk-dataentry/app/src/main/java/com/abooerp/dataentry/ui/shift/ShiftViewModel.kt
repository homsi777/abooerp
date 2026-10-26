package com.abooerp.dataentry.ui.shift

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.abooerp.dataentry.data.AuthStorage
import com.abooerp.dataentry.data.CurrencyBalance
import com.abooerp.dataentry.data.CustodyShiftRemote
import com.abooerp.dataentry.data.LedgerQueueStorage
import com.abooerp.dataentry.data.LedgerRow
import com.abooerp.dataentry.data.LedgerRowRemote
import com.abooerp.dataentry.data.OpenCustodyShiftRequest
import com.abooerp.dataentry.data.OpeningBalanceRequest
import com.abooerp.dataentry.data.QueuedLedgerRow
import com.abooerp.dataentry.data.QueuedRowStatus
import com.abooerp.dataentry.data.Shift
import com.abooerp.dataentry.data.ShiftStatus
import com.abooerp.dataentry.data.UpsertLedgerRowRequest
import com.abooerp.dataentry.network.ApiService
import com.abooerp.dataentry.printer.BluetoothPrinterManager
import com.abooerp.dataentry.printer.NetworkPrinterManager
import com.abooerp.dataentry.printer.PrintResult
import com.abooerp.dataentry.printer.ReceiptData
import com.abooerp.dataentry.printer.ReceiptRenderer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** All tablet-originated rows share this label so office staff can spot
 * them instantly in the desktop ledger and transfer each one into the
 * real trip session once a vehicle/driver is assigned. */
const val TABLET_INTAKE_LINE_LABEL = "استلام تابلت"

/** How often the background loop retries anything still stuck PENDING. */
private const val AUTO_SYNC_INTERVAL_MS = 20_000L

sealed class SaveRowState {
    object Idle : SaveRowState()
    object Saving : SaveRowState()
    data class Error(val message: String) : SaveRowState()
}

/**
 * Offline-first: every row is written to the local queue THE INSTANT it's
 * entered (before any network call) and only then does the app try to send
 * it. If there's no signal in the yard, the row stays safely on the device
 * as PENDING and survives an app restart; a background loop and a manual
 * "sync now" both keep retrying. The one rule that must never be broken:
 * once a row is confirmed SYNCED, it is never sent again — a desk reviewer
 * may have already edited it on the office PC, and resending would
 * silently overwrite that edit.
 *
 * The shift (عهدة) is now a real server-backed custody, visible to the
 * accountant on the desktop the instant it's opened/closed — no longer
 * local-only. Ledger ROWS are separately real too: every synced row lands
 * in the same daily_ledger_rows table the desktop app uses, visible
 * immediately to office staff regardless of shift status.
 */
class ShiftViewModel(
    private val employeeName: String,
    private val apiService: ApiService,
    private val authStorage: AuthStorage,
    private val queueStorage: LedgerQueueStorage,
    private val printerManager: BluetoothPrinterManager,
    private val networkPrinterManager: NetworkPrinterManager,
) : ViewModel() {
    private val timeFormat = SimpleDateFormat("HH:mm", Locale("ar"))
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val printTimeFormat = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
    private val branchId get() = authStorage.getBranchId()
    private val userId get() = authStorage.getUserId()

    private val _printError = MutableStateFlow<String?>(null)
    val printError: StateFlow<String?> = _printError.asStateFlow()

    fun clearPrintError() {
        _printError.value = null
    }

    /** Manual reprint (e.g. from a print icon on a past row). Auto-print
     * after save uses the same underlying call — see addRow(). */
    fun reprintRow(row: LedgerRow) {
        viewModelScope.launch { printRow(row) }
    }

    private suspend fun printRow(row: LedgerRow) {
        // No printer configured yet is not an error — printing is opt-in
        // per device until every tablet has one, so we just skip silently.
        val isNetwork = authStorage.getPrinterType() == AuthStorage.PRINTER_TYPE_NETWORK
        val networkHost = if (isNetwork) authStorage.getNetworkPrinterHost() else null
        val bluetoothAddress = if (!isNetwork) authStorage.getPrinterAddress() else null
        if (isNetwork && networkHost == null) return
        if (!isNetwork && bluetoothAddress == null) return
        val data = ReceiptData(
            companyName = "شركة عبو المحمود لنقل والخدمات اللوجستية",
            branchLabel = authStorage.getBranchLabel() ?: "-",
            employeeName = employeeName,
            dateTime = printTimeFormat.format(Date()),
            receiptNo = row.receiptNo,
            destination = row.destination,
            parcelType = row.parcelType,
            parcelCount = row.parcelCount,
            weightKg = row.weightKg,
            senderName = row.senderName,
            receiverName = row.receiverName,
            collectAmount = row.collectAmount,
            hawalaAmount = row.hawalaAmount,
            hawalaFee = row.hawalaFee,
            prepaidAmount = row.prepaidAmount,
            currencyCode = row.currencyCode,
            notes = row.notes,
        )
        val bitmap = ReceiptRenderer.render(data)
        val result = if (isNetwork) {
            networkPrinterManager.printBitmap(networkHost!!, authStorage.getNetworkPrinterPort(), bitmap)
        } else {
            printerManager.printBitmap(bluetoothAddress!!, bitmap)
        }
        when (result) {
            is PrintResult.Failure -> _printError.value = result.message
            PrintResult.Success -> {}
        }
    }

    private val _shiftError = MutableStateFlow<String?>(null)
    val shiftError: StateFlow<String?> = _shiftError.asStateFlow()

    private val _shiftBusy = MutableStateFlow(false)
    val shiftBusy: StateFlow<Boolean> = _shiftBusy.asStateFlow()

    // True only while the initial (or retried) check for an existing open
    // shift is in flight — the dashboard must show a loading state here,
    // never the "no shift, open one" prompt, until this resolves.
    private val _shiftLoading = MutableStateFlow(true)
    val shiftLoading: StateFlow<Boolean> = _shiftLoading.asStateFlow()

    // True only when that check genuinely failed to reach the server —
    // distinct from a successful check that found no shift.
    private val _shiftRestoreFailed = MutableStateFlow(false)
    val shiftRestoreFailed: StateFlow<Boolean> = _shiftRestoreFailed.asStateFlow()

    // In-memory mirror of what's on disk. All mutations happen on the
    // Main dispatcher (viewModelScope's default), so plain sequential
    // reassignment here is safe — no separate locking needed.
    private var queue: List<QueuedLedgerRow> = emptyList()

    private val _shift = MutableStateFlow<Shift?>(null)
    val shift: StateFlow<Shift?> = _shift.asStateFlow()

    private val _rows = MutableStateFlow<List<LedgerRow>>(emptyList())
    val rows: StateFlow<List<LedgerRow>> = _rows.asStateFlow()

    private val _pendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    private val _saveState = MutableStateFlow<SaveRowState>(SaveRowState.Idle)
    val saveState: StateFlow<SaveRowState> = _saveState.asStateFlow()

    // Numeric agent code -> governorate name, e.g. "12" -> "القامشلي" — same
    // quick-code table the desktop ledger uses (server: /api/v1/agents).
    private val _destinationQuickCodes = MutableStateFlow<Map<String, String>>(emptyMap())
    val destinationQuickCodes: StateFlow<Map<String, String>> = _destinationQuickCodes.asStateFlow()

    init {
        viewModelScope.launch { loadDestinationQuickCodes() }
        viewModelScope.launch { bootstrapQueue() }
        viewModelScope.launch { restoreActiveShift() }
        startAutoSyncLoop()
    }

    /** Restores the shift state from the server on app start — e.g. after
     * the app was killed and reopened mid-shift — since the shift now
     * genuinely lives on the server, not only in this ViewModel's memory.
     *
     * Never trusts only the locally cached user id: an account that logged
     * in before saveUserId() existed (or on an older build) can be stuck
     * with it permanently missing/null, silently hiding every shift it
     * opens from itself forever (this is exactly what happened with the
     * "test" account — the shift was real and visible to the accountant,
     * but this screen kept showing "no open shift" because `userId ?:
     * return` bailed out before ever asking the server). auth/me is always
     * server-authoritative for "who am I", so we refresh from it first and
     * re-save it locally, self-healing the stale cache instead of just
     * failing silently again. */
    /**
     * Root design fix: a failed restore attempt must never look identical
     * to "confirmed, no shift" — that ambiguity is what caused this exact
     * bug to resurface (a transient network hiccup silently produced the
     * same "لا توجد وردية مفتوحة" screen as a genuine empty state, and
     * since this only ever ran once with no retry, the employee was stuck
     * looking at a false "open a new shift" prompt with an existing shift
     * still live and unconfirmed on the server). shiftLoading distinguishes
     * "still checking" from both outcomes, and shiftRestoreFailed is set
     * ONLY on an actual failure to talk to the server — never on a
     * successful response that legitimately contains no active shift.
     */
    private suspend fun restoreActiveShift() {
        _shiftLoading.value = true
        _shiftRestoreFailed.value = false

        var myUserId = userId
        try {
            val me = apiService.getMe()
            if (me.success && me.data != null) {
                myUserId = me.data.id
                authStorage.saveUserId(me.data.id)
            }
        } catch (_: Exception) {
            // auth/me failing isn't fatal by itself as long as a
            // previously-cached id exists to fall back on below.
        }

        if (myUserId == null) {
            _shiftRestoreFailed.value = true
            _shiftLoading.value = false
            return
        }

        try {
            val response = apiService.getCustodyShifts(null)
            if (response.success && response.data != null) {
                val mine = response.data
                    .filter { it.holderUserId == myUserId }
                    .filter { it.status == "open" || it.status == "pending_confirmation" }
                    .maxByOrNull { it.openedAt }
                // Server-confirmed either way — a null result here means a
                // real, verified "no open shift", not a guess.
                _shift.value = mine?.toShift()
            } else {
                _shiftRestoreFailed.value = true
            }
        } catch (_: Exception) {
            _shiftRestoreFailed.value = true
        } finally {
            _shiftLoading.value = false
        }
    }

    /** Manual retry for the "تعذّر التحقق من الوردية" state — same restore
     * logic, re-invoked on demand instead of leaving the employee stuck. */
    fun retryRestoreShift() {
        viewModelScope.launch { restoreActiveShift() }
    }

    private suspend fun loadDestinationQuickCodes() {
        try {
            val response = apiService.getAgents()
            if (response.success && response.data != null) {
                _destinationQuickCodes.value = response.data
                    .filter { it.isActive && it.code.all(Char::isDigit) && !it.governorate.isNullOrBlank() }
                    .associate { it.code.trimStart('0').ifEmpty { "0" } to it.governorate!!.trim() }
            }
        } catch (_: Exception) {
            // No quick codes this session is fine — plain typing still works.
        }
    }

    private fun todayIso() = dateFormat.format(Date())

    private suspend fun bootstrapQueue() {
        queue = queueStorage.loadAll()
        publishRows()
        mergeServerRows()
        syncPending()
    }

    /** Adopts any row already confirmed on the server today that this
     * device doesn't know about locally (e.g. after a reinstall) as an
     * already-SYNCED entry, so it's counted for row numbering and shown,
     * but never re-sent. */
    private suspend fun mergeServerRows() {
        val branch = branchId ?: return
        try {
            val today = todayIso()
            val response = apiService.getLedgerRows(branch, today, today, TABLET_INTAKE_LINE_LABEL)
            if (response.success && response.data != null) {
                val knownServerIds = queue.mapNotNull { it.serverId }.toSet()
                val adopted = response.data
                    .filter { it.id !in knownServerIds }
                    .map { it.toQueuedSynced(branch, today) }
                if (adopted.isNotEmpty()) {
                    queue = queue + adopted
                    publishRows()
                    persistQueue()
                }
            }
        } catch (_: Exception) {
            // Starting from just the local queue is fine if the network's down.
        }
    }

    private fun startAutoSyncLoop() {
        viewModelScope.launch {
            while (true) {
                delay(AUTO_SYNC_INTERVAL_MS)
                syncPending()
            }
        }
    }

    /** Manual "sync now" — same retry logic the background loop uses. */
    fun syncNow() {
        viewModelScope.launch { syncPending() }
    }

    private suspend fun syncPending() {
        val pendingIds = queue.filter { it.status == QueuedRowStatus.PENDING }.map { it.localId }
        for (id in pendingIds) trySyncOne(id)
    }

    fun openShift(openingUsd: Double, openingSyp: Double) {
        val branch = branchId
        val holder = userId
        if (holder == null) {
            _shiftError.value = "تعذر تحديد الموظف — سجّلي الدخول من جديد."
            return
        }
        viewModelScope.launch {
            _shiftBusy.value = true
            try {
                val response = apiService.openCustodyShift(
                    OpenCustodyShiftRequest(
                        branchId = branch,
                        holderUserId = holder,
                        holderLabel = employeeName,
                        openingBalances = listOf(
                            OpeningBalanceRequest("USD", openingUsd),
                            OpeningBalanceRequest("SYP", openingSyp),
                        ),
                    ),
                )
                if (response.success && response.data != null) {
                    _shift.value = response.data.toShift()
                } else {
                    _shiftError.value = response.error ?: "تعذر فتح العهدة"
                }
            } catch (e: retrofit2.HttpException) {
                _shiftError.value = if (e.code() == 409) {
                    "لديك عهدة سابقة لم تُؤكَّد من المحاسب بعد — لا يمكن فتح عهدة جديدة حتى يُؤكِّدها."
                } else {
                    val body = e.response()?.errorBody()?.string()
                    "خطأ من الخادم (${e.code()}): ${body ?: "بدون تفاصيل"}"
                }
            } catch (e: Exception) {
                _shiftError.value = "تعذر الاتصال بالخادم: ${e.message}"
            } finally {
                _shiftBusy.value = false
            }
        }
    }

    fun clearShiftError() {
        _shiftError.value = null
    }

    fun addRow(
        parcelType: String,
        parcelCount: Int,
        weightKg: Double,
        collectAmount: Double,
        hawalaAmount: Double,
        hawalaFee: Double,
        prepaidAmount: Double,
        senderName: String,
        receiverName: String,
        destination: String,
        receiptNo: String,
        notes: String,
        currencyCode: String,
    ) {
        val branch = branchId
        if (branch == null) {
            _saveState.value = SaveRowState.Error("تعذر تحديد الفرع — سجّلي الدخول من جديد.")
            return
        }
        viewModelScope.launch {
            // The real ledger only has USD amount columns. A SYP row is
            // still queued/saved (and still visible instantly once synced)
            // but its amounts go into the notes as text instead of being
            // silently mis-recorded as USD — needs a real conversion rule
            // agreed with the manager before this becomes automatic.
            val isUsd = currencyCode == "USD"
            val combinedNotes = buildString {
                if (notes.isNotBlank()) append(notes)
                if (!isUsd) {
                    if (isNotEmpty()) append(" — ")
                    append("مبلغ بالليرة السورية: تحصيل ${collectAmount.trimmed()} / حوالة ${hawalaAmount.trimmed()} / أجرة حوالة ${hawalaFee.trimmed()} / دفع مسبق ${prepaidAmount.trimmed()}")
                }
            }

            val nextRowNo = (queue.maxOfOrNull { it.request.rowNo } ?: 0) + 1
            val request = UpsertLedgerRowRequest(
                branchId = branch,
                ledgerDate = todayIso(),
                lineLabel = TABLET_INTAKE_LINE_LABEL,
                rowNo = nextRowNo,
                receiptNo = receiptNo.ifBlank { null },
                destination = destination,
                parcelType = parcelType,
                parcelCount = parcelCount.takeIf { it > 0 },
                weightKg = weightKg.takeIf { it > 0 },
                senderName = senderName,
                receiverName = receiverName,
                collectAmountUsd = if (isUsd) collectAmount else 0.0,
                prepaidAmountUsd = if (isUsd) prepaidAmount else 0.0,
                hawalaAmountUsd = if (isUsd) hawalaAmount else 0.0,
                transferServiceFeeUsd = if (isUsd) hawalaFee else 0.0,
                notes = combinedNotes.ifBlank { null },
            )

            // Written to the local queue BEFORE any network call — this is
            // the whole point of offline-first: the row is never lost, even
            // if the app crashes right after this line, with no signal.
            val queuedRow = QueuedLedgerRow(localId = UUID.randomUUID().toString(), request = request, status = QueuedRowStatus.PENDING)
            queue = queue + queuedRow
            publishRows()
            persistQueue()

            // The employee is physically holding this cash right now
            // regardless of whether the network call below succeeds —
            // provisional until real accounting sign-off on this rule.
            val cashHandled = collectAmount + hawalaAmount + hawalaFee
            _shift.value = _shift.value?.let { current ->
                val updatedBalances = current.balances.map {
                    if (it.currencyCode == currencyCode) it.copy(amount = it.amount + cashHandled) else it
                }
                current.copy(balances = updatedBalances, rowCount = queue.size)
            }

            // Printed from the local queue immediately — the sender is
            // physically standing there waiting for their receipt, so this
            // must not wait on network sync (which can lag or retry).
            viewModelScope.launch { printRow(queuedRow.toLedgerRow()) }

            trySyncOne(queuedRow.localId)
        }
    }

    private suspend fun trySyncOne(localId: String) {
        val row = queue.find { it.localId == localId && it.status == QueuedRowStatus.PENDING } ?: return
        _saveState.value = SaveRowState.Saving
        try {
            val response = apiService.upsertLedgerRow(row.request)
            if (response.success && response.data != null) {
                markSynced(localId, response.data)
                _saveState.value = SaveRowState.Idle
            } else {
                markFailed(localId, response.error ?: "رفض الخادم حفظ السطر")
            }
        } catch (e: retrofit2.HttpException) {
            // A real rejection (bad data, duplicate, etc.) — retrying won't
            // help, so this needs the employee's attention, not the queue.
            val body = e.response()?.errorBody()?.string()
            markFailed(localId, "خطأ من الخادم (${e.code()}): ${body ?: "بدون تفاصيل"}")
        } catch (e: Exception) {
            // No signal / timeout — leave it PENDING, the loop will retry.
            // Not shown as an error: this is expected and not the
            // employee's problem to solve.
            _saveState.value = SaveRowState.Idle
        }
    }

    private suspend fun markSynced(localId: String, remote: LedgerRowRemote) {
        queue = queue.map {
            if (it.localId == localId) it.copy(status = QueuedRowStatus.SYNCED, serverId = remote.id, serverCreatedAt = remote.createdAt, lastError = null)
            else it
        }
        publishRows()
        persistQueue()
    }

    private suspend fun markFailed(localId: String, error: String) {
        queue = queue.map {
            if (it.localId == localId) it.copy(status = QueuedRowStatus.FAILED, lastError = error)
            else it
        }
        publishRows()
        persistQueue()
        _saveState.value = SaveRowState.Error(error)
    }

    private fun publishRows() {
        _rows.value = queue.map { it.toLedgerRow() }.sortedBy { it.rowNo }
        _pendingCount.value = queue.count { it.status != QueuedRowStatus.SYNCED }
    }

    private suspend fun persistQueue() {
        queueStorage.saveAll(queue)
    }

    fun clearSaveError() {
        if (_saveState.value is SaveRowState.Error) _saveState.value = SaveRowState.Idle
    }

    fun closeShift() {
        val current = _shift.value ?: return
        viewModelScope.launch {
            _shiftBusy.value = true
            try {
                val response = apiService.closeCustodyShift(current.id)
                if (response.success && response.data != null) {
                    _shift.value = response.data.toShift()
                } else {
                    _shiftError.value = response.error ?: "تعذر إغلاق العهدة"
                }
            } catch (e: Exception) {
                _shiftError.value = "تعذر الاتصال بالخادم: ${e.message}"
            } finally {
                _shiftBusy.value = false
            }
        }
    }

    private fun CustodyShiftRemote.toShift(): Shift {
        val status = when (this.status) {
            "open" -> ShiftStatus.OPEN
            "pending_confirmation" -> ShiftStatus.PENDING_CONFIRMATION
            "confirmed" -> ShiftStatus.CONFIRMED
            "rejected" -> ShiftStatus.REJECTED
            else -> ShiftStatus.NONE
        }
        val currentBalances = balances.map { CurrencyBalance(it.currencyCode, it.currentAmount?.toDoubleOrNull() ?: 0.0) }
        val opening = balances.map { CurrencyBalance(it.currencyCode, it.openingAmount?.toDoubleOrNull() ?: 0.0) }
        return Shift(
            id = id,
            employeeName = employeeName,
            status = status,
            openedAt = openedAt.takeLast(8).take(5),
            closedAt = closedAt?.takeLast(8)?.take(5),
            openingBalances = opening,
            balances = currentBalances,
            rowCount = queue.size,
            rejectionReason = rejectionReason,
        )
    }

    private fun QueuedLedgerRow.toLedgerRow() = LedgerRow(
        id = serverId ?: localId,
        rowNo = request.rowNo,
        parcelType = request.parcelType ?: "",
        parcelCount = request.parcelCount ?: 0,
        weightKg = request.weightKg ?: 0.0,
        collectAmount = request.collectAmountUsd ?: 0.0,
        hawalaAmount = request.hawalaAmountUsd ?: 0.0,
        hawalaFee = request.transferServiceFeeUsd ?: 0.0,
        prepaidAmount = request.prepaidAmountUsd ?: 0.0,
        senderName = request.senderName ?: "",
        receiverName = request.receiverName ?: "",
        destination = request.destination ?: "",
        receiptNo = request.receiptNo ?: request.rowNo.toString(),
        notes = request.notes ?: "",
        currencyCode = "USD",
        createdAt = serverCreatedAt?.takeLast(8)?.take(5) ?: "",
        syncStatus = status,
    )

    private fun LedgerRowRemote.toQueuedSynced(branch: String, today: String) = QueuedLedgerRow(
        localId = id,
        serverId = id,
        serverCreatedAt = createdAt,
        status = QueuedRowStatus.SYNCED,
        request = UpsertLedgerRowRequest(
            branchId = branch,
            ledgerDate = today,
            lineLabel = TABLET_INTAKE_LINE_LABEL,
            rowNo = rowNo,
            receiptNo = receiptNo,
            destination = destination,
            parcelType = parcelType,
            parcelCount = parcelCount,
            weightKg = weightKg?.toDoubleOrNull(),
            senderName = senderName,
            receiverName = receiverName,
            collectAmountUsd = collectAmountUsd?.toDoubleOrNull(),
            prepaidAmountUsd = prepaidAmountUsd?.toDoubleOrNull(),
            hawalaAmountUsd = hawalaAmountUsd?.toDoubleOrNull(),
            transferServiceFeeUsd = transferServiceFeeUsd?.toDoubleOrNull(),
            notes = notes,
        ),
    )

    private fun Double.trimmed(): String {
        val rounded = "%.2f".format(this).trimEnd('0').trimEnd('.')
        return rounded.ifEmpty { "0" }
    }

    class Factory(
        private val employeeName: String,
        private val apiService: ApiService,
        private val authStorage: AuthStorage,
        private val queueStorage: LedgerQueueStorage,
        private val printerManager: BluetoothPrinterManager,
        private val networkPrinterManager: NetworkPrinterManager,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            ShiftViewModel(employeeName, apiService, authStorage, queueStorage, printerManager, networkPrinterManager) as T
    }
}
