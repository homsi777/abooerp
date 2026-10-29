package com.abooerp.dataentry.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.abooerp.dataentry.DataEntryApplication
import com.abooerp.dataentry.ui.auth.AuthViewModel
import com.abooerp.dataentry.ui.auth.LoginScreen
import com.abooerp.dataentry.ui.history.ShipmentHistoryScreen
import com.abooerp.dataentry.ui.ledger.LedgerEntryScreen
import com.abooerp.dataentry.ui.shift.ShiftDashboardScreen
import com.abooerp.dataentry.ui.shift.ShiftViewModel
import com.abooerp.dataentry.update.UpdateGate
import com.abooerp.dataentry.printer.PrinterSettingsScreen
import com.abooerp.dataentry.ui.parcels.ParcelScanScreen
import com.abooerp.dataentry.ui.parcels.ParcelScanViewModel
import kotlinx.serialization.Serializable

@Serializable object LoginRoute
@Serializable object ShiftDashboardRoute
@Serializable object LedgerRoute
@Serializable object HistoryRoute
@Serializable object PrinterSettingsRoute
@Serializable object ParcelScanRoute

@Composable
fun AppNavigation() {
    val context = LocalContext.current
    val container = (context.applicationContext as DataEntryApplication).container
    val authViewModel: AuthViewModel = viewModel(factory = AuthViewModel.Factory(container.apiService, container.authStorage))

    val startDestination = if (container.authStorage.getAccessToken() != null) ShiftDashboardRoute else LoginRoute
    val navController = rememberNavController()

    UpdateGate(container.apiService)

    val employeeName = container.authStorage.getEmployeeName() ?: "الموظف"
    val shiftViewModel: ShiftViewModel = viewModel(
        factory = ShiftViewModel.Factory(
            employeeName, container.apiService, container.authStorage, container.ledgerQueueStorage,
            container.printerManager, container.labelPrinter, container.receiptNumberStore,
        ),
    )

    NavHost(navController = navController, startDestination = startDestination) {
        composable<LoginRoute> {
            LoginScreen(
                viewModel = authViewModel,
                onLoginSuccess = {
                    navController.navigate(ShiftDashboardRoute) {
                        popUpTo(LoginRoute) { inclusive = true }
                    }
                },
            )
        }
        composable<ShiftDashboardRoute> {
            ShiftDashboardScreen(
                employeeName = employeeName,
                viewModel = shiftViewModel,
                onOpenLedger = { navController.navigate(LedgerRoute) },
                onOpenHistory = { navController.navigate(HistoryRoute) },
                onOpenParcelScan = { navController.navigate(ParcelScanRoute) },
                onLogout = {
                    authViewModel.logout()
                    navController.navigate(LoginRoute) {
                        popUpTo(navController.graph.id) { inclusive = true }
                    }
                },
            )
        }
        composable<LedgerRoute> {
            LedgerEntryScreen(
                viewModel = shiftViewModel,
                onBack = { navController.popBackStack() },
                onOpenPrinterSettings = { navController.navigate(PrinterSettingsRoute) },
            )
        }
        composable<HistoryRoute> {
            ShipmentHistoryScreen(
                apiService = container.apiService,
                authStorage = container.authStorage,
                onBack = { navController.popBackStack() },
            )
        }
        composable<ParcelScanRoute> {
            val parcelScanViewModel: ParcelScanViewModel = viewModel(factory = ParcelScanViewModel.Factory(container.apiService))
            ParcelScanScreen(
                viewModel = parcelScanViewModel,
                onBack = { navController.popBackStack() },
            )
        }
        composable<PrinterSettingsRoute> {
            PrinterSettingsScreen(
                printerManager = container.printerManager,
                labelPrinter = container.labelPrinter,
                authStorage = container.authStorage,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
