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
    val context = LocalContext.current
    var showDeliverDialog by remember { mutableStateOf(false) }
    var deliverNote by remember { mutableStateOf("") }
    val shareText = """
        شركة عبو المحمود
        تفاصيل الشحنة
        رقم الشحنة: ${safeText(shipment.trackingNumber)}
        الحالة: ${statusLabel(shipment.status)}
        من: ${safeText(shipment.sourceBranch)}
        إلى: ${safeText(shipment.destinationBranch)}
        المرسل: ${safeText(shipment.senderName)}
        المستلم: ${safeText(shipment.receiverName)}
        عدد الطرود: ${shipment.pieces ?: 0}
        المبلغ: ${money(shipment.amount, shipment.currency)}
        أجرة الشحن: ${money(shipment.freightCharge, shipment.currency)}
    """.trimIndent()

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
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text("شحنة رقم ${safeText(shipment.trackingNumber)}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Detail("الحالة", statusLabel(shipment.status))
            Detail("تاريخ الإنشاء", formatDate(shipment.date))
            HorizontalDivider()
            Detail("المدينة المصدر", safeText(shipment.sourceBranch))
            Detail("المدينة الوجهة", safeText(shipment.destinationBranch))
            Detail("المرسل", safeText(shipment.senderName))
            Detail("هاتف المرسل", safeText(shipment.senderPhone))
            Detail("المستلم", safeText(shipment.receiverName))
            Detail("هاتف المستلم", safeText(shipment.receiverPhone))
            HorizontalDivider()
            Detail("عدد الطرود", (shipment.pieces ?: 0).toString())
            Detail("عدد الطرود المحملة", (shipment.loadedPiecesCount ?: 0).toString())
            Detail("الوزن", "${shipment.weight ?: 0.0} كغ")
            Detail("إجمالي المطلوب عند التسليم", money(shipment.amount, shipment.currency))
            Detail("أجرة الشحن", money(shipment.freightCharge, shipment.currency))
            Detail("تحصيل لصالح المرسل", money(shipment.senderCollectionAmount, shipment.currency))
            Detail("أصل الحوالة", money(shipment.hawalaAmount, shipment.currency))
            Detail("أجرة خدمة الحوالة", money(shipment.transferServiceFee, shipment.currency))
            Detail("مستحقات إضافية", money(shipment.additionalCharges, shipment.currency))
            Detail("مدفوع مسبقاً", money(shipment.prepaidAmount, shipment.currency))
            Detail("نسبة عمولة الوكيل", percentage(shipment.agentCommissionPercentageSnapshot))
            Detail("عمولة الوكيل", money(shipment.agentCommissionAmountSnapshot, shipment.currency))
            Detail("الوصف والملاحظات", safeText(shipment.description ?: shipment.note))
            HorizontalDivider()
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
private fun Detail(label: String, value: String) {
    Text("$label: $value")
}
