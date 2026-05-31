package com.example.ui.shipments

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.Shipment
import com.example.data.ShipmentActionRequest
import com.example.data.ShipmentPortalDetails
import com.example.data.CreateShipmentRequest
import com.example.network.ApiService
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class ShipmentsState {
    object Loading : ShipmentsState()
    data class Success(val shipments: List<Shipment>) : ShipmentsState()
    data class Error(val message: String) : ShipmentsState()
}

class ShipmentsViewModel(private val apiService: ApiService) : ViewModel() {
    private val _uiState = MutableStateFlow<ShipmentsState>(ShipmentsState.Loading)
    val uiState: StateFlow<ShipmentsState> = _uiState.asStateFlow()

    private val _actionState = MutableStateFlow<String?>(null)
    val actionState: StateFlow<String?> = _actionState.asStateFlow()
    private val _details = MutableStateFlow<Map<String, ShipmentPortalDetails>>(emptyMap())
    val details: StateFlow<Map<String, ShipmentPortalDetails>> = _details.asStateFlow()

    init {
        loadShipments()
    }

    fun loadShipments() {
        viewModelScope.launch {
            _uiState.value = ShipmentsState.Loading
            try {
                val res = apiService.getShipments()
                if (res.success && res.data != null) {
                    _uiState.value = ShipmentsState.Success(res.data)
                } else {
                    _uiState.value = ShipmentsState.Error(res.error ?: "خطأ في تحميل الشحنات")
                }
            } catch (e: retrofit2.HttpException) {
                if (e.code() == 401) {
                    _uiState.value = ShipmentsState.Error("انتهت الجلسة، يرجى تسجيل الدخول مجدداً")
                } else if (e.code() >= 500) {
                    _uiState.value = ShipmentsState.Error("حدث خطأ في الخادم")
                } else {
                    _uiState.value = ShipmentsState.Error("استجابة غير متوقعة من الخادم")
                }
            } catch (e: Exception) {
                if (e.message?.contains("401") == true || e.message?.contains("Unauthorized") == true) {
                    _uiState.value = ShipmentsState.Error("انتهت الجلسة، يرجى تسجيل الدخول مجدداً")
                } else if (e is IOException) {
                    _uiState.value = ShipmentsState.Error("تعذر الاتصال بالخادم")
                } else {
                    _uiState.value = ShipmentsState.Error("استجابة غير متوقعة من الخادم")
                }
            }
        }
    }

    fun markAgentReceived(id: String) = performAction(id) { apiService.markAgentReceived(id, ShipmentActionRequest()) }
    fun markInTransit(id: String) = performAction(id) { apiService.markInTransit(id, ShipmentActionRequest()) }
    fun markArrived(id: String) = performAction(id) { apiService.markArrived(id, ShipmentActionRequest()) }
    fun markOutForDelivery(id: String) = performAction(id) { apiService.markOutForDelivery(id, ShipmentActionRequest()) }
    fun deliverShipment(id: String, note: String) = performAction(id) { apiService.deliverShipment(id, ShipmentActionRequest(note)) }
    fun requestReturnShipment(id: String, reason: String) = performAction(id) { apiService.requestReturnShipment(id, ShipmentActionRequest(reason)) }
    fun markReturnedShipment(id: String) = performAction(id) { apiService.markReturnedShipment(id, ShipmentActionRequest()) }

    fun createShipment(request: CreateShipmentRequest) {
        viewModelScope.launch {
            _actionState.value = "جاري إنشاء الشحنة..."
            try {
                val response = apiService.createShipment(request)
                if (response.success) {
                    _actionState.value = "تم إنشاء الشحنة بنجاح"
                    loadShipments()
                } else {
                    _actionState.value = response.error ?: "تعذر إنشاء الشحنة"
                }
            } catch (e: Exception) {
                _actionState.value = if (e is IOException) "تعذر الاتصال بالخادم" else "تعذر إنشاء الشحنة"
            }
        }
    }

    fun loadShipmentDetails(id: String) {
        viewModelScope.launch {
            try {
                val response = apiService.getShipmentDetails(id)
                if (response.success && response.data != null) {
                    _details.value = _details.value + (id to response.data)
                }
            } catch (_: Exception) {
                // The list row remains a safe fallback if the detail endpoint is temporarily unavailable.
            }
        }
    }

    private fun performAction(id: String, action: suspend () -> com.example.data.ApiResponse<Unit>) {
        viewModelScope.launch {
            _actionState.value = "جاري تنفيذ العملية..."
            try {
                val response = action()
                if (response.success) {
                    _actionState.value = "تمت العملية بنجاح"
                    loadShipments() // Refresh data
                } else {
                    _actionState.value = response.error ?: "حدث خطأ أثناء التنفيذ"
                }
            } catch (e: Exception) {
                _actionState.value = if (e is IOException) "تعذر الاتصال بالخادم" else "تعذر تنفيذ العملية"
            }
        }
    }

    fun clearActionState() {
        _actionState.value = null
    }

    class Factory(private val apiService: ApiService) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return ShipmentsViewModel(apiService) as T
        }
    }
}
