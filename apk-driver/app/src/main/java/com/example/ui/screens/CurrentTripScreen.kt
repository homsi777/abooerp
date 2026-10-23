package com.example.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.DirectionsRun
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.BatterySaver
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.DirectionsBus
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Scale
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.example.R
import com.example.data.model.ShipmentItem
import com.example.data.model.TripData
import com.example.ui.components.BackgroundLocationExplanationDialog
import com.example.ui.components.BatteryOptimizationDialog
import com.example.ui.components.FineLocationPermissionExplanationDialog
import com.example.ui.components.NotificationPermissionExplanationDialog
import com.example.ui.theme.ForestGreenDark
import com.example.ui.theme.ForestGreenLight
import com.example.ui.theme.ForestGreenPrimary
import com.example.ui.theme.GoldAccent
import com.example.ui.theme.GoldDark
import com.example.ui.theme.SkyBlueDark
import com.example.ui.theme.SkyBlueLight
import com.example.ui.theme.SkyBlueNavy
import com.example.ui.theme.SkyBluePrimary
import com.example.ui.theme.SkyBlueSoft
import com.example.ui.theme.StatusAmber
import com.example.ui.theme.StatusAmberBg
import com.example.ui.theme.StatusBlue
import com.example.ui.theme.StatusBlueBg
import com.example.ui.theme.StatusGreen
import com.example.ui.theme.StatusGreenBg
import com.example.ui.viewmodel.DriverUiState
import com.example.ui.viewmodel.DriverViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CurrentTripScreen(
    state: DriverUiState,
    pendingPingsCount: Int,
    viewModel: DriverViewModel,
    onLogoutClick: () -> Unit
) {
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.statusMessage) {
        state.statusMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearStatusMessage()
        }
    }

    // Permission Launchers
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            checkAndRequestLocationPermissions(context, viewModel)
        }
    }

    val fineLocationLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true
        if (fineGranted) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val bgGranted = ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                if (!bgGranted) {
                    viewModel.setBackgroundLocationDialogVisible(true)
                } else {
                    state.currentTrip?.let { viewModel.startTracking(context, it.id) }
                }
            } else {
                state.currentTrip?.let { viewModel.startTracking(context, it.id) }
            }
        }
    }

    val bgLocationLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { _ ->
        state.currentTrip?.let { viewModel.startTracking(context, it.id) }
    }

    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            topBar = {
                CenterAlignedTopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(Color.White)
                                    .border(1.5.dp, SkyBluePrimary, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Image(
                                    painter = painterResource(id = R.drawable.company_logo),
                                    contentDescription = null,
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Crop
                                )
                            }
                            Spacer(modifier = Modifier.width(10.dp))
                            Column {
                                Text(
                                    text = stringResource(R.string.current_trip_title),
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = SkyBlueDark
                                )
                                Text(
                                    text = "${stringResource(R.string.welcome_driver)} ${state.driverUsername}",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = { viewModel.loadCurrentTrip() },
                            modifier = Modifier.testTag("refresh_button")
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.refresh_trip),
                                tint = SkyBluePrimary
                            )
                        }
                        IconButton(
                            onClick = onLogoutClick,
                            modifier = Modifier.testTag("logout_button")
                        ) {
                            Icon(
                                imageVector = Icons.Default.ExitToApp,
                                contentDescription = stringResource(R.string.logout),
                                tint = Color(0xFFDC2626)
                            )
                        }
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = Color.White
                    )
                )
            },
            containerColor = MaterialTheme.colorScheme.background
        ) { paddingValues ->
            if (state.isTripLoading && state.currentTrip == null) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = ForestGreenPrimary)
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "جارٍ تحميل بيانات الرحلة...",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else if (state.currentTrip != null) {
                TripContent(
                    trip = state.currentTrip,
                    state = state,
                    pendingPingsCount = pendingPingsCount,
                    paddingValues = paddingValues,
                    onToggleTracking = {
                        if (state.isTracking) {
                            viewModel.stopTracking(context, state.currentTrip.id)
                        } else {
                            handleStartTrackingPermissions(context, viewModel)
                        }
                    },
                    onOpenBatterySettings = {
                        viewModel.setBatteryDialogVisible(true)
                    }
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(24.dp)
                    ) {
                        val isError = !state.tripError.isNullOrBlank()
                        Icon(
                            imageVector = if (isError) Icons.Default.Warning else Icons.Default.DirectionsBus,
                            contentDescription = null,
                            tint = if (isError) Color(0xFFC81E1E) else MaterialTheme.colorScheme.outline,
                            modifier = Modifier.size(64.dp)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = state.tripError ?: stringResource(R.string.no_active_trip),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            color = if (isError) Color(0xFFC81E1E) else MaterialTheme.colorScheme.onSurface
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(
                            onClick = { viewModel.loadCurrentTrip() },
                            colors = ButtonDefaults.buttonColors(containerColor = ForestGreenPrimary)
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(stringResource(R.string.refresh_trip))
                        }
                    }
                }
            }
        }

        // Dialogs for permissions
        if (state.showNotificationPermissionDialog) {
            NotificationPermissionExplanationDialog(
                onConfirm = {
                    viewModel.setNotificationDialogVisible(false)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        checkAndRequestLocationPermissions(context, viewModel)
                    }
                },
                onDismiss = { viewModel.setNotificationDialogVisible(false) }
            )
        }

        if (state.showFineLocationPermissionDialog) {
            FineLocationPermissionExplanationDialog(
                onConfirm = {
                    viewModel.setFineLocationDialogVisible(false)
                    fineLocationLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                },
                onDismiss = { viewModel.setFineLocationDialogVisible(false) }
            )
        }

        if (state.showBackgroundLocationPermissionDialog) {
            BackgroundLocationExplanationDialog(
                onConfirm = {
                    viewModel.setBackgroundLocationDialogVisible(false)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        bgLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    }
                },
                onDismiss = { viewModel.setBackgroundLocationDialogVisible(false) }
            )
        }

        if (state.showBatteryOptimizationDialog) {
            BatteryOptimizationDialog(
                onDismiss = { viewModel.setBatteryDialogVisible(false) }
            )
        }
    }
}

private fun handleStartTrackingPermissions(context: Context, viewModel: DriverViewModel) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val notifGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!notifGranted) {
            viewModel.setNotificationDialogVisible(true)
            return
        }
    }
    checkAndRequestLocationPermissions(context, viewModel)
}

private fun checkAndRequestLocationPermissions(context: Context, viewModel: DriverViewModel) {
    val fineGranted = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED

    if (!fineGranted) {
        viewModel.setFineLocationDialogVisible(true)
        return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val bgGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (!bgGranted) {
            viewModel.setBackgroundLocationDialogVisible(true)
            return
        }
    }

    viewModel.uiState.value.currentTrip?.let {
        viewModel.startTracking(context, it.id)
    }
}

@Composable
private fun TripContent(
    trip: TripData,
    state: DriverUiState,
    pendingPingsCount: Int,
    paddingValues: PaddingValues,
    onToggleTracking: () -> Unit,
    onOpenBatterySettings: () -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(paddingValues),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Demo Mode Warning Banner
        if (state.isDemoMode) {
            item {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = Color(0xFFFFF3CD),
                    border = BorderStroke(1.5.dp, Color(0xFFF59E0B)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("demo_mode_banner")
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = Color(0xFFB45309),
                            modifier = Modifier.size(28.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text(
                                text = stringResource(R.string.demo_mode_banner_title),
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                                color = Color(0xFF92400E)
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = stringResource(R.string.demo_mode_banner_desc),
                                fontSize = 11.sp,
                                lineHeight = 16.sp,
                                color = Color(0xFFB45309)
                            )
                        }
                    }
                }
            }
        }

        // 1. Trip Header Card
        item {
            TripHeaderCard(trip = trip)
        }

        // 2. Tracking Controller Card (Start/Stop, Pulsing indicator, Offline queue status)
        item {
            TrackingControlCard(
                isTracking = state.isTracking,
                lastPingTime = state.lastPingTime,
                lastLocation = state.lastLocation,
                pendingPingsCount = pendingPingsCount,
                onToggleTracking = onToggleTracking,
                onOpenBatterySettings = onOpenBatterySettings
            )
        }

        // 3. Shipment lines header
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = stringResource(R.string.shipments_list_title),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        color = ForestGreenDark
                    )
                    Text(
                        text = stringResource(R.string.shipments_list_subtitle),
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = ForestGreenPrimary.copy(alpha = 0.12f)
                ) {
                    Text(
                        text = "${trip.shipments.size} شحنات",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        color = ForestGreenPrimary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // 4. Shipment items cards
        items(trip.shipments, key = { it.id }) { item ->
            ShipmentItemCard(shipment = item)
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
fun TripHeaderCard(trip: TripData) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(3.dp, RoundedCornerShape(18.dp)),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.LocalShipping,
                        contentDescription = null,
                        tint = ForestGreenPrimary,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = trip.tripNumber,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        color = ForestGreenDark
                    )
                }

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = GoldAccent.copy(alpha = 0.2f)
                ) {
                    Text(
                        text = trip.date,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = GoldDark
                    )
                }
            }

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 12.dp),
                color = MaterialTheme.colorScheme.surfaceVariant
            )

            // Route representation: Aleppo -> Raqqa -> Hasakah -> Qamishli
            Text(
                text = stringResource(R.string.trip_route),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Origin -> Stops
            RouteFlowView(
                origin = trip.originCity,
                destinations = trip.destinationCities
            )
        }
    }
}

@Composable
fun RouteFlowView(origin: String, destinations: List<String>) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // Origin
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .background(ForestGreenPrimary, CircleShape)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = origin,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = ForestGreenDark
                )
            }

            // Connecting dots & destinations
            destinations.forEachIndexed { index, city ->
                Box(
                    modifier = Modifier
                        .padding(start = 5.dp)
                        .width(2.dp)
                        .height(14.dp)
                        .background(GoldAccent)
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val isFinal = index == destinations.lastIndex
                    val dotColor = if (isFinal) Color(0xFFC81E1E) else GoldDark
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .background(dotColor, CircleShape)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = city,
                        fontSize = 13.sp,
                        fontWeight = if (isFinal) FontWeight.Bold else FontWeight.Medium,
                        color = if (isFinal) Color(0xFFC81E1E) else MaterialTheme.colorScheme.onSurface
                    )
                    if (isFinal) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "(الوجهة النهائية)",
                            fontSize = 10.sp,
                            color = Color(0xFFC81E1E)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun TrackingControlCard(
    isTracking: Boolean,
    lastPingTime: String?,
    lastLocation: android.location.Location?,
    pendingPingsCount: Int,
    onToggleTracking: () -> Unit,
    onOpenBatterySettings: () -> Unit
) {
    // Pulse animation for active radar dot
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val alphaAnim by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(800),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_alpha"
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(3.dp, RoundedCornerShape(18.dp)),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color.White
        ),
        border = BorderStroke(1.5.dp, if (isTracking) SkyBluePrimary else Color(0xFFE2E8F0))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp)
        ) {
            // Live Status Banner
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(16.dp)
                            .alpha(if (isTracking) alphaAnim else 1f)
                            .background(
                                color = if (isTracking) StatusGreen else Color(0xFF9E9E9E),
                                shape = CircleShape
                            )
                            .border(
                                2.dp,
                                if (isTracking) Color(0xFFB7E4C7) else Color.Transparent,
                                CircleShape
                            )
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = if (isTracking) stringResource(R.string.tracking_active) else stringResource(R.string.tracking_inactive),
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            color = SkyBlueDark
                        )
                        Text(
                            text = if (isTracking) "يتم إرسال إحداثيات GPS للخادم دورياً" else "اضغط الزر بالأسفل لبدء إرسال موقعك",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // Battery optimization reminder button
                IconButton(
                    onClick = onOpenBatterySettings,
                    modifier = Modifier.testTag("battery_opt_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.BatterySaver,
                        contentDescription = stringResource(R.string.battery_optimization_title),
                        tint = SkyBluePrimary
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // GPS & Offline Queue Telemetry
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color(0xFFF0F9FF)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp)
                ) {
                    // Last Ping info
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = if (lastPingTime != null) "آخر تحديث: $lastPingTime" else "بانتظار التقاط الموقع الأول...",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        if (lastLocation != null) {
                            Text(
                                text = "دقة: ${"%.0f".format(lastLocation.accuracy)} م",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = SkyBlueDark
                            )
                        }
                    }

                    if (lastLocation != null) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "الإحداثيات: ${"%.4f".format(lastLocation.latitude)}° N, ${"%.4f".format(lastLocation.longitude)}° E",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Spacer(modifier = Modifier.height(6.dp))

                    // Queue status
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (pendingPingsCount > 0) {
                            Icon(
                                imageVector = Icons.Default.CloudOff,
                                contentDescription = null,
                                tint = StatusAmber,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "$pendingPingsCount ${stringResource(R.string.offline_pings_queued)}",
                                fontSize = 11.sp,
                                color = StatusAmber,
                                fontWeight = FontWeight.SemiBold
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.CloudDone,
                                contentDescription = null,
                                tint = StatusGreen,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = stringResource(R.string.all_synced),
                                fontSize = 11.sp,
                                color = SkyBlueNavy
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Main Action Button (Large, bold, high-contrast)
            Button(
                onClick = onToggleTracking,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp)
                    .testTag(if (isTracking) "stop_tracking_button" else "start_tracking_button"),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (isTracking) Color(0xFFDC2626) else SkyBluePrimary
                )
            ) {
                Icon(
                    imageVector = if (isTracking) Icons.Default.StopCircle else Icons.Default.LocalShipping,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = if (isTracking) stringResource(R.string.stop_tracking) else stringResource(R.string.start_tracking),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }
        }
    }
}

@Composable
fun ShipmentItemCard(shipment: ShipmentItem) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(2.dp, RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp)
        ) {
            // Receipt number & destination city
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = ForestGreenPrimary.copy(alpha = 0.08f)
                ) {
                    Text(
                        text = shipment.receiptNumber,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        color = ForestGreenPrimary
                    )
                }

                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = GoldAccent.copy(alpha = 0.25f)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Place,
                            contentDescription = null,
                            tint = GoldDark,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = shipment.destinationCity,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = GoldDark
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Sender & Receiver
            Row(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.sender),
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = shipment.senderName,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.receiver),
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = shipment.receiverName,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 10.dp),
                color = MaterialTheme.colorScheme.surfaceVariant
            )

            // Cargo details (Parcels & Weight) and Status badge
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Inventory2,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "${shipment.parcelCount} طرد • ${shipment.weightKg} كغ",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                // Status chip
                val (chipBg, chipTextColor) = when (shipment.status) {
                    "تم التسليم" -> Pair(StatusGreenBg, StatusGreen)
                    "جارٍ النقل" -> Pair(StatusBlueBg, StatusBlue)
                    else -> Pair(StatusAmberBg, StatusAmber)
                }

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = chipBg
                ) {
                    Text(
                        text = shipment.status,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = chipTextColor
                    )
                }
            }
        }
    }
}
