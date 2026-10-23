package com.abooerp.dataentry.ui.shift

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.abooerp.dataentry.data.CurrencyBalance
import com.abooerp.dataentry.data.Shift
import com.abooerp.dataentry.data.ShiftStatus

private val HeroTop = Color(0xFF12724F)
private val HeroBottom = Color(0xFF0B4C34)

@Composable
fun ShiftDashboardScreen(
    employeeName: String,
    viewModel: ShiftViewModel,
    onOpenLedger: () -> Unit,
    onOpenHistory: () -> Unit,
    onLogout: () -> Unit,
) {
    val shift by viewModel.shift.collectAsStateWithLifecycle()
    val pendingCount by viewModel.pendingCount.collectAsStateWithLifecycle()
    val shiftError by viewModel.shiftError.collectAsStateWithLifecycle()
    val shiftBusy by viewModel.shiftBusy.collectAsStateWithLifecycle()
    val shiftLoading by viewModel.shiftLoading.collectAsStateWithLifecycle()
    val shiftRestoreFailed by viewModel.shiftRestoreFailed.collectAsStateWithLifecycle()
    var showCloseConfirm by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(shiftError) {
        shiftError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearShiftError()
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp))
                    .background(Brush.verticalGradient(listOf(HeroTop, HeroBottom)))
                    .padding(24.dp),
            ) {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("إدخال البيانات — عبو المحمود", style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.85f))
                        IconButton(onClick = onLogout) {
                            Icon(Icons.Default.Logout, contentDescription = "تسجيل الخروج", tint = Color.White)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Text("أهلاً، $employeeName", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Color.White)
                    Spacer(Modifier.height(6.dp))
                    ShiftStatusChip(shift?.status)
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            when {
                // Still checking with the server — must never fall through
                // to "no shift, open one" while this is unresolved; that
                // false state is exactly what caused an already-open,
                // unconfirmed shift to look invisible after a network blip.
                shiftLoading -> ShiftCheckingCard()
                shiftRestoreFailed -> ShiftCheckFailedCard(onRetry = viewModel::retryRestoreShift)
                else -> when (shift?.status) {
                    null, ShiftStatus.NONE, ShiftStatus.CONFIRMED -> NoShiftCard(busy = shiftBusy, onOpenShift = viewModel::openShift)
                    ShiftStatus.REJECTED -> RejectedShiftCard(shift!!, busy = shiftBusy, onOpenShift = viewModel::openShift)
                    ShiftStatus.OPEN -> OpenShiftContent(
                        shift = shift!!,
                        pendingCount = pendingCount,
                        busy = shiftBusy,
                        onOpenLedger = onOpenLedger,
                        onCloseShift = { showCloseConfirm = true },
                    )
                    ShiftStatus.PENDING_CONFIRMATION -> PendingConfirmationCard(shift!!)
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                onClick = onOpenHistory,
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier.size(48.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.History, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column {
                        Text("سجلات شحنات", fontWeight = FontWeight.Bold)
                        Text("استعراض السطور المُدخلة حسب التاريخ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    if (showCloseConfirm && shift != null) {
        AlertDialog(
            onDismissRequest = { showCloseConfirm = false },
            title = { Text("إغلاق الوردية") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("سيتم إرسال هذا الملخص كمسودة بانتظار تأكيد المحاسب:")
                    Spacer(Modifier.height(6.dp))
                    shift!!.balances.forEach { total ->
                        val opening = shift!!.openingBalances.find { it.currencyCode == total.currencyCode }?.amount ?: 0.0
                        val collected = total.amount - opening
                        Text("${currencyLabel(total.currencyCode)}:", fontWeight = FontWeight.Bold)
                        Text("   افتتاحي ${formatAmount(opening)} + محصّل ${formatAmount(collected)} = ${formatAmount(total.amount)}")
                    }
                    Text("عدد السطور: ${shift!!.rowCount}", modifier = Modifier.padding(top = 6.dp))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.closeShift()
                    showCloseConfirm = false
                }) { Text("تأكيد الإغلاق") }
            },
            dismissButton = { TextButton(onClick = { showCloseConfirm = false }) { Text("تراجع") } },
        )
    }
}

@Composable
private fun ShiftStatusChip(status: ShiftStatus?) {
    val (label, icon, color) = when (status) {
        ShiftStatus.OPEN -> Triple("وردية مفتوحة", Icons.Default.LockOpen, Color(0xFF3FAE81))
        ShiftStatus.PENDING_CONFIRMATION -> Triple("بانتظار تأكيد المحاسب", Icons.Default.HourglassTop, Color(0xFFE0A75E))
        ShiftStatus.REJECTED -> Triple("عهدة سابقة مرفوضة", Icons.Default.Lock, Color(0xFFE07A5E))
        else -> Triple("لا توجد وردية مفتوحة", Icons.Default.Lock, Color.White.copy(alpha = 0.6f))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.9f))
    }
}

@Composable
private fun ShiftCheckingCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CircularProgressIndicator(strokeWidth = 3.dp)
            Spacer(Modifier.height(16.dp))
            Text("جارٍ التحقق من وجود وردية مفتوحة...", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ShiftCheckFailedCard(onRetry: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Default.WifiOff, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.size(32.dp))
            Spacer(Modifier.height(12.dp))
            Text("تعذّر التحقق من وجود وردية مفتوحة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onErrorContainer)
            Text(
                "لم نتمكن من الاتصال بالخادم — قد تكون لديك وردية مفتوحة بالفعل. لا تفتحي وردية جديدة قبل إعادة المحاولة.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.85f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp, bottom = 16.dp),
            )
            Button(onClick = onRetry, shape = RoundedCornerShape(16.dp)) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("إعادة المحاولة", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun NoShiftCard(busy: Boolean = false, onOpenShift: (openingUsd: Double, openingSyp: Double) -> Unit) {
    var openingUsd by remember { mutableStateOf("") }
    var openingSyp by remember { mutableStateOf("") }
    // Mandatory so the shift always starts with a clear, agreed float
    // amount — even "0" must be explicitly entered, never silently assumed.
    val valid = openingUsd.toDoubleOrNull() != null && openingSyp.toDoubleOrNull() != null

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier.size(64.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.PlayArrow, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.height(16.dp))
            Text("لا توجد وردية مفتوحة حالياً", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(
                "أدخلي المبلغ الافتتاحي المُستلم من المحاسب (العهدة) قبل بدء الوردية",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f),
                modifier = Modifier.padding(top = 6.dp, bottom = 16.dp),
                textAlign = TextAlign.Center,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = openingUsd,
                    onValueChange = { openingUsd = it },
                    label = { Text("افتتاحي USD") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    value = openingSyp,
                    onValueChange = { openingSyp = it },
                    label = { Text("افتتاحي SYP") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { onOpenShift(openingUsd.toDoubleOrNull() ?: 0.0, openingSyp.toDoubleOrNull() ?: 0.0) },
                enabled = valid && !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp),
            ) {
                Text(if (busy) "جارٍ الفتح..." else "فتح وردية", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun RejectedShiftCard(shift: Shift, busy: Boolean, onOpenShift: (openingUsd: Double, openingSyp: Double) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
                Text("رفض المحاسب تأكيد وردية سابقة", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onErrorContainer)
                if (!shift.rejectionReason.isNullOrBlank()) {
                    Text("السبب: ${shift.rejectionReason}", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.85f))
                }
            }
        }
        NoShiftCard(busy = busy, onOpenShift = onOpenShift)
    }
}

@Composable
private fun OpenShiftContent(shift: Shift, pendingCount: Int, busy: Boolean = false, onOpenLedger: () -> Unit, onCloseShift: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text("رصيد الوردية الحالي", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            shift.balances.forEach { balance ->
                BalanceCard(balance, modifier = Modifier.weight(1f))
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            onClick = onOpenLedger,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier.size(48.dp).background(MaterialTheme.colorScheme.tertiary.copy(alpha = 0.18f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ListAlt, contentDescription = null, tint = MaterialTheme.colorScheme.tertiary)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column {
                        Text("دفتر الشحن اليومي", fontWeight = FontWeight.Bold)
                        val subtitle = if (pendingCount > 0) {
                            "${shift.rowCount} سطر — $pendingCount بانتظار الإرسال"
                        } else {
                            "${shift.rowCount} سطر مُدخل اليوم"
                        }
                        Text(subtitle, style = MaterialTheme.typography.labelSmall, color = if (pendingCount > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        Button(
            onClick = onCloseShift,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary),
        ) {
            Icon(Icons.Default.Payments, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (busy) "جارٍ الإغلاق..." else "إغلاق الوردية", fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun PendingConfirmationCard(shift: Shift) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.HourglassTop, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                Spacer(Modifier.width(10.dp))
                Text("بانتظار تأكيد المحاسب", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Text(
                "أغلقت الوردية الساعة ${shift.closedAt}. لا يمكن فتح وردية جديدة حتى يؤكد المحاسب استلام المبلغ التالي:",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.85f),
                modifier = Modifier.padding(top = 10.dp, bottom = 16.dp),
            )
            shift.balances.forEach {
                Text("• ${currencyLabel(it.currencyCode)}: ${formatAmount(it.amount)}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Text("عدد السطور: ${shift.rowCount}", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.85f))
        }
    }
}

@Composable
private fun BalanceCard(balance: CurrencyBalance, modifier: Modifier = Modifier) {
    val accent = if (balance.currencyCode == "USD") MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary
    val container = if (balance.currencyCode == "USD") MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.primaryContainer
    val onContainer = if (balance.currencyCode == "USD") MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onPrimaryContainer

    Card(
        modifier = modifier.height(110.dp),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(currencyLabel(balance.currencyCode), style = MaterialTheme.typography.labelMedium, color = onContainer.copy(alpha = 0.8f))
            Text(formatAmount(balance.amount), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = accent)
        }
    }
}

private fun currencyLabel(code: String) = when (code) {
    "SYP" -> "ليرة سورية"
    "USD" -> "دولار أمريكي"
    else -> code
}

private fun formatAmount(amount: Double): String {
    val rounded = "%.2f".format(amount).trimEnd('0').trimEnd('.')
    return if (rounded.isEmpty()) "0" else rounded
}
