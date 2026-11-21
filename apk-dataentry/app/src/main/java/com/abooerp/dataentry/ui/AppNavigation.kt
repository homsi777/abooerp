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

    // The manager account has no shift/ledger entry: it lands straight on the
    // records screen, which is where it can browse and export every
    // employee's rows.
    val homeRoute: Any = if (container.authStorage.isManager()) HistoryRoute else ShiftDashboardRoute
    val startDestination: Any = if (container.authStorage.getAccessToken() != null) homeRoute else LoginRoute
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
                    val target: Any = if (container.authStorage.isManager()) HistoryRoute else ShiftDashboardRoute
                    navController.navigate(target) {
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
                queueStorage = container.ledgerQueueStorage,
                onBack = { navController.popBackStack() },
                onLogout = {
                    authViewModel.logout()
                    navController.navigate(LoginRoute) {
                        popUpTo(navController.graph.id) { inclusive = true }
                    }
                },
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
