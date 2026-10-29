package com.abooerp.dataentry.printer

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.abooerp.dataentry.data.AuthStorage
import com.abooerp.dataentry.data.toWesternDigits
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * Gear-icon destination from the ledger screen: pick which already-paired
 * Bluetooth device is "our printer". Once saved, every future print
 * connects straight to that MAC address silently — no dialog, no
 * notification. Pairing itself must happen first from the phone's own
 * Bluetooth settings; this screen only ever lists bonded devices.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrinterSettingsScreen(
    printerManager: BluetoothPrinterManager,
    labelPrinter: TsplLabelPrinter,
    authStorage: AuthStorage,
    onBack: () -> Unit,
) {
    var hasPermission by remember { mutableStateOf(printerManager.hasBluetoothPermission()) }
    var savedAddress by remember { mutableStateOf(authStorage.getPrinterAddress()) }
    var refreshTick by remember { mutableStateOf(0) }
    var selectedDevice by remember { mutableStateOf<BluetoothDevice?>(null) }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasPermission = granted
        refreshTick++
    }

    LaunchedEffect(Unit) {
        if (!hasPermission && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissionLauncher.launch(Manifest.permission.BLUETOOTH_CONNECT)
        }
    }

    val devices = remember(hasPermission, refreshTick) {
        if (hasPermission) printerManager.bondedPrinters() else emptyList()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("إعدادات الطابعة") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") } },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
        ) {
            Text(
                "بلوتوث — طابعة مقترَنة بالهاتف",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "اختاري طابعة الإيصالات الحرارية — يجب اقترانها أولاً من إعدادات بلوتوث الهاتف",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            when {
                // A plain message here read as "the Bluetooth option is
                // gone" on a device that had not granted the permission
                // yet, so the way back is an actual button.
                !hasPermission -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("يجب السماح بصلاحية البلوتوث لعرض الأجهزة المقترنة.", color = MaterialTheme.colorScheme.error)
                    Button(
                        onClick = {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                permissionLauncher.launch(Manifest.permission.BLUETOOTH_CONNECT)
                            }
                        },
                    ) { Text("السماح بصلاحية البلوتوث") }
                }
                devices.isEmpty() -> Text(
                    "لا توجد أجهزة بلوتوث مقترنة بعد. اقتري الطابعة أولاً من إعدادات الهاتف ← بلوتوث، ثم عودي إلى هنا.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // Plain Column, not LazyColumn: the whole screen scrolls
                // now, and a lazy list inside a scrolling parent has no
                // bounded height.
                else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (device in devices) {
                        val isDefault = device.address == savedAddress
                        ElevatedCard(
                            shape = RoundedCornerShape(16.dp),
                            onClick = { selectedDevice = device },
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier.size(44.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f), CircleShape),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(Icons.Default.Print, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column {
                                        Text(device.name ?: "جهاز بدون اسم", fontWeight = FontWeight.Bold)
                                        Text(device.address, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                                if (isDefault) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                        Spacer(Modifier.width(4.dp))
                                        Text("افتراضية", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

            LabelPrinterSection(labelPrinter = labelPrinter, authStorage = authStorage)
        }
    }

    selectedDevice?.let { device ->
        PrinterActionDialog(
            device = device,
            isDefault = device.address == savedAddress,
            printerManager = printerManager,
            authStorage = authStorage,
            onSetDefault = {
                authStorage.savePrinter(device.address, device.name ?: device.address)
                savedAddress = device.address
            },
            onDismiss = { selectedDevice = null },
        )
    }
}

@Composable
private fun PrinterActionDialog(
    device: BluetoothDevice,
    isDefault: Boolean,
    printerManager: BluetoothPrinterManager,
    authStorage: AuthStorage,
    onSetDefault: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var testing by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<PrintResult?>(null) }
    val timeFormat = remember { SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(device.name ?: "جهاز بدون اسم", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(device.address, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (isDefault) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("هذه هي الطابعة الافتراضية حالياً", color = MaterialTheme.colorScheme.primary)
                    }
                }
                when (val result = testResult) {
                    is PrintResult.Success -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("تم الطباعة بنجاح", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    }
                    is PrintResult.Failure -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(result.message, color = MaterialTheme.colorScheme.error)
                    }
                    null -> {}
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    testing = true
                    testResult = null
                    scope.launch {
                        // A realistic sample receipt (same fields as "سطر
                        // جديد" in the ledger screen) so she can judge the
                        // actual layout/design, not just confirm connectivity.
                        val bitmap = ReceiptRenderer.render(buildSampleReceipt(authStorage, timeFormat))
                        testResult = printerManager.printBitmap(device.address, bitmap)
                        testing = false
                    }
                },
                enabled = !testing,
            ) {
                if (testing) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                Text(if (testing) "جارٍ الاختبار..." else "اختبار الطباعة")
            }
        },
        dismissButton = {
            Row {
                if (!isDefault) {
                    TextButton(onClick = { onSetDefault() }) { Text("تعيين كافتراضية") }
                }
                TextButton(onClick = onDismiss) { Text("إغلاق") }
            }
        },
    )
}

/** A realistic sample receipt (same fields as "سطر جديد" in the ledger
 *  screen) so a test print shows the actual layout/design, not just a
 *  connectivity check — shared by both the Bluetooth and network flows. */
private fun buildSampleReceipt(authStorage: AuthStorage, timeFormat: SimpleDateFormat): ReceiptData = ReceiptData(
    companyName = "شركة عبو المحمود لنقل والخدمات اللوجستية",
    branchLabel = authStorage.getBranchLabel() ?: "الفرع الرئيسي",
    employeeName = authStorage.getEmployeeName() ?: "الموظف",
    dateTime = timeFormat.format(Date()),
    receiptNo = "TEST-0001",
    destination = "دمشق",
    parcelType = "أجهزة كهربائية",
    parcelCount = 3,
    weightKg = 12.5,
    senderName = "أحمد الحلبي",
    senderPhone = "0933123456",
    receiverName = "محمد العلي",
    receiverPhone = "0944987654",
    collectAmount = 45.0,
    hawalaAmount = 100.0,
    hawalaFee = 2.5,
    prepaidAmount = 10.0,
    currencyCode = "USD",
    notes = "بضاعة قابلة للكسر — يرجى الحذر",
)

private fun buildSampleLabel(authStorage: AuthStorage, timeFormat: SimpleDateFormat): LabelData = LabelData(
    companyName = "شركة عبو المحمود لنقل والخدمات اللوجستية",
    sourceLabel = "المصدر: ${authStorage.getBranchLabel() ?: "الفرع الرئيسي"}",
    dateTime = timeFormat.format(Date()),
    receiptNo = "TEST-0001",
    destination = "القامشلي",
    parcelType = "أجهزة كهربائية",
    parcelCount = 3,
    weightKg = 12.5,
    senderName = "أحمد الحلبي",
    senderPhone = "",
    receiverName = "محمد العلي",
    receiverPhone = "",
    notes = "بضاعة قابلة للكسر - يرجى الحذر",
)

/**
 * Parcel-label printer card. This is an ADDITIONAL printer, not an
 * alternative to the two above: the receipt goes to the Bluetooth/IP
 * receipt printer and the label goes here, both automatically on save.
 */
@Composable
private fun LabelPrinterSection(
    labelPrinter: TsplLabelPrinter,
    authStorage: AuthStorage,
) {
    val scope = rememberCoroutineScope()
    var host by remember { mutableStateOf(authStorage.getLabelPrinterHost() ?: "") }
    var portText by remember { mutableStateOf(authStorage.getLabelPrinterPort().toString()) }
    var saved by remember { mutableStateOf(authStorage.getLabelPrinterHost() != null) }
    var testing by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<PrintResult?>(null) }
    val timeFormat = remember { SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US) }
    val port = portText.toIntOrNull() ?: DEFAULT_LABEL_PRINTER_PORT

    Text("طابعة اللصاقات (IP)", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
    Text(
        "طابعة لصاقات الطرود بقياس 70×120 مم على نفس شبكة الواي فاي — تُطبع تلقائياً مع كل شحنة بالإضافة إلى إيصال المرسل",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(12.dp))

    ElevatedCard(shape = RoundedCornerShape(16.dp)) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    modifier = Modifier.size(44.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Wifi, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                }
                Column(modifier = Modifier.weight(1f)) {
                    OutlinedTextField(
                        value = host,
                        onValueChange = { host = toWesternDigits(it).filter { c -> c.isDigit() || c == '.' }; saved = false },
                        label = { Text("عنوان IP") },
                        placeholder = { Text("مثال: 192.168.1.250") },
                        singleLine = true,
                        // Plain text, not Decimal: an Arabic-locale decimal
                        // pad offers "٫" instead of "." and Arabic-Indic
                        // digits, which made the address impossible to type.
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = portText,
                        onValueChange = { portText = toWesternDigits(it).filter { c -> c.isDigit() }; saved = false },
                        label = { Text("المنفذ (Port)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (saved) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(4.dp))
                        Text("مفعّلة", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    }
                }
            }

            when (val result = testResult) {
                is PrintResult.Success -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("تم الطباعة بنجاح", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                }
                is PrintResult.Failure -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(result.message, color = MaterialTheme.colorScheme.error)
                }
                null -> {}
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(
                    onClick = {
                        testing = true
                        testResult = null
                        scope.launch {
                            val bitmap = LabelRenderer.render(buildSampleLabel(authStorage, timeFormat))
                            testResult = labelPrinter.printLabel(host, port, bitmap)
                            testing = false
                        }
                    },
                    enabled = !testing && host.isNotBlank(),
                ) {
                    if (testing) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(if (testing) "جارٍ الاختبار..." else "اختبار طباعة لصاقة")
                }
                if (!saved) {
                    TextButton(
                        onClick = {
                            authStorage.saveLabelPrinter(host, port)
                            saved = true
                        },
                        enabled = host.isNotBlank(),
                    ) { Text("حفظ وتفعيل") }
                } else {
                    TextButton(
                        onClick = {
                            authStorage.clearLabelPrinter()
                            host = ""
                            saved = false
                        },
                    ) { Text("إيقاف") }
                }
            }
        }
    }
}

