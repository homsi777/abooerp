package com.example.ui.documentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.AgentDocumentationSummary
import com.example.ui.documentationTransitLabel
import com.example.ui.formatDate
import com.example.ui.formatIsoDateOnly
import com.example.ui.safeText

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentationScreen(
    viewModel: DocumentationViewModel,
    onBack: () -> Unit,
    onOpenDetail: (String) -> Unit,
) {
    val listState by viewModel.listState.collectAsStateWithLifecycle()
    val transitFilter by viewModel.transitFilter.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("التوثيق") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                        }
                    },
                    actions = {
                        IconButton(onClick = viewModel::loadDocumentation) {
                            Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                        }
                    },
                )
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = transitFilter == DocumentationTransitFilter.ALL,
                        onClick = { viewModel.setTransitFilter(DocumentationTransitFilter.ALL) },
                        label = { Text("الكل") },
                    )
                    FilterChip(
                        selected = transitFilter == DocumentationTransitFilter.ACTIVE,
                        onClick = { viewModel.setTransitFilter(DocumentationTransitFilter.ACTIVE) },
                        label = { Text("في الطريق") },
                    )
                    FilterChip(
                        selected = transitFilter == DocumentationTransitFilter.HISTORICAL,
                        onClick = { viewModel.setTransitFilter(DocumentationTransitFilter.HISTORICAL) },
                        label = { Text("سابقة") },
                    )
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = listState is DocumentationListState.Loading,
            onRefresh = viewModel::loadDocumentation,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Box(Modifier.fillMaxSize()) {
                when (val current = listState) {
                    DocumentationListState.Loading -> {
                        CircularProgressIndicator(Modifier.align(Alignment.Center))
                    }
                    is DocumentationListState.Error -> {
                        Column(
                            Modifier
                                .align(Alignment.Center)
                                .padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(current.message, color = MaterialTheme.colorScheme.error)
                            Spacer(Modifier.height(12.dp))
                            Button(onClick = viewModel::loadDocumentation) { Text("إعادة المحاولة") }
                        }
                    }
                    is DocumentationListState.Success -> {
                        if (current.items.isEmpty()) {
                            Text(
                                "لا توجد وثائق شحن موجهة إليك في هذه الفترة",
                                modifier = Modifier
                                    .align(Alignment.Center)
                                    .padding(24.dp),
                            )
                        } else {
                            LazyColumn(
                                contentPadding = PaddingValues(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                items(current.items, key = { it.id }) { item ->
                                    DocumentationCard(item) { onOpenDetail(item.id) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DocumentationCard(item: AgentDocumentationSummary, onClick: () -> Unit) {
    val statusLabel = item.transitStatusLabel?.takeIf { it.isNotBlank() }
        ?: documentationTransitLabel(item.transitStatus)
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.LocalShipping, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(
                        safeText(item.driverLabel ?: "بدون سائق"),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                AssistChip(onClick = {}, label = { Text(statusLabel) })
            }
            Text("تاريخ الدفتر: ${formatIsoDateOnly(item.ledgerDate)}")
            Text("من: ${safeText(item.originLabel ?: item.branchName)}")
            Text("الجهة: ${safeText(item.destinationLabel)}")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("أسطر: ${item.rowCount ?: 0}")
                Text("طرود: ${item.piecesCount ?: 0}")
                Text("تحصيل: ${safeText(item.collectTotalUsd)} $")
            }
            Text(
                "طُبع: ${formatDate(item.printedAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
