package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.example.ui.screens.CurrentTripScreen
import com.example.ui.screens.LoginScreen
import com.example.ui.theme.MyApplicationTheme
import com.example.ui.viewmodel.DriverViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: DriverViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MyApplicationTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    DriverAppContent(viewModel = viewModel, onFinish = { finish() })
                }
            }
        }
    }
}

@Composable
fun DriverAppContent(
    viewModel: DriverViewModel,
    onFinish: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val pendingPings by viewModel.pendingPingsCount.collectAsState()

    if (!uiState.isLoggedIn) {
        LoginScreen(
            state = uiState,
            onLoginClick = { username, password ->
                viewModel.login(username, password)
            },
            onDemoLoginClick = {
                viewModel.loginDemo()
            },
            onOpenServerSettings = {
                viewModel.setServerSettingsDialogVisible(true)
            },
            onSaveServerSettings = { newUrl ->
                viewModel.updateServerUrl(newUrl)
            },
            onDismissServerSettings = {
                viewModel.setServerSettingsDialogVisible(false)
            }
        )
    } else {
        BackHandler {
            // Minimize or finish app rather than going back to login screen while logged in
            onFinish()
        }

        CurrentTripScreen(
            state = uiState,
            pendingPingsCount = pendingPings,
            viewModel = viewModel,
            onLogoutClick = {
                viewModel.logout(AbooDriverApp.instance)
            }
        )
    }
}
