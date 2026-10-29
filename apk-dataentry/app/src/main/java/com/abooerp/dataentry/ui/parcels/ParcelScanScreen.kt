package com.abooerp.dataentry.ui.parcels

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.abooerp.dataentry.data.ParcelRemote
import com.abooerp.dataentry.data.toWesternDigits

/** What the next scan will do, in the employee's words. */
private fun nextActionLabel(status: String): String = when (status) {
    "intake" -> "تسجيل دخول المستودع"
    "warehouse" -> "تسجيل الوصول إلى الوجهة"
    "arrived" -> "تسليم الطرد للمستلم"
    else -> "لا إجراء — الشحنة سُلّمت مسبقاً"
}

/**
 * Receive/deliver screen. The search box is the scanner: an external QR
 * reader types the number and sends Enter, which is exactly what typing it
 * by hand does — so one screen serves both, and a phone camera can be
 * added later as a third way in without changing any of this.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ParcelScanScreen(
    viewModel: ParcelScanViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var code by remember { mutableStateOf("") }
    var deliveredTo by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    // The field keeps focus so a scanner can fire one code after another
    // without anyone touching the screen.
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    fun submit() {
        if (code.isNotBlank()) viewModel.lookup(code)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("استلام / تسليم") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                "امسحي رمز QR على اللصاقة بالقارئ، أو اكتبي رقم الإيصال واضغطي بحث.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                value = code,
                onValueChange = { code = toWesternDigits(it).filter(Char::isDigit) },
                label = { Text("رقم الإيصال / مسح QR") },
                leadingIcon = { Icon(Icons.Default.QrCodeScanner, contentDescription = null) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { submit() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
            )

            Button(
                onClick = { submit() },
                enabled = code.isNotBlank() && state !is ParcelScanState.Working,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(14.dp),
            ) { Text("بحث", fontWeight = FontWeight.Bold) }

            when (val current = state) {
                is ParcelScanState.Working -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("جارٍ التنفيذ...")
                }

                is ParcelScanState.Error -> MessageCard(current.message, isError = true)

                is ParcelScanState.Found -> {
                    val parcel = current.parcel
                    val isDelivered = parcel.parcelStatus == "delivered"
                    ParcelCard(parcel)
                    if (isDelivered) {
                        MessageCard("هذه الشحنة سُلّمت مسبقاً${parcel.deliveredToName?.let { " إلى: $it" } ?: ""}.", isError = true)
                    } else {
                        if (parcel.parcelStatus == "arrived") {
                            OutlinedTextField(
                                value = deliveredTo,
                                onValueChange = { deliveredTo = it },
                                label = { Text("اسم المستلم") },
                                placeholder = { Text(parcel.receiverName ?: "") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                "اتركيه فارغاً ليُسجَّل باسم المستلم المدوّن على الشحنة.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Button(
                            onClick = {
                                parcel.tabletReceiptNo?.let { viewModel.confirm(it, deliveredTo) }
                            },
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text(nextActionLabel(parcel.parcelStatus), fontWeight = FontWeight.Bold)
                        }
                    }
                }

                is ParcelScanState.Moved -> {
                    ParcelCard(current.parcel)
                    MessageCard(
                        if (current.parcel.parcelStatus == "delivered") {
                            "تم التسليم${current.parcel.deliveredToName?.let { " إلى: $it" } ?: ""}"
                        } else {
                            "تم تحديث الحالة: ${current.parcel.statusLabel ?: current.parcel.parcelStatus}"
                        },
                        isError = false,
                    )
                    OutlinedButton(
                        onClick = {
                            code = ""
                            deliveredTo = ""
                            viewModel.reset()
                            focusRequester.requestFocus()
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("مسح شحنة أخرى") }
                }

                ParcelScanState.Idle -> {}
            }
        }
    }
}

@Composable
private fun ParcelCard(parcel: ParcelRemote) {
    val delivered = parcel.parcelStatus == "delivered"
    ElevatedCard(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.elevatedCardColors(
            // Green once it is out of our hands — the one state an agent
            // needs to recognise across the room.
            containerColor = if (delivered) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("رقم الإيصال: ${parcel.tabletReceiptNo ?: "-"}", fontWeight = FontWeight.Bold)
            Text("الحالة: ${parcel.statusLabel ?: parcel.parcelStatus}", fontWeight = FontWeight.Bold)
            Text("المرسل: ${parcel.senderName ?: "-"}")
            Text("المستلم: ${parcel.receiverName ?: "-"}")
            Text("الوجهة: ${parcel.destination ?: "-"}")
            Text("نوع البضاعة: ${parcel.parcelType ?: "-"}    عدد الطرود: ${parcel.parcelCount ?: "-"}")
            parcel.branchName?.let { Text("فرع الإرسال: $it", style = MaterialTheme.typography.labelSmall) }
        }
    }
}

@Composable
private fun MessageCard(message: String, isError: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            if (isError) Icons.Default.ErrorOutline else Icons.Default.Check,
            contentDescription = null,
            tint = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            message,
            color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
        )
    }
}
