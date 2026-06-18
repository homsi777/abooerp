package com.example.ui.shipments

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.CreateShipmentRequest
import com.example.data.Shipment
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material3.rememberDatePickerState
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import com.example.ui.formatDate
import com.example.ui.formatIsoDateOnly
import com.example.ui.money
import com.example.ui.safeText
import com.example.ui.statusLabel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShipmentsListScreen(viewModel: ShipmentsViewModel, onBack: () -> Unit, onShipmentClick: (Shipment) -> Unit) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val selectedDate by viewModel.selectedDate.collectAsStateWithLifecycle()
    var showCreateDialog by remember { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }
    val damascusZone = remember { ZoneId.of("Asia/Damascus") }
    val todayIso = remember { LocalDate.now(damascusZone).toString() }
    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("الشحنات") },
                    navigationIcon = {
                        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                    },
                    actions = {
                        IconButton(onClick = { showCreateDialog = true }) { Icon(Icons.Default.Add, contentDescription = "شحنة جديدة") }
                        IconButton(onClick = viewModel::loadShipments) { Icon(Icons.Default.Refresh, contentDescription = "تحديث") }
                    },
                )
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FilterChip(
                        selected = selectedDate == todayIso,
                        onClick = viewModel::selectToday,
                        label = { Text("اليوم") },
                    )
                    FilterChip(
                        selected = selectedDate != todayIso,
                        onClick = { showDatePicker = true },
                        label = { Text(formatIsoDateOnly(selectedDate)) },
                        leadingIcon = { Icon(Icons.Default.CalendarToday, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    )
                    FilterChip(
                        selected = false,
                        onClick = viewModel::selectYesterday,
                        label = { Text("أمس") },
                    )
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state is ShipmentsState.Loading,
            onRefresh = viewModel::loadShipments,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Box(Modifier.fillMaxSize()) {
                when (val current = state) {
                    ShipmentsState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    is ShipmentsState.Error -> Column(
                        Modifier.align(Alignment.Center).padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(current.message, color = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = viewModel::loadShipments) { Text("إعادة المحاولة") }
                    }
                    is ShipmentsState.Success -> if (current.shipments.isEmpty()) {
                        Text(
                            "لا توجد شحنات في ${formatIsoDateOnly(current.selectedDate)}",
                            modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        )
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(current.shipments, key = { it.id }) { shipment ->
                                ShipmentCard(shipment) { onShipmentClick(shipment) }
                            }
                        }
                    }
                }
            }
        }
    }
    if (showCreateDialog) {
        CreateShipmentDialog(
            onDismiss = { showCreateDialog = false },
            onConfirm = {
                viewModel.createShipment(it)
                showCreateDialog = false
            },
        )
    }
    if (showDatePicker) {
        val initialMillis = runCatching {
            LocalDate.parse(selectedDate).atStartOfDay(damascusZone).toInstant().toEpochMilli()
        }.getOrElse { System.currentTimeMillis() }
        val datePickerState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { millis ->
                        val picked = Instant.ofEpochMilli(millis).atZone(damascusZone).toLocalDate().toString()
                        viewModel.setSelectedDate(picked)
                    }
                    showDatePicker = false
                }) { Text("تطبيق") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("إلغاء") } },
        ) {
            DatePicker(state = datePickerState)
        }
    }
}

@Composable
private fun CreateShipmentDialog(onDismiss: () -> Unit, onConfirm: (CreateShipmentRequest) -> Unit) {
    var shipmentNo by remember { mutableStateOf("") }
    var sender by remember { mutableStateOf("") }
    var senderPhone by remember { mutableStateOf("") }
    var receiver by remember { mutableStateOf("") }
    var receiverPhone by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }
    var pieces by remember { mutableStateOf("1") }
    var weight by remember { mutableStateOf("") }
    var freight by remember { mutableStateOf("") }
    var collection by remember { mutableStateOf("") }
    var hawala by remember { mutableStateOf("") }
    var hawalaFee by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    val piecesCount = pieces.toIntOrNull()
    val valid = shipmentNo.isNotBlank() && sender.isNotBlank() && receiver.isNotBlank() &&
        destination.isNotBlank() && (piecesCount ?: 0) > 0
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("إنشاء شحنة جديدة") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                OutlinedTextField(shipmentNo, { shipmentNo = it }, label = { Text("رقم الشحنة") })
                OutlinedTextField(sender, { sender = it }, label = { Text("اسم المرسل") })
                OutlinedTextField(senderPhone, { senderPhone = it }, label = { Text("هاتف المرسل") })
                OutlinedTextField(receiver, { receiver = it }, label = { Text("اسم المستلم") })
                OutlinedTextField(receiverPhone, { receiverPhone = it }, label = { Text("هاتف المستلم") })
                OutlinedTextField(destination, { destination = it }, label = { Text("الوجهة") })
                OutlinedTextField(pieces, { pieces = it }, label = { Text("عدد الطرود") })
                OutlinedTextField(weight, { weight = it }, label = { Text("الوزن كغ") })
                OutlinedTextField(freight, { freight = it }, label = { Text("أجرة الشحن USD") })
                OutlinedTextField(collection, { collection = it }, label = { Text("تحصيل لصالح المرسل USD") })
                OutlinedTextField(hawala, { hawala = it }, label = { Text("أصل حوالة مرتبطة USD") })
                OutlinedTextField(hawalaFee, { hawalaFee = it }, label = { Text("أجرة الحوالة USD") })
                OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") })
            }
        },
        confirmButton = {
            TextButton(enabled = valid, onClick = {
                val confirmedPieces = pieces.toIntOrNull() ?: return@TextButton
                onConfirm(CreateShipmentRequest(
                    shipmentNo = shipmentNo.trim(), senderName = sender.trim(), senderPhone = senderPhone.ifBlank { null },
                    receiverName = receiver.trim(), receiverPhone = receiverPhone.ifBlank { null }, destinationCity = destination.trim(),
                    piecesCount = confirmedPieces, weightKg = weight.toDoubleOrNull(), freightCharge = freight.toDoubleOrNull() ?: 0.0,
                    senderCollectionAmount = collection.toDoubleOrNull() ?: 0.0, hawalaAmount = hawala.toDoubleOrNull() ?: 0.0,
                    transferServiceFee = hawalaFee.toDoubleOrNull() ?: 0.0, notes = notes.ifBlank { null },
                ))
            }) { Text("إنشاء") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
private fun ShipmentCard(shipment: Shipment, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("شحنة: ${safeText(shipment.trackingNumber)}", fontWeight = FontWeight.Bold)
                Text(statusLabel(shipment.status), color = MaterialTheme.colorScheme.primary)
            }
            Text("من ${safeText(shipment.sourceBranch)} إلى ${safeText(shipment.destinationBranch)}")
            Text("المرسل: ${safeText(shipment.senderName)}")
            Text("المستلم: ${safeText(shipment.receiverName)}")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("الطرود: ${shipment.pieces ?: 0}")
                Text(money(shipment.amount, shipment.currency), fontWeight = FontWeight.Bold)
            }
            Text("التاريخ: ${formatDate(shipment.date)}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
