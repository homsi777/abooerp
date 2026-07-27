package com.example.ui.documentation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.formatDate
import com.example.ui.formatIsoDateOnly
import com.example.ui.safeText

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentationDetailScreen(
    viewModel: DocumentationViewModel,
    onBack: () -> Unit,
) {
    val detailState by viewModel.detailState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("تفاصيل التوثيق") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (val current = detailState) {
                null, DocumentationDetailState.Loading -> {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
                is DocumentationDetailState.Error -> {
                    Column(
                        Modifier
                            .align(Alignment.Center)
                            .padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(current.message, color = MaterialTheme.colorScheme.error)
                    }
                }
                is DocumentationDetailState.Success -> {
                    val detail = current.detail
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(
                                        safeText(detail.title ?: detail.driverLabel),
                                        style = MaterialTheme.typography.titleLarge,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    Text("الحالة: ${safeText(detail.transitStatusLabel)}")
                                    Text("تاريخ الدفتر: ${formatIsoDateOnly(detail.ledgerDate)}")
                                    Text("السائق: ${safeText(detail.driverLabel)}")
                                    Text("الجهة: ${safeText(detail.destinationLabel)}")
                                    Text("الفرع: ${safeText(detail.branchName)}")
                                    Text("أسطر: ${detail.rowCount ?: 0} — طرود: ${detail.piecesCount ?: 0}")
                                    Text("تحصيل: ${safeText(detail.collectTotalUsd)} $")
                                    Text("طُبع: ${formatDate(detail.printedAt)}")
                                }
                            }
                        }
                        item {
                            Text("بضائعك في هذه الإرسالية", fontWeight = FontWeight.Bold)
                        }
                        val rows = detail.rowsSnapshot.orEmpty()
                        if (rows.isEmpty()) {
                            item { Text("لا توجد أسطر مطابقة") }
                        } else {
                            items(rows, key = { it.rowId ?: "${it.rowNo}-${it.receiptNo}" }) { row ->
                                Card(Modifier.fillMaxWidth()) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text("إيصال: ${safeText(row.receiptNo)}", fontWeight = FontWeight.SemiBold)
                                        Text("الجهة: ${safeText(row.destination)}")
                                        Text("مرسل: ${safeText(row.senderName)}")
                                        Text("مستلم: ${safeText(row.receiverName)}")
                                        Text("طرود: ${row.parcelCount ?: 0} — ${safeText(row.parcelType)}")
                                        Text("وزن: ${safeText(row.weightKg)} كغ")
                                        Text("تحصيل: ${safeText(row.collectAmountUsd)} $")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
