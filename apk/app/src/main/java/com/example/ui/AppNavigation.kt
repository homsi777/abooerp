package com.example.ui

import androidx.compose.runtime.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.example.AgentApplication
import com.example.ui.auth.AuthViewModel
import com.example.ui.auth.LoginScreen
import com.example.ui.finance.FinanceScreen
import com.example.ui.finance.FinanceViewModel
import com.example.ui.home.HomeScreen
import com.example.ui.home.HomeViewModel
import com.example.ui.home.ProfileScreen
import com.example.ui.home.ProfileViewModel
import com.example.ui.shipments.ShipmentDetailsScreen
import com.example.ui.shipments.ShipmentsListScreen
import com.example.ui.shipments.ShipmentsState
import com.example.ui.shipments.ShipmentsViewModel
import kotlinx.serialization.Serializable

@Serializable
object LoginRoute
@Serializable
object HomeRoute
@Serializable
object ProfileRoute
@Serializable
object ShipmentsRoute
@Serializable
data class ShipmentDetailsRoute(val id: String)
@Serializable
object FinanceRoute

@Composable
fun AppNavigation() {
    val context = LocalContext.current
    val appContainer = (context.applicationContext as AgentApplication).container
    val authViewModel: AuthViewModel = viewModel(factory = AuthViewModel.Factory(appContainer.apiService, appContainer.authStorage))

    val startDestination = if (appContainer.authStorage.getAccessToken() != null) HomeRoute else LoginRoute
    val navController = rememberNavController()

    // Create ViewModel scoped to NavHost (or parent) to share state
    val shipmentsViewModel: ShipmentsViewModel = viewModel(factory = ShipmentsViewModel.Factory(appContainer.apiService))

    NavHost(navController = navController, startDestination = startDestination) {
        composable<LoginRoute> {
            LoginScreen(
                viewModel = authViewModel,
                onLoginSuccess = {
                    navController.navigate(HomeRoute) {
                        popUpTo(LoginRoute) { inclusive = true }
                    }
                }
            )
        }
        
        composable<HomeRoute> {
            val homeViewModel: HomeViewModel = viewModel(factory = HomeViewModel.Factory(appContainer.apiService))
            HomeScreen(
                viewModel = homeViewModel,
                onNavigateToShipments = { navController.navigate(ShipmentsRoute) },
                onNavigateToFinance = { navController.navigate(FinanceRoute) },
                onNavigateToProfile = { navController.navigate(ProfileRoute) },
                onLogout = {
                    authViewModel.logout()
                    navController.navigate(LoginRoute) {
                        popUpTo(navController.graph.id) { inclusive = true }
                    }
                }
            )
        }

        composable<ProfileRoute> {
            val profileViewModel: ProfileViewModel = viewModel(factory = ProfileViewModel.Factory(appContainer.apiService))
            ProfileScreen(
                viewModel = profileViewModel,
                onBack = { navController.popBackStack() },
                onLogout = {
                    authViewModel.logout()
                    navController.navigate(LoginRoute) {
                        popUpTo(navController.graph.id) { inclusive = true }
                    }
                }
            )
        }
        
        composable<ShipmentsRoute> {
            ShipmentsListScreen(
                viewModel = shipmentsViewModel,
                onBack = { navController.popBackStack() },
                onShipmentClick = { shipment ->
                    navController.navigate(ShipmentDetailsRoute(shipment.id))
                }
            )
        }
        
        composable<ShipmentDetailsRoute> { backStackEntry ->
            val route: ShipmentDetailsRoute = backStackEntry.toRoute()
            val state by shipmentsViewModel.uiState.collectAsState()
            
            when (val shipmentState = state) {
                is ShipmentsState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                is ShipmentsState.Error -> ShipmentDetailsUnavailable(onBack = { navController.popBackStack() })
                is ShipmentsState.Success -> {
                    val shipment = shipmentState.shipments.find { it.id == route.id }
                    if (shipment != null) {
                        ShipmentDetailsScreen(
                            shipment = shipment,
                            viewModel = shipmentsViewModel,
                            onBack = { navController.popBackStack() }
                        )
                    } else {
                        ShipmentDetailsUnavailable(onBack = { navController.popBackStack() })
                    }
                }
            }
        }
        
        composable<FinanceRoute> {
            val financeViewModel: FinanceViewModel = viewModel(factory = FinanceViewModel.Factory(appContainer.apiService))
            FinanceScreen(
                viewModel = financeViewModel,
                onBack = { navController.popBackStack() },
                onOpenShipment = { shipmentId -> navController.navigate(ShipmentDetailsRoute(shipmentId)) },
            )
        }
    }
}

@Composable
private fun ShipmentDetailsUnavailable(onBack: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("تفاصيل الشحنة غير متاحة حالياً")
            Spacer(Modifier.height(12.dp))
            Button(onClick = onBack) { Text("رجوع") }
        }
    }
}
