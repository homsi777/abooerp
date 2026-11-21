package com.abooerp.dataentry.ui.history

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.abooerp.dataentry.data.AuthStorage
import com.abooerp.dataentry.data.LedgerRowRemote
import com.abooerp.dataentry.network.ApiService
import com.abooerp.dataentry.ui.shift.TABLET_INTAKE_LINE_LABEL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * Browses past tablet-entered rows by date — reads the same real
 * /daily-ledger/rows endpoint the desktop app uses, filtered to this
 * device's fixed lineLabel so it only shows what this app itself entered.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShipmentHistoryScreen(
    apiService: ApiService,
    authStorage: AuthStorage,
    queueStorage: com.abooerp.dataentry.data.LedgerQueueStorage,
    onBack: () -> Unit,
    onLogout: () -> Unit = {},
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    // The manager account sees every employee's rows; it picks one (or all)
    // from the chips below and exports that selection as an A4 PDF.
    val isManager = remember { authStorage.isManager() }
    var selectedUserId by remember { mutableStateOf<String?>(null) }
    var shareMessage by remember { mutableStateOf<String?>(null) }
    // 0 = what this branch entered, 1 = incoming rows whose destination is
    // this branch's city (read-only; the server decides what qualifies).
    var tab by remember { mutableIntStateOf(0) }
    val incoming = tab == 1
    val dateFormat = remember { SimpleDateFormat("yyyy-MM-dd", Locale.US) }
    var selectedDateMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    var showDatePicker by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var rows by remember { mutableStateOf<List<LedgerRowRemote>>(emptyList()) }
    // The server has no phone columns, so the phones typed on this device
    // live only in the local queue; look them up by server id for display.
    var phonesById by remember { mutableStateOf<Map<String, Pair<String, String>>>(emptyMap()) }
    val scope = rememberCoroutineScope()

    // Employees who entered rows in the loaded day, with row counts.
    val entryUsers = remember(rows) {
        rows.groupBy { it.createdBy ?: "?" }
            .map { (id, list) -> Triple(id, list.firstNotNullOfOrNull { it.createdByName } ?: "غير معروف", list.size) }
            .sortedBy { it.second }
    }
    val visibleRows = remember(rows, selectedUserId) {
        if (selectedUserId == null) rows else rows.filter { (it.createdBy ?: "?") == selectedUserId }
    }

    fun load() {
        val branchId = authStorage.getBranchId()
        if (branchId == null) {
            errorMessage = "تعذر تحديد الفرع"
            return
        }
        val dateIso = dateFormat.format(Date(selectedDateMillis))
        scope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = if (incoming) {
                    // Other branches may have entered through the desktop
                    // ledger, so no tablet line-label filter here.
                    apiService.getLedgerRows(branchId, dateIso, dateIso, null, 500, "incoming")
                } else {
                    apiService.getLedgerRows(branchId, dateIso, dateIso, TABLET_INTAKE_LINE_LABEL)
                }
                if (response.success && response.data != null) {
                    rows = response.data.sortedByDescending { it.rowNo }
                    selectedUserId = null
                    phonesById = queueStorage.loadAll()
                        .filter { it.serverId != null && (it.senderPhone.isNotBlank() || it.receiverPhone.isNotBlank()) }
                        .associate { it.serverId!! to (it.senderPhone to it.receiverPhone) }
                } else {
                    errorMessage = response.error ?: "تعذر جلب السجلات"
                }
            } catch (e: Exception) {
                errorMessage = "تعذر الاتصال بالخادم: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("سجلات شحنات") },
                navigationIcon = {
                    if (!isManager) {
                        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                    }
                },
                actions = {
                    if (isManager) {
                        IconButton(
                            enabled = visibleRows.isNotEmpty() && !incoming,
                            onClick = {
                                val employee = if (selectedUserId == null) "كل الموظفين"
                                else visibleRows.firstNotNullOfOrNull { it.createdByName } ?: "موظف"
                                val result = com.abooerp.dataentry.printer.ManagerReportPdf.shareAsPdf(
                                    context = context,
                                    companyName = com.abooerp.dataentry.ui.shift.ShiftViewModel.COMPANY_NAME,
                                    branchLabel = authStorage.getBranchLabel() ?: "-",
                                    employeeName = employee,
                                    dateIso = dateFormat.format(Date(selectedDateMillis)),
                                    rows = visibleRows,
                                )
                                if (result is com.abooerp.dataentry.printer.ManagerReportPdf.Result.Failure) {
                                    shareMessage = result.message
                                }
                            },
                        ) { Icon(Icons.Default.PictureAsPdf, contentDescription = "تصدير PDF / مشاركة واتساب") }
                        IconButton(onClick = onLogout) {
                            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "تسجيل الخروج")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(onClick = { showDatePicker = true }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.CalendarMonth, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(dateFormat.format(Date(selectedDateMillis)))
                }
                Button(onClick = { load() }) { Text("تحديث") }
            }

            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { if (tab != 0) { tab = 0; load() } }, text = { Text("الصادرة (من فرعي)") })
                Tab(selected = tab == 1, onClick = { if (tab != 1) { tab = 1; load() } }, text = { Text("الواردة إلى فرعي") })
            }
            if (isManager && !incoming && rows.isNotEmpty()) {
                androidx.compose.foundation.lazy.LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        FilterChip(
                            selected = selectedUserId == null,
                            onClick = { selectedUserId = null },
                            label = { Text("الكل (${rows.size})") },
                        )
                    }
                    items(entryUsers, key = { it.first }) { (id, name, count) ->
                        FilterChip(
                            selected = selectedUserId == id,
                            onClick = { selectedUserId = id },
                            label = { Text("$name ($count)") },
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
            }

            when {
                isLoading -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                errorMessage != null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text(errorMessage!!, color = MaterialTheme.colorScheme.error)
                }
                rows.isEmpty() -> Column(
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(Icons.Default.Inventory2, contentDescription = null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.outline)
                    Spacer(Modifier.height(10.dp))
                    Text(if (incoming) "لا توجد شحنات واردة إلى فرعك في هذا التاريخ" else "لا توجد سجلات في هذا التاريخ", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> LazyColumn {
                    item {
                        Text(
                            "${visibleRows.size} سطر",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                    items(visibleRows, key = { it.id }) { row -> HistoryRowLine(row, phonesById[row.id], showSourceBranch = incoming) }
                }
            }
        }
    }

    shareMessage?.let { message ->
        AlertDialog(
            onDismissRequest = { shareMessage = null },
            confirmButton = { TextButton(onClick = { shareMessage = null }) { Text("حسناً") } },
            text = { Text(message) },
        )
    }

    if (showDatePicker) {
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = selectedDateMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { selectedDateMillis = it }
                    showDatePicker = false
                    load()
                }) { Text("تم") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("إلغاء") } },
        ) {
            DatePicker(state = pickerState)
        }
    }
}

@Composable
private fun HistoryRowLine(row: LedgerRowRemote, phones: Pair<String, String>?, showSourceBranch: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("${row.destination ?: "-"} — ${row.parcelType ?: "-"}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            Text(
                "${row.senderName ?: "-"} → ${row.receiverName ?: "-"}   #${row.receiptNo ?: row.rowNo}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (showSourceBranch && !row.sourceBranchName.isNullOrBlank()) {
                Text(
                    "من فرع: ${row.sourceBranchName}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (phones != null) {
                Text(
                    "${phones.first.ifBlank { "-" }} → ${phones.second.ifBlank { "-" }}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            val total = (row.collectAmountUsd?.toDoubleOrNull() ?: 0.0) +
                (row.hawalaAmountUsd?.toDoubleOrNull() ?: 0.0) +
                (row.transferServiceFeeUsd?.toDoubleOrNull() ?: 0.0)
            Text("${amountText(total)} USD", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            Text(row.createdAt?.takeLast(8)?.take(5) ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    HorizontalDivider()
}

private fun amountText(amount: Double): String {
    val rounded = "%.2f".format(amount).trimEnd('0').trimEnd('.')
    return if (rounded.isEmpty()) "0" else rounded
}
