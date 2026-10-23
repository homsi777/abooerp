package com.abooerp.dataentry.ui.history

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Inventory2
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
    onBack: () -> Unit,
) {
    val dateFormat = remember { SimpleDateFormat("yyyy-MM-dd", Locale.US) }
    var selectedDateMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    var showDatePicker by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var rows by remember { mutableStateOf<List<LedgerRowRemote>>(emptyList()) }
    val scope = rememberCoroutineScope()

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
                val response = apiService.getLedgerRows(branchId, dateIso, dateIso, TABLET_INTAKE_LINE_LABEL)
                if (response.success && response.data != null) {
                    rows = response.data.sortedByDescending { it.rowNo }
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
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
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
                    Text("لا توجد سجلات في هذا التاريخ", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> LazyColumn {
                    item {
                        Text(
                            "${rows.size} سطر",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                    items(rows, key = { it.id }) { row -> HistoryRowLine(row) }
                }
            }
        }
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
private fun HistoryRowLine(row: LedgerRowRemote) {
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
