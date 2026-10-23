package com.example.ui.viewmodel

import android.content.Context
import android.location.Location
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.AbooDriverApp
import com.example.data.model.TripData
import com.example.data.repository.DriverRepository
import com.example.service.DriverLocationService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DriverUiState(
    val isLoggedIn: Boolean = false,
    val isDemoMode: Boolean = false,
    val driverUsername: String = "",
    val isLoading: Boolean = false,
    val loginError: String? = null,
    val currentTrip: TripData? = null,
    val isTripLoading: Boolean = false,
    val tripError: String? = null,
    val isTracking: Boolean = false,
    val lastPingTime: String? = null,
    val lastLocation: Location? = null,
    val lastPingSuccess: Boolean = true,
    val showServerSettingsDialog: Boolean = false,
    val serverUrlInput: String = "",
    val showNotificationPermissionDialog: Boolean = false,
    val showFineLocationPermissionDialog: Boolean = false,
    val showBackgroundLocationPermissionDialog: Boolean = false,
    val showBatteryOptimizationDialog: Boolean = false,
    val statusMessage: String? = null
)

class DriverViewModel(
    private val repository: DriverRepository = AbooDriverApp.instance.repository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        DriverUiState(
            isLoggedIn = repository.isUserLoggedIn,
            isDemoMode = repository.isDemoMode,
            driverUsername = repository.currentDriverUsername,
            isTracking = repository.isTrackingActive,
            serverUrlInput = AbooDriverApp.instance.tokenManager.baseUrl
        )
    )
    val uiState: StateFlow<DriverUiState> = _uiState.asStateFlow()

    val pendingPingsCount: StateFlow<Int> = repository.observePendingPingsCount()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    init {
        // Collect tracking state from service
        viewModelScope.launch {
            DriverLocationService.isServiceRunning.collect { running ->
                _uiState.update { it.copy(isTracking = running) }
            }
        }

        viewModelScope.launch {
            DriverLocationService.lastLocation.collect { loc ->
                _uiState.update { it.copy(lastLocation = loc) }
            }
        }

        viewModelScope.launch {
            DriverLocationService.lastPingTimeStr.collect { time ->
                _uiState.update { it.copy(lastPingTime = time) }
            }
        }

        viewModelScope.launch {
            DriverLocationService.lastSentSuccess.collect { success ->
                _uiState.update { it.copy(lastPingSuccess = success) }
            }
        }

        if (repository.isUserLoggedIn) {
            loadCurrentTrip()
        }
    }

    fun login(username: String, pass: String) {
        if (username.isBlank() || pass.isBlank()) {
            _uiState.update { it.copy(loginError = "يرجى إدخال اسم المستخدم وكلمة المرور") }
            return
        }

        _uiState.update { it.copy(isLoading = true, loginError = null) }
        viewModelScope.launch {
            val result = repository.login(username.trim(), pass)
            result.fold(
                onSuccess = {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isLoggedIn = true,
                            isDemoMode = false,
                            driverUsername = username.trim(),
                            loginError = null
                        )
                    }
                    loadCurrentTrip()
                },
                onFailure = { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loginError = error.message ?: "فشل تسجيل الدخول، يرجى المحاولة لاحقاً"
                        )
                    }
                }
            )
        }
    }

    fun loginDemo() {
        repository.loginDemo("driver_omar")
        _uiState.update {
            it.copy(
                isLoggedIn = true,
                isDemoMode = true,
                driverUsername = "عمر (سائق الشاحنة)",
                loginError = null
            )
        }
        loadCurrentTrip()
    }

    fun logout(context: Context) {
        viewModelScope.launch {
            DriverLocationService.stop(context)
            repository.logout()
            _uiState.update {
                it.copy(
                    isLoggedIn = false,
                    isDemoMode = false,
                    currentTrip = null,
                    isTracking = false,
                    loginError = null
                )
            }
        }
    }

    fun loadCurrentTrip() {
        _uiState.update { it.copy(isTripLoading = true, tripError = null) }
        viewModelScope.launch {
            val result = repository.getCurrentTrip()
            result.fold(
                onSuccess = { trip ->
                    _uiState.update { it.copy(isTripLoading = false, currentTrip = trip) }
                },
                onFailure = { error ->
                    _uiState.update {
                        it.copy(
                            isTripLoading = false,
                            tripError = error.message ?: "تعذر تحميل بيانات الرحلة — يرجى التحقق من الاتصال بالخادم"
                        )
                    }
                }
            )
        }
    }

    fun startTracking(context: Context, tripId: String) {
        viewModelScope.launch {
            val result = repository.startTrip(tripId)
            result.fold(
                onSuccess = {
                    DriverLocationService.start(context, tripId)
                    _uiState.update {
                        it.copy(
                            isTracking = true,
                            statusMessage = "تم بدء تتبّع الرحلة بنجاح"
                        )
                    }
                },
                onFailure = { error ->
                    _uiState.update {
                        it.copy(
                            isTracking = false,
                            statusMessage = error.message ?: "تعذر بدء الرحلة — حاول مجدداً"
                        )
                    }
                }
            )
        }
    }

    fun stopTracking(context: Context, tripId: String) {
        viewModelScope.launch {
            val result = repository.endTrip(tripId)
            result.fold(
                onSuccess = {
                    DriverLocationService.stop(context)
                    _uiState.update {
                        it.copy(
                            isTracking = false,
                            statusMessage = "تم إنهاء الرحلة وإيقاف التتبّع"
                        )
                    }
                },
                onFailure = { error ->
                    _uiState.update {
                        it.copy(
                            statusMessage = error.message ?: "تعذر إنهاء الرحلة — حاول مجدداً"
                        )
                    }
                }
            )
        }
    }

    fun setServerSettingsDialogVisible(visible: Boolean) {
        _uiState.update {
            it.copy(
                showServerSettingsDialog = visible,
                serverUrlInput = AbooDriverApp.instance.tokenManager.baseUrl
            )
        }
    }

    fun updateServerUrl(newUrl: String) {
        val trimmed = newUrl.trim()
        if (trimmed.isNotEmpty()) {
            AbooDriverApp.instance.tokenManager.baseUrl = trimmed
            AbooDriverApp.instance.apiClient.invalidateCache()
            _uiState.update {
                it.copy(
                    showServerSettingsDialog = false,
                    serverUrlInput = trimmed,
                    statusMessage = "تم حفظ إعدادات عنوان الخادم"
                )
            }
        }
    }

    fun setNotificationDialogVisible(visible: Boolean) {
        _uiState.update { it.copy(showNotificationPermissionDialog = visible) }
    }

    fun setFineLocationDialogVisible(visible: Boolean) {
        _uiState.update { it.copy(showFineLocationPermissionDialog = visible) }
    }

    fun setBackgroundLocationDialogVisible(visible: Boolean) {
        _uiState.update { it.copy(showBackgroundLocationPermissionDialog = visible) }
    }

    fun setBatteryDialogVisible(visible: Boolean) {
        _uiState.update { it.copy(showBatteryOptimizationDialog = visible) }
    }

    fun clearStatusMessage() {
        _uiState.update { it.copy(statusMessage = null) }
    }
}
