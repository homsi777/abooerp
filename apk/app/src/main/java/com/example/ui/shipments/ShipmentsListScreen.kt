package com.example.ui.shipments

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import com.example.data.Shipment
import com.example.ui.formatDate
import com.example.ui.money
import com.example.ui.safeText
import com.example.ui.statusLabel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShipmentsListScreen(viewModel: ShipmentsViewModel, onBack: () -> Unit, onShipmentClick: (Shipment) -> Unit) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("الشحنات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
                actions = {
                    IconButton(onClick = viewModel::loadShipments) { Icon(Icons.Default.Refresh, contentDescription = "تحديث") }
                },
            )
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
                        Text("لا توجد شحنات حالياً", modifier = Modifier.align(Alignment.Center))
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
