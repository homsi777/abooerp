package com.example.ui.finance

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import android.widget.Toast
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.*
import com.example.ui.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FinanceScreen(
    viewModel: FinanceViewModel,
    onBack: () -> Unit,
    onOpenShipment: (String) -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var selectedTab by remember { mutableIntStateOf(0) }
    var selectedMovement by remember { mutableStateOf<Movement?>(null) }
    var showCreateTransfer by remember { mutableStateOf(false) }
    val actionMessage by viewModel.actionMessage.collectAsStateWithLifecycle()
    val tabs = listOf("ملخص الحساب", "كشف الحساب", "الحوالات")

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("الحساب المالي") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                        }
                    },
                    actions = {
                        if (selectedTab == 2) {
                            IconButton(onClick = { showCreateTransfer = true }) {
                                Icon(Icons.Default.Add, contentDescription = "إنشاء حوالة")
                            }
                        }
                        IconButton(onClick = viewModel::loadData) {
                            Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                        }
                    },
                )
                TabRow(selectedTabIndex = selectedTab) {
                    tabs.forEachIndexed { index, title ->
                        Tab(selected = selectedTab == index, onClick = { selectedTab = index }, text = { Text(title) })
                    }
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state is FinanceState.Loading,
            onRefresh = viewModel::loadData,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Box(Modifier.fillMaxSize()) {
                when (val current = state) {
                    FinanceState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    is FinanceState.Error -> ErrorView(current.message, viewModel::loadData)
                    is FinanceState.Success -> when (selectedTab) {
                        0 -> FinancialSummaryView(current.financial)
                        1 -> AccountStatementView(current.account) { selectedMovement = it }
                        else -> TransfersView(current.transfers, current.transfersUnavailable, viewModel::completeTransfer, onOpenShipment)
                    }
                }
            }
        }
    }

    LaunchedEffect(actionMessage) {
        actionMessage?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            viewModel.clearActionMessage()
        }
    }

    if (showCreateTransfer) {
        CreateTransferDialog(
            onDismiss = { showCreateTransfer = false },
            onConfirm = {
                viewModel.createTransfer(it)
                showCreateTransfer = false
            },
        )
    }

    selectedMovement?.let { movement ->
        MovementDetailsSheet(
            movement = movement,
            onDismiss = { selectedMovement = null },
            onOpenShipment = onOpenShipment,
        )
    }
}

@Composable
private fun ErrorView(message: String, retry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(message, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(16.dp))
        Button(onClick = retry) { Text("إعادة المحاولة") }
    }
}

@Composable
private fun EmptyView(text: String) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Default.Info, contentDescription = null, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text(text)
    }
}

@Composable
private fun FinancialSummaryView(financial: FinancialStatement) {
    val context = LocalContext.current
    val summary = financial.summary ?: FinancialSummary()
    val currency = financial.currency ?: "USD"
    val shareText = """
        شركة عبو المحمود
        ملخص حساب الوكيل
        اسم الوكيل: ${safeText(financial.agent?.name)}
        كود الوكيل: ${safeText(financial.agent?.code)}
        نسبة العمولة: ${percentage(financial.agent?.commissionPercentage)}
        إجمالي عمولات الشحن: ${money(summary.totalShippingCommission, currency)}
        إجمالي عمولات الحوالات: ${money(summary.totalTransferCommission, currency)}
        إجمالي المستحق: ${money(summary.totalDue, currency)}
        إجمالي المدفوع: ${money(summary.totalPaid, currency)}
        الرصيد الحالي: ${money(summary.balance, currency)}
    """.trimIndent()

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(safeText(financial.agent?.name), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    LabelValue("كود الوكيل", safeText(financial.agent?.code))
                    LabelValue("نسبة العمولة", percentage(financial.agent?.commissionPercentage))
                }
            }
        }
        item { SummaryRow("إجمالي عمولات الشحن", money(summary.totalShippingCommission, currency)) }
        item { SummaryRow("إجمالي عمولات الحوالات", money(summary.totalTransferCommission, currency)) }
        item { SummaryRow("إجمالي المستحق", money(summary.totalDue, currency)) }
        item { SummaryRow("إجمالي المدفوع", money(summary.totalPaid, currency)) }
        item { SummaryRow("الرصيد الحالي", money(summary.balance, currency), true) }
        item { SummaryRow("آخر مطابقة", summary.lastReconciliationDate?.let(::formatDate) ?: "لا توجد مطابقة بعد") }
        item { SummaryRow("الرصيد بعد آخر مطابقة", money(summary.balanceAfterLastReconciliation, currency)) }
        item {
            OutlinedButton(
                onClick = { shareArabicText(context, "ملخص حساب الوكيل", shareText) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.Share, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("مشاركة الملخص")
            }
        }
    }
}

@Composable
private fun SummaryRow(label: String, value: String, emphasized: Boolean = false) {
    Card {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label)
            Text(value, fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Medium)
        }
    }
}

@Composable
private fun LabelValue(label: String, value: String) {
    Text("$label: $value")
}

@Composable
private fun AccountStatementView(account: AccountStatement, onMovementClick: (Movement) -> Unit) {
    val movements = account.movements.orEmpty()
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LabelValue("الرصيد الافتتاحي", money(account.openingBalance, account.currency))
                    LabelValue("الرصيد الختامي", money(account.closingBalance, account.currency))
                    LabelValue("عدد الحركات", (account.pagination?.total ?: movements.size).toString())
                    LabelValue("العملة", safeText(account.currency))
                }
            }
        }
        if (movements.isEmpty()) {
            item {
                Text(
                    "لا توجد حركات حساب حالياً",
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
        items(movements, key = { it.id ?: it.hashCode().toString() }) {
            MovementCard(it, onClick = { onMovementClick(it) })
        }
    }
}

@Composable
private fun MovementCard(movement: Movement, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(movementTypeLabel(movement.sourceType), fontWeight = FontWeight.Bold)
                Text(statusLabel(movement.status), color = MaterialTheme.colorScheme.primary)
            }
            Text("${referenceTypeLabel(movement.referenceType)}: ${safeText(movement.referenceNo)}")
            Text("البيان: ${safeText(movement.description)}")
            Text("التاريخ: ${formatDate(movement.date)}")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("مدين: ${money(movement.debit, movement.currency)}")
                Text("دائن: ${money(movement.credit, movement.currency)}")
            }
            Text("الرصيد بعد الحركة: ${money(movement.balance, movement.currency)}", fontWeight = FontWeight.Bold)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MovementDetailsSheet(movement: Movement, onDismiss: () -> Unit, onOpenShipment: (String) -> Unit) {
    val context = LocalContext.current
    val shareText = """
        شركة عبو المحمود
        حركة حساب وكيل
        نوع الحركة: ${movementTypeLabel(movement.sourceType)}
        رقم المرجع: ${safeText(movement.referenceNo)}
        البيان: ${safeText(movement.description)}
        مدين: ${money(movement.debit, movement.currency)}
        دائن: ${money(movement.credit, movement.currency)}
        الرصيد بعد الحركة: ${money(movement.balance, movement.currency)}
        التاريخ: ${formatDate(movement.date)}
        الحالة: ${statusLabel(movement.status)}
    """.trimIndent()
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("تفاصيل حركة الحساب", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            LabelValue("نوع الحركة", movementTypeLabel(movement.sourceType))
            LabelValue("رقم المرجع", safeText(movement.referenceNo))
            LabelValue("التاريخ", formatDate(movement.date))
            LabelValue("البيان", safeText(movement.description))
            LabelValue("مدين", money(movement.debit, movement.currency))
            LabelValue("دائن", money(movement.credit, movement.currency))
            LabelValue("الرصيد بعد الحركة", money(movement.balance, movement.currency))
            LabelValue("الحالة", statusLabel(movement.status))
            OutlinedButton(onClick = { shareArabicText(context, "حركة حساب وكيل", shareText) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Share, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("مشاركة الحركة")
            }
            if (movement.referenceType?.uppercase() == "SHIPMENT" && !movement.referenceId.isNullOrBlank()) {
                Button(onClick = { onOpenShipment(movement.referenceId) }, modifier = Modifier.fillMaxWidth()) {
                    Text("عرض تفاصيل الشحنة")
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun TransfersView(
    transfers: List<AgentTransfer>,
    unavailable: Boolean,
    onComplete: (String) -> Unit,
    onOpenShipment: (String) -> Unit,
) {
    var selectedType by remember { mutableIntStateOf(0) }
    val filteredTransfers = transfers.filter {
        if (selectedType == 0) it.type?.uppercase() != "SHIPMENT_LINKED"
        else it.type?.uppercase() == "SHIPMENT_LINKED"
    }
    if (unavailable) {
        EmptyView("هذه الميزة غير متاحة حالياً من الخادم")
        return
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            TabRow(selectedTabIndex = selectedType) {
                Tab(selected = selectedType == 0, onClick = { selectedType = 0 }, text = { Text("حوالات مستقلة") })
                Tab(selected = selectedType == 1, onClick = { selectedType = 1 }, text = { Text("حوالات مع شحنات") })
            }
        }
        if (filteredTransfers.isEmpty()) {
            item { Text("لا توجد حوالات حالياً", modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp)) }
        }
        items(filteredTransfers, key = { it.id ?: it.hashCode().toString() }) { transfer ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("حوالة: ${safeText(transfer.transferNo)}", fontWeight = FontWeight.Bold)
                        Text(statusLabel(transfer.status), color = MaterialTheme.colorScheme.primary)
                    }
                    Text("النوع: ${transferTypeLabel(transfer.type)}")
                    Text("دورك: ${agentRoleLabel(transfer.currentAgentRole)}")
                    Text("التاريخ: ${formatDate(transfer.createdAt)}")
                    Text("المرسل: ${safeText(transfer.senderName)}")
                    Text("المستلم: ${safeText(transfer.receiverName)}")
                    Text("أصل الحوالة: ${money(transfer.principalAmount ?: transfer.amount, transfer.currency)}")
                    Text("أجرة الحوالة: ${money(transfer.transferFee ?: transfer.serviceFee, transfer.serviceFeeCurrency ?: transfer.currency)}")
                    Text("عمولة الوكيل: ${money(transfer.agentCommission, transfer.agentCommissionCurrency ?: transfer.currency)}")
                    if (!transfer.linkedShipmentNo.isNullOrBlank()) Text("الشحنة المرتبطة: ${safeText(transfer.linkedShipmentNo)}")
                    Text("من: ${safeText(transfer.sourceCity)}")
                    Text("إلى: ${safeText(transfer.destinationCity)}")
                    Text("وكيل المصدر: ${safeText(transfer.originAgentName)}")
                    Text("وكيل الوجهة: ${safeText(transfer.destinationAgentName)}")
                    Text("ملاحظات: ${safeText(transfer.notes)}")
                    if (transfer.canCurrentAgentComplete == true && !transfer.id.isNullOrBlank()) {
                        Button(onClick = { onComplete(transfer.id) }, modifier = Modifier.fillMaxWidth()) {
                            Text("تسليم الحوالة")
                        }
                    }
                    if (!transfer.linkedShipment?.id.isNullOrBlank()) {
                        OutlinedButton(onClick = { onOpenShipment(transfer.linkedShipment!!.id!!) }, modifier = Modifier.fillMaxWidth()) {
                            Text("عرض تفاصيل الشحنة")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CreateTransferDialog(onDismiss: () -> Unit, onConfirm: (CreateAgentTransferRequest) -> Unit) {
    var sender by remember { mutableStateOf("") }
    var receiver by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var fee by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    val valid = sender.isNotBlank() && receiver.isNotBlank() && destination.isNotBlank() && (amount.toDoubleOrNull() ?: 0.0) > 0
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("إنشاء حوالة جديدة") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(sender, { sender = it }, label = { Text("اسم المرسل") })
                OutlinedTextField(receiver, { receiver = it }, label = { Text("اسم المستلم") })
                OutlinedTextField(destination, { destination = it }, label = { Text("الوجهة") })
                OutlinedTextField(amount, { amount = it }, label = { Text("المبلغ USD") })
                OutlinedTextField(fee, { fee = it }, label = { Text("أجرة الحوالة USD") })
                OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") })
            }
        },
        confirmButton = {
            TextButton(
                enabled = valid,
                onClick = {
                    onConfirm(CreateAgentTransferRequest(sender, receiver, destination, amount.toDouble(), "USD", fee.toDoubleOrNull() ?: 0.0, notes.ifBlank { null }))
                },
            ) { Text("إنشاء وقبض") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}
