package com.example.ui.shipments

import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.Shipment
import com.example.ui.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShipmentDetailsScreen(shipment: Shipment, viewModel: ShipmentsViewModel, onBack: () -> Unit) {
    val actionState by viewModel.actionState.collectAsStateWithLifecycle()
    val detailsById by viewModel.details.collectAsStateWithLifecycle()
    val details = detailsById[shipment.id]
    val info = details?.shipmentInfo
    val financials = details?.shipmentFinancials
    val linkedTransfer = details?.linkedTransfer
    val context = LocalContext.current
    var showDeliverDialog by remember { mutableStateOf(false) }
    var deliverNote by remember { mutableStateOf("") }
    val currency = financials?.currency ?: shipment.currency
    val shareText = """
        شركة عبو المحمود
        تفاصيل الشحنة
        رقم الشحنة: ${safeText(info?.shipmentNo ?: shipment.trackingNumber)}
        الحالة: ${statusLabel(info?.status ?: shipment.status)}
        من: ${safeText(info?.sourceCity ?: shipment.sourceBranch)}
        إلى: ${safeText(info?.destinationCity ?: shipment.destinationBranch)}
        المرسل: ${safeText(info?.senderName ?: shipment.senderName)}
        المستلم: ${safeText(info?.receiverName ?: shipment.receiverName)}
        عدد الطرود: ${info?.piecesCount ?: shipment.pieces ?: 0}
        إجمالي المطلوب عند التسليم: ${money(financials?.totalAmountToCollectOnDelivery ?: shipment.amount, currency)}
        أجرة الشحن: ${money(financials?.shippingFee ?: shipment.freightCharge, currency)}
        أصل الحوالة المرتبطة: ${money(financials?.linkedTransferPrincipal ?: shipment.hawalaAmount, currency)}
    """.trimIndent()

    LaunchedEffect(shipment.id) {
        viewModel.loadShipmentDetails(shipment.id)
    }
    LaunchedEffect(actionState) {
        actionState?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            viewModel.clearActionState()
        }
    }

    if (showDeliverDialog) {
        AlertDialog(
            onDismissRequest = { showDeliverDialog = false },
            title = { Text("تسليم الشحنة") },
            text = {
                OutlinedTextField(
                    value = deliverNote,
                    onValueChange = { deliverNote = it },
                    label = { Text("ملاحظات التسليم") },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deliverShipment(shipment.id, deliverNote)
                    showDeliverDialog = false
                }) { Text("تأكيد") }
            },
            dismissButton = { TextButton(onClick = { showDeliverDialog = false }) { Text("إلغاء") } },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("تفاصيل الشحنة") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
                actions = {
                    IconButton(onClick = { shareArabicText(context, "تفاصيل الشحنة", shareText) }) {
                        Icon(Icons.Default.Share, contentDescription = "مشاركة")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("شحنة رقم ${safeText(info?.shipmentNo ?: shipment.trackingNumber)}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Section("بيانات الشحنة") {
                Detail("الحالة", statusLabel(info?.status ?: shipment.status))
                Detail("تاريخ الإنشاء", formatDate(info?.createdAt ?: shipment.date))
                Detail("المدينة المصدر", safeText(info?.sourceCity ?: shipment.sourceBranch))
                Detail("المدينة الوجهة", safeText(info?.destinationCity ?: shipment.destinationBranch))
                Detail("المرسل", safeText(info?.senderName ?: shipment.senderName))
                Detail("هاتف المرسل", safeText(info?.senderPhone ?: shipment.senderPhone))
                Detail("المستلم", safeText(info?.receiverName ?: shipment.receiverName))
                Detail("هاتف المستلم", safeText(info?.receiverPhone ?: shipment.receiverPhone))
                Detail("عدد الطرود", (info?.piecesCount ?: shipment.pieces ?: 0).toString())
                Detail("عدد الطرود المحملة", (info?.loadedPiecesCount ?: shipment.loadedPiecesCount ?: 0).toString())
                Detail("الوزن", "${info?.weightKg ?: shipment.weight ?: 0.0} كغ")
                Detail("الوصف والملاحظات", safeText(info?.description ?: shipment.description ?: shipment.note))
            }
            Section("تفصيل المبالغ") {
                Detail("أجرة الشحن", money(financials?.shippingFee ?: shipment.freightCharge, currency))
                Detail("تحصيل لصالح المرسل", money(financials?.senderCollectionAmount ?: shipment.senderCollectionAmount, currency))
                Detail("مستحقات إضافية", money(financials?.additionalCharges ?: shipment.additionalCharges, currency))
                Detail("تحصيل إضافي", money(financials?.generalCollectionAmount, currency))
                Detail("مدفوع مسبقاً", money(financials?.prepaidAmount ?: shipment.prepaidAmount, currency))
                Detail("المطلوب للشحن فقط", money(financials?.shippingAmountToCollectOnDelivery, currency))
                Detail("أصل الحوالة المرتبطة", money(financials?.linkedTransferPrincipal ?: shipment.hawalaAmount, currency))
                Detail("أجرة خدمة الحوالة", money(financials?.linkedTransferServiceFee ?: shipment.transferServiceFee, currency))
                Detail("إجمالي المطلوب عند التسليم", money(financials?.totalAmountToCollectOnDelivery ?: shipment.amount, currency))
            }
            Section("استحقاق الوكيل") {
                Detail("نسبة عمولة الوكيل", percentage(financials?.agentCommissionPercentage ?: shipment.agentCommissionPercentageSnapshot))
                Detail("عمولة الوكيل", money(financials?.agentCommissionAmount ?: shipment.agentCommissionAmountSnapshot, currency))
            }
            if (linkedTransfer != null) {
                Section("الحوالة المرتبطة بالشحنة") {
                    Detail("الحالة", statusLabel(linkedTransfer.status))
                    Detail("أصل الحوالة", money(linkedTransfer.principalAmount ?: linkedTransfer.amount, linkedTransfer.currency))
                    Detail("أجرة الحوالة", money(linkedTransfer.transferFee ?: linkedTransfer.serviceFee, linkedTransfer.currency))
                    Detail("وكيل الوجهة", safeText(linkedTransfer.destinationAgentName))
                    Detail("هل يجب دفع أصل الحوالة للمستلم؟", if (linkedTransfer.shouldCurrentAgentPayPrincipal == true) "نعم" else "لا")
                }
            }
            Text("الإجراءات المتاحة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Button(onClick = { viewModel.markAgentReceived(shipment.id) }, modifier = Modifier.fillMaxWidth()) { Text("تأكيد استلام الوكيل") }
            Button(onClick = { viewModel.markOutForDelivery(shipment.id) }, modifier = Modifier.fillMaxWidth()) { Text("خارج للتسليم") }
            Button(onClick = { showDeliverDialog = true }, modifier = Modifier.fillMaxWidth()) { Text("تسليم الشحنة") }
            OutlinedButton(onClick = { viewModel.requestReturnShipment(shipment.id, "مطلوب الإرجاع") }, modifier = Modifier.fillMaxWidth()) {
                Text("طلب إرجاع")
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            HorizontalDivider()
            content()
        }
    }
}

@Composable
private fun Detail(label: String, value: String) {
    Text("$label: $value")
}
