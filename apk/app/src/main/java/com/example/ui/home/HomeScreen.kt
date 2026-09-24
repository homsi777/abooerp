package com.example.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.Money
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val HeroGradientTop = Color(0xFF12724F)
private val HeroGradientBottom = Color(0xFF0B4C34)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onNavigateToShipments: () -> Unit,
    onNavigateToFinance: () -> Unit,
    onNavigateToDocumentation: () -> Unit,
    onNavigateToProfile: () -> Unit,
    onLogout: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var accountMenuOpen by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp))
                    .background(
                        Brush.verticalGradient(listOf(HeroGradientTop, HeroGradientBottom)),
                    )
                    .padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 24.dp),
            ) {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .background(Color.White.copy(alpha = 0.16f), CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    Icons.Default.LocalShipping,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            Text(
                                "تطبيق الوكيل",
                                style = MaterialTheme.typography.labelLarge,
                                letterSpacing = 1.sp,
                                color = Color.White.copy(alpha = 0.9f),
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = viewModel::loadData) {
                                Icon(Icons.Default.Refresh, contentDescription = "تحديث", tint = Color.White)
                            }
                            Box {
                                Box(
                                    modifier = Modifier
                                        .size(40.dp)
                                        .background(Color.White.copy(alpha = 0.22f), CircleShape)
                                        .clickable { accountMenuOpen = true },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text("أ.م", style = MaterialTheme.typography.titleMedium, color = Color.White)
                                }
                                DropdownMenu(
                                    expanded = accountMenuOpen,
                                    onDismissRequest = { accountMenuOpen = false },
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("الملف الشخصي") },
                                        onClick = {
                                            accountMenuOpen = false
                                            onNavigateToProfile()
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("تسجيل الخروج", color = MaterialTheme.colorScheme.error) },
                                        onClick = {
                                            accountMenuOpen = false
                                            onLogout()
                                        },
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(20.dp))
                    Text(
                        "أهلاً بك 👋",
                        style = MaterialTheme.typography.labelLarge,
                        color = Color.White.copy(alpha = 0.75f),
                    )
                    Text(
                        "شركة عبو المحمود",
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.ExtraBold,
                        color = Color.White,
                        lineHeight = 40.sp,
                    )
                }
            }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state is HomeState.Loading,
            onRefresh = viewModel::loadData,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
              when (val s = state) {
                is HomeState.Loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                is HomeState.Error -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(text = s.message, color = MaterialTheme.colorScheme.error)
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { viewModel.loadData() }) {
                            Text("إعادة المحاولة")
                        }
                        if (s.message.contains("انتهت الجلسة") || s.message.contains("401")) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Button(
                                onClick = onLogout,
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                            ) {
                                Text("تسجيل الخروج")
                            }
                        }
                    }
                }
                is HomeState.Success -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(24.dp)
                    ) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            SummaryCard(
                                title = "إجمالي الشحنات",
                                value = s.summary.totals.all.toString(),
                                subtitle = "شحنة",
                                icon = Icons.AutoMirrored.Filled.ListAlt,
                                containerColor = MaterialTheme.colorScheme.primaryContainer,
                                onContainerColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                accentColor = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.weight(1f)
                            )
                            SummaryCard(
                                title = "شحنات نشطة",
                                value = s.summary.counts.agentReceived.toString(),
                                subtitle = "بانتظار الاستلام",
                                icon = Icons.Default.LocalShipping,
                                containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                                onContainerColor = MaterialTheme.colorScheme.onTertiaryContainer,
                                accentColor = MaterialTheme.colorScheme.tertiary,
                                modifier = Modifier.weight(1f)
                            )
                        }

                        Text(
                            "الإجراءات السريعة",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onBackground
                        )

                        LazyVerticalGrid(
                            columns = GridCells.Fixed(2),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            item {
                                QuickActionButton(
                                    "الشحنات", Icons.AutoMirrored.Filled.ListAlt,
                                    MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primaryContainer,
                                    onNavigateToShipments,
                                )
                            }
                            item {
                                QuickActionButton(
                                    "التوثيق", Icons.Filled.Description,
                                    MaterialTheme.colorScheme.tertiary, MaterialTheme.colorScheme.tertiaryContainer,
                                    onNavigateToDocumentation,
                                )
                            }
                            item {
                                QuickActionButton(
                                    "الحساب", Icons.Filled.Money,
                                    MaterialTheme.colorScheme.secondary, MaterialTheme.colorScheme.secondaryContainer,
                                    onNavigateToFinance,
                                )
                            }
                            item {
                                QuickActionButton(
                                    "الملف الشخصي", Icons.Filled.Person,
                                    MaterialTheme.colorScheme.onSurfaceVariant, MaterialTheme.colorScheme.surfaceVariant,
                                    onNavigateToProfile,
                                )
                            }
                        }

                        Card(
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 24.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                            shape = RoundedCornerShape(24.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                horizontalArrangement = Arrangement.spacedBy(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(48.dp)
                                        .background(MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.12f), RoundedCornerShape(14.dp)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                                }
                                Column {
                                    Text("تنبيه: تحديث البيانات", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                                    Text("يرجى مراجعة كشف الحساب المالي الأسبوعي للمصادقة.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
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

@Composable
fun SummaryCard(
    title: String,
    value: String,
    subtitle: String,
    icon: ImageVector,
    containerColor: Color,
    onContainerColor: Color,
    accentColor: Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.height(140.dp),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(title, style = MaterialTheme.typography.labelMedium, color = onContainerColor.copy(alpha = 0.85f))
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .background(accentColor.copy(alpha = 0.18f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = accentColor, modifier = Modifier.size(16.dp))
                }
            }
            Column {
                Text(value, style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Bold, color = onContainerColor)
                Text(subtitle, style = MaterialTheme.typography.labelSmall, color = onContainerColor.copy(alpha = 0.7f))
            }
        }
    }
}

@Composable
fun QuickActionButton(
    title: String,
    icon: ImageVector,
    accentColor: Color,
    containerColor: Color,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.aspectRatio(1f),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        shape = RoundedCornerShape(28.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .background(accentColor.copy(alpha = 0.16f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(imageVector = icon, contentDescription = title, modifier = Modifier.size(28.dp), tint = accentColor)
            }
            Spacer(modifier = Modifier.height(14.dp))
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        }
    }
}
