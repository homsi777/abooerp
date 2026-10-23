package com.abooerp.dataentry.ui.ledger

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.abooerp.dataentry.data.LedgerRow
import com.abooerp.dataentry.data.QueuedRowStatus
import com.abooerp.dataentry.ui.shift.SaveRowState
import com.abooerp.dataentry.ui.shift.ShiftViewModel

/**
 * ~250 rows per shift means a per-row full-screen form is far too slow.
 * This mirrors the desktop's dense inline-editable ledger table instead:
 * one persistent entry strip (never closes), IME "next" chains straight
 * through the fields in the exact same order as ShipmentQuickLedger.tsx,
 * and goods type + destination carry over to the next row since
 * consecutive shipments are very often the same route.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LedgerEntryScreen(
    viewModel: ShiftViewModel,
    onBack: () -> Unit,
    onOpenPrinterSettings: () -> Unit,
) {
    val rows by viewModel.rows.collectAsStateWithLifecycle()
    val quickCodes by viewModel.destinationQuickCodes.collectAsStateWithLifecycle()
    val saveState by viewModel.saveState.collectAsStateWithLifecycle()
    val pendingCount by viewModel.pendingCount.collectAsStateWithLifecycle()
    val printError by viewModel.printError.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(saveState) {
        val state = saveState
        if (state is SaveRowState.Error) {
            snackbarHostState.showSnackbar(state.message)
            viewModel.clearSaveError()
        }
    }

    LaunchedEffect(printError) {
        printError?.let {
            snackbarHostState.showSnackbar("تعذرت الطباعة: $it")
            viewModel.clearPrintError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("دفتر الشحن اليومي") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
                actions = {
                    if (pendingCount > 0) {
                        TextButton(onClick = { viewModel.syncNow() }) {
                            Icon(Icons.Default.CloudSync, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("$pendingCount بانتظار الإرسال")
                        }
                    }
                    if (saveState is SaveRowState.Saving) {
                        CircularProgressIndicator(modifier = Modifier.size(22.dp).padding(end = 12.dp), strokeWidth = 2.dp)
                    }
                    IconButton(onClick = onOpenPrinterSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "إعدادات الطابعة")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        // Single scrollable list for the whole screen (strip + rows together)
        // with imePadding, so the keyboard never traps fields lower in the
        // entry strip — the same bug fixed on the login screen earlier.
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding(),
        ) {
            item {
                QuickEntryStrip(
                    destinationQuickCodes = quickCodes,
                    onSave = { r ->
                    viewModel.addRow(
                        parcelType = r.parcelType, parcelCount = r.parcelCount, weightKg = r.weightKg,
                        collectAmount = r.collectAmount, hawalaAmount = r.hawalaAmount, hawalaFee = r.hawalaFee,
                        prepaidAmount = r.prepaidAmount, senderName = r.senderName, receiverName = r.receiverName,
                        destination = r.destination, receiptNo = r.receiptNo, notes = r.notes, currencyCode = r.currencyCode,
                    )
                })
                HorizontalDivider()
            }

            if (rows.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(Icons.Default.Inventory2, contentDescription = null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.outline)
                        Spacer(Modifier.height(10.dp))
                        Text("لا توجد سطور مُدخلة بعد", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                item {
                    Text(
                        "${rows.size} سطر مُدخل",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                items(rows.reversed(), key = { it.id }) { row -> CompactRowLine(row, onReprint = { viewModel.reprintRow(row) }) }
            }
        }
    }
}

private data class NewRowInput(
    val parcelType: String, val parcelCount: Int, val weightKg: Double,
    val collectAmount: Double, val hawalaAmount: Double, val hawalaFee: Double, val prepaidAmount: Double,
    val senderName: String, val receiverName: String, val destination: String,
    val receiptNo: String, val notes: String, val currencyCode: String,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickEntryStrip(destinationQuickCodes: Map<String, String>, onSave: (NewRowInput) -> Unit) {
    val focusManager = LocalFocusManager.current
    val firstFieldFocus = remember { FocusRequester() }

    var parcelType by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }

    var parcelCount by remember { mutableStateOf("") }
    var weightKg by remember { mutableStateOf("") }
    var collectAmount by remember { mutableStateOf("") }
    var hawalaAmount by remember { mutableStateOf("") }
    var hawalaFee by remember { mutableStateOf("") }
    var prepaidAmount by remember { mutableStateOf("") }
    var sender by remember { mutableStateOf("") }
    var receiver by remember { mutableStateOf("") }
    var receiptNo by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var currency by remember { mutableStateOf("USD") }
    var expanded by remember { mutableStateOf(true) }

    fun save() {
        onSave(
            NewRowInput(
                parcelType = parcelType.trim(), parcelCount = parcelCount.toIntOrNull() ?: 0,
                weightKg = weightKg.toDoubleOrNull() ?: 0.0, collectAmount = collectAmount.toDoubleOrNull() ?: 0.0,
                hawalaAmount = hawalaAmount.toDoubleOrNull() ?: 0.0, hawalaFee = hawalaFee.toDoubleOrNull() ?: 0.0,
                prepaidAmount = prepaidAmount.toDoubleOrNull() ?: 0.0, senderName = sender.trim(),
                receiverName = receiver.trim(), destination = destination.trim(), receiptNo = receiptNo.trim(),
                notes = notes.trim(), currencyCode = currency,
            ),
        )
        // Reset every field — a saved row's data must never linger into the
        // next one (previously goods type + destination carried over, which
        // read as a bug: the field looked pre-filled with the old shipment's
        // data instead of empty and ready for new data).
        parcelType = ""; destination = ""
        parcelCount = ""; weightKg = ""; collectAmount = ""; hawalaAmount = ""; hawalaFee = ""
        prepaidAmount = ""; sender = ""; receiver = ""; receiptNo = ""; notes = ""
        firstFieldFocus.requestFocus()
    }

    val valid = destination.isNotBlank() && (parcelCount.toIntOrNull() ?: 0) > 0

    ElevatedCard(
        modifier = Modifier.fillMaxWidth().padding(12.dp),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("سطر جديد", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "طي" else "إظهار") }
            }

            if (expanded) {
                NextField(
                    value = destination,
                    // Typing a numeric agent quick-code (e.g. "12") resolves
                    // it to the governorate instantly — same lookup table the
                    // desktop ledger uses.
                    onValueChange = { typed -> destination = destinationQuickCodes[typed] ?: typed },
                    label = "الجهة",
                    focusRequester = firstFieldFocus,
                    focusManager = focusManager,
                )
                NextField(parcelType, { parcelType = it }, "نوع البضاعة", null, focusManager)

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NextField(parcelCount, { parcelCount = it.filter(Char::isDigit) }, "عدد الطرود", null, focusManager, Modifier.weight(1f), KeyboardType.Number)
                    NextField(weightKg, { weightKg = it }, "الوزن كغ", null, focusManager, Modifier.weight(1f), KeyboardType.Decimal)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("العملة", style = MaterialTheme.typography.labelSmall)
                        Row {
                            CurrencyToggle("USD", currency == "USD") { currency = "USD" }
                            Spacer(Modifier.width(6.dp))
                            CurrencyToggle("SYP", currency == "SYP") { currency = "SYP" }
                        }
                    }
                    NextField(collectAmount, { collectAmount = it }, "تحصيل", null, focusManager, Modifier.weight(1f), KeyboardType.Decimal)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NextField(hawalaAmount, { hawalaAmount = it }, "حوالة", null, focusManager, Modifier.weight(1f), KeyboardType.Decimal)
                    NextField(hawalaFee, { hawalaFee = it }, "أجرة الحوالة", null, focusManager, Modifier.weight(1f), KeyboardType.Decimal)
                }
                NextField(prepaidAmount, { prepaidAmount = it }, "دفع مسبق", null, focusManager, Modifier.fillMaxWidth(), KeyboardType.Decimal)

                NextField(sender, { sender = it }, "المرسل", null, focusManager)
                NextField(receiver, { receiver = it }, "المرسل إليه", null, focusManager)
                NextField(receiptNo, { receiptNo = it.filter(Char::isDigit) }, "رقم الإيصال (اختياري)", null, focusManager, keyboardType = KeyboardType.Number)

                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات (اختياري)") },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { if (valid) save() }),
                )

                Button(
                    onClick = ::save,
                    enabled = valid,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Icon(Icons.Default.Check, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("حفظ وسطر جديد", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun NextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    focusRequester: FocusRequester?,
    focusManager: FocusManager,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    var fieldModifier = modifier.fillMaxWidth()
    if (focusRequester != null) fieldModifier = fieldModifier.focusRequester(focusRequester)
    // Some IMEs (common on numeric keypads, third-party Xiaomi/Sogou-style
    // keyboards) send a plain Enter keystroke instead of the semantic "next"
    // action, which KeyboardActions.onNext alone won't catch. Handle the raw
    // key too so "next field" always works regardless of keyboard/type.
    fieldModifier = fieldModifier.onPreviewKeyEvent { event ->
        if (event.type == KeyEventType.KeyDown && (event.key == Key.Enter || event.key == Key.NumPadEnter)) {
            focusManager.moveFocus(FocusDirection.Next)
            true
        } else {
            false
        }
    }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = fieldModifier,
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next, keyboardType = keyboardType),
        keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Next) }),
    )
}

@Composable
private fun CurrencyToggle(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .background(
                if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(50),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun CompactRowLine(row: LedgerRow, onReprint: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("${row.destination} — ${row.parcelType}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            Text(
                "${row.senderName} → ${row.receiverName}   #${row.receiptNo}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(horizontalAlignment = Alignment.End) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${amountText(row.collectAmount + row.hawalaAmount + row.hawalaFee)} ${row.currencyCode}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    SyncStatusIcon(row.syncStatus)
                }
                Text(row.createdAt, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onReprint, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Print, contentDescription = "إعادة طباعة الإيصال", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    HorizontalDivider()
}

@Composable
private fun SyncStatusIcon(status: QueuedRowStatus) {
    when (status) {
        QueuedRowStatus.SYNCED -> Icon(Icons.Default.CloudDone, contentDescription = "تمت المزامنة", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
        QueuedRowStatus.PENDING -> Icon(Icons.Default.CloudOff, contentDescription = "بانتظار الإرسال", tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(16.dp))
        QueuedRowStatus.FAILED -> Icon(Icons.Default.ErrorOutline, contentDescription = "فشل الإرسال", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
    }
}

private fun amountText(amount: Double): String {
    val rounded = "%.2f".format(amount).trimEnd('0').trimEnd('.')
    return if (rounded.isEmpty()) "0" else rounded
}
