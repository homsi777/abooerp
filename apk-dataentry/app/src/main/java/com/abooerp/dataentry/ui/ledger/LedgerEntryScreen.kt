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
import com.abooerp.dataentry.data.toWesternDigits
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
    val nextReceiptNo by viewModel.nextReceiptNo.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    // Hoisted out of the entry card so the currency pills can sit at the top
    // of the page. The rate belongs to ONE shipment, not to the day: it
    // moves too fast here to reuse, so it is asked for every time pounds are
    // chosen (pre-filled with the last one merely to save typing) and the
    // currency drops back to USD after each save.
    var currency by remember { mutableStateOf("USD") }
    var exchangeRate by remember { mutableStateOf(0.0) }
    var lastRateText by remember { mutableStateOf("") }
    var askingRate by remember { mutableStateOf(false) }
    var showRecords by remember { mutableStateOf(false) }

    if (showRecords) {
        TodayRecordsSheet(
            rows = rows,
            onReprint = { viewModel.reprintRow(it) },
            onDismiss = { showRecords = false },
        )
    }

    if (askingRate) {
        ExchangeRateDialog(
            initialText = lastRateText,
            onConfirm = { rate, text ->
                exchangeRate = rate
                lastRateText = text
                currency = "SYP"
                askingRate = false
            },
            onDismiss = {
                askingRate = false
                if (exchangeRate <= 0.0) currency = "USD"
            },
        )
    }

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
                    TextButton(onClick = { showRecords = true }) {
                        Icon(Icons.Default.Inventory2, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("سجلات (${rows.size})")
                    }
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
                CurrencyBar(
                    currency = currency,
                    exchangeRate = exchangeRate,
                    onPickUsd = { currency = "USD"; exchangeRate = 0.0 },
                    onPickSyp = { askingRate = true },
                )
            }

            // Saved rows deliberately do NOT live on this screen: a working
            // day runs past 250 of them, which buried the fields the
            // employee is actually typing into. They open on demand from
            // the "سجلات" button in the top bar instead.
            item {
                QuickEntryStrip(
                    destinationQuickCodes = quickCodes,
                    currency = currency,
                    exchangeRate = exchangeRate,
                    nextReceiptNo = nextReceiptNo,
                    onSave = { r ->
                        viewModel.addRow(
                            parcelType = r.parcelType, parcelCount = r.parcelCount, weightKg = r.weightKg,
                            collectAmount = r.collectAmount, hawalaAmount = r.hawalaAmount, hawalaFee = r.hawalaFee,
                            prepaidAmount = r.prepaidAmount, senderName = r.senderName, senderPhone = r.senderPhone,
                            receiverName = r.receiverName, receiverPhone = r.receiverPhone,
                            destination = r.destination, notes = r.notes,
                            currencyCode = r.currencyCode, exchangeRate = r.exchangeRate,
                        )
                        // A rate belongs to the customer standing there, not
                        // to the next one — never carry it over silently.
                        currency = "USD"
                        exchangeRate = 0.0
                    },
                )
            }
        }
    }
}

private data class NewRowInput(
    val parcelType: String, val parcelCount: Int, val weightKg: Double,
    val collectAmount: Double, val hawalaAmount: Double, val hawalaFee: Double, val prepaidAmount: Double,
    val senderName: String, val senderPhone: String, val receiverName: String, val receiverPhone: String,
    val destination: String, val notes: String, val currencyCode: String,
    val exchangeRate: Double,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickEntryStrip(
    destinationQuickCodes: Map<String, String>,
    currency: String,
    exchangeRate: Double,
    nextReceiptNo: Long?,
    onSave: (NewRowInput) -> Unit,
) {
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
    var senderPhone by remember { mutableStateOf("") }
    var receiver by remember { mutableStateOf("") }
    var receiverPhone by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(true) }

    fun save() {
        onSave(
            NewRowInput(
                parcelType = parcelType.trim(), parcelCount = parcelCount.toIntOrNull() ?: 0,
                weightKg = weightKg.toDoubleOrNull() ?: 0.0, collectAmount = collectAmount.toDoubleOrNull() ?: 0.0,
                hawalaAmount = hawalaAmount.toDoubleOrNull() ?: 0.0, hawalaFee = hawalaFee.toDoubleOrNull() ?: 0.0,
                prepaidAmount = prepaidAmount.toDoubleOrNull() ?: 0.0, senderName = sender.trim(),
                senderPhone = senderPhone.trim(), receiverName = receiver.trim(), receiverPhone = receiverPhone.trim(),
                destination = destination.trim(), 
                notes = notes.trim(), currencyCode = currency, exchangeRate = exchangeRate,
            ),
        )
        // Reset every field — a saved row's data must never linger into the
        // next one (previously goods type + destination carried over, which
        // read as a bug: the field looked pre-filled with the old shipment's
        // data instead of empty and ready for new data).
        parcelType = ""; destination = ""
        parcelCount = ""; weightKg = ""; collectAmount = ""; hawalaAmount = ""; hawalaFee = ""
        prepaidAmount = ""; sender = ""; senderPhone = ""; receiver = ""; receiverPhone = ""
        notes = ""
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
                // Field order and the pairing of fields onto shared rows are
                // the manager's, not a layout convenience — keep them as-is
                // unless he asks for a change.
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NextField(sender, { sender = it }, "المرسل", firstFieldFocus, focusManager, Modifier.weight(1.4f))
                    NextField(senderPhone, { senderPhone = toWesternDigits(it) }, "رقم الهاتف", null, focusManager, Modifier.weight(1f), KeyboardType.Phone)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NextField(receiver, { receiver = it }, "المرسل إليه", null, focusManager, Modifier.weight(1.4f))
                    NextField(receiverPhone, { receiverPhone = toWesternDigits(it) }, "رقم الهاتف", null, focusManager, Modifier.weight(1f), KeyboardType.Phone)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NextField(
                        value = destination,
                        // Typing a numeric agent quick-code (e.g. "12")
                        // resolves it to the governorate instantly — same
                        // lookup table the desktop ledger uses.
                        onValueChange = { typed -> destination = destinationQuickCodes[typed] ?: typed },
                        label = "الوجهة",
                        focusRequester = null,
                        focusManager = focusManager,
                        modifier = Modifier.weight(1.4f),
                    )
                    // Read-only: the number is issued by the server's shared
                    // sequence so it can never repeat, which is what makes
                    // the QR on the label safe to scan.
                    OutlinedTextField(
                        value = nextReceiptNo?.toString() ?: "—",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("رقم الإيصال") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }
                NextField(parcelType, { parcelType = it }, "نوع البضاعة", null, focusManager)

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NextField(parcelCount, { parcelCount = it.filter(Char::isDigit) }, "عدد الطرود", null, focusManager, Modifier.weight(1f), KeyboardType.Number)
                    NextField(weightKg, { weightKg = it }, "الوزن كغ", null, focusManager, Modifier.weight(1f), KeyboardType.Decimal)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MoneyField(collectAmount, { collectAmount = it }, "تحصيل", focusManager, exchangeRate, Modifier.weight(1f))
                    MoneyField(prepaidAmount, { prepaidAmount = it }, "دفع مسبق", focusManager, exchangeRate, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MoneyField(hawalaAmount, { hawalaAmount = it }, "حوالة", focusManager, exchangeRate, Modifier.weight(1f))
                    MoneyField(hawalaFee, { hawalaFee = it }, "أجرة الحوالة", focusManager, exchangeRate, Modifier.weight(1f))
                }

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

/** Today's saved rows, newest last so the sheet reads in the order they
 *  were entered. Kept off the entry screen itself — see the call site. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TodayRecordsSheet(
    rows: List<LedgerRow>,
    onReprint: (LedgerRow) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            Text(
                if (rows.isEmpty()) "سجلات اليوم" else "سجلات اليوم — ${rows.size} سطر",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (rows.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(Icons.Default.Inventory2, contentDescription = null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.outline)
                    Spacer(Modifier.height(10.dp))
                    Text("لا توجد سطور مُدخلة بعد", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f, fill = false)) {
                    items(rows, key = { it.id }) { row ->
                        CompactRowLine(row, onReprint = { onReprint(row) })
                    }
                }
            }
        }
    }
}

/** A money field that, when the customer is paying in pounds, shows the
 *  USD the ledger will actually record right under what was typed. */
@Composable
private fun MoneyField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    focusManager: FocusManager,
    exchangeRate: Double,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        NextField(value, { onValueChange(toWesternDigits(it)) }, label, null, focusManager, Modifier.fillMaxWidth(), KeyboardType.Decimal)
        val amount = value.toDoubleOrNull()
        if (exchangeRate > 0 && amount != null && amount > 0) {
            Text(
                "≈ ${"%.2f".format(amount / exchangeRate)} USD",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 4.dp, top = 2.dp),
            )
        }
    }
}

/** Asked for every pounds payment — the rate swings too fast in Syria to
 *  reuse an earlier one, so the previous value is only a starting point. */
@Composable
private fun ExchangeRateDialog(
    initialText: String,
    onConfirm: (Double, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(initialText) }
    val rate = text.toDoubleOrNull() ?: 0.0

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("سعر صرف الدولار", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "كم ليرة سورية مقابل 1 دولار لهذه الشحنة؟",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = toWesternDigits(it) },
                    label = { Text("سعر الصرف") },
                    placeholder = { Text("مثال: 13000") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "يُحفظ المبلغ في النظام بالدولار، ويُطبع على الإيصال بالليرة والدولار معاً.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(rate, text) }, enabled = rate > 0) { Text("حفظ") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

/** Currency sits at the very top of the page as a soft pill pair, with the
 *  active rate shown beside it whenever pounds are in play. */
@Composable
private fun CurrencyBar(
    currency: String,
    exchangeRate: Double,
    onPickUsd: () -> Unit,
    onPickSyp: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
        tonalElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("العملة", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (currency == "SYP" && exchangeRate > 0) {
                    Text(
                        "سعر الصرف: ${"%,.0f".format(exchangeRate)} ل.س — اضغطي SYP لتعديله",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CurrencyToggle("USD", currency == "USD", onPickUsd)
                CurrencyToggle("SYP", currency == "SYP", onPickSyp)
            }
        }
    }
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
