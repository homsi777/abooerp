package com.abooerp.dataentry.ui.parcels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.abooerp.dataentry.data.ParcelRemote
import com.abooerp.dataentry.data.ParcelScanRequest
import com.abooerp.dataentry.network.ApiService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class ParcelScanState {
    object Idle : ParcelScanState()
    object Working : ParcelScanState()
    /** Found, showing what the next scan would do — nothing changed yet. */
    data class Found(val parcel: ParcelRemote) : ParcelScanState()
    /** The status was just advanced. */
    data class Moved(val parcel: ParcelRemote) : ParcelScanState()
    data class Error(val message: String) : ParcelScanState()
}

/**
 * Receive/deliver by scanning the QR on the parcel label.
 *
 * Looking up and advancing are deliberately two steps: the employee sees
 * which shipment the code resolved to, and what the scan is about to do,
 * before anything is recorded. Marking a parcel delivered is the company's
 * proof the goods left its hands — it should never happen from a stray
 * scan of a code lying on a desk.
 *
 * The server owns the state machine; this screen never names a target
 * status, which is what makes out-of-order and double scans impossible.
 */
class ParcelScanViewModel(private val apiService: ApiService) : ViewModel() {

    private val _state = MutableStateFlow<ParcelScanState>(ParcelScanState.Idle)
    val state: StateFlow<ParcelScanState> = _state.asStateFlow()

    fun reset() {
        _state.value = ParcelScanState.Idle
    }

    fun lookup(rawCode: String) {
        val code = rawCode.trim().toLongOrNull()
        if (code == null) {
            _state.value = ParcelScanState.Error("رمز غير صالح — يجب أن يكون رقم إيصال.")
            return
        }
        _state.value = ParcelScanState.Working
        viewModelScope.launch {
            try {
                val response = apiService.lookupParcel(code)
                val parcel = response.data
                _state.value = if (parcel != null) {
                    ParcelScanState.Found(parcel)
                } else {
                    ParcelScanState.Error(response.error ?: "لا توجد شحنة بهذا الرمز.")
                }
            } catch (e: Exception) {
                _state.value = ParcelScanState.Error(friendly(e))
            }
        }
    }

    fun confirm(code: Long, deliveredToName: String?) {
        _state.value = ParcelScanState.Working
        viewModelScope.launch {
            try {
                val response = apiService.scanParcel(
                    ParcelScanRequest(code = code, deliveredToName = deliveredToName?.takeIf { it.isNotBlank() }),
                )
                val parcel = response.data
                _state.value = if (parcel != null) {
                    ParcelScanState.Moved(parcel)
                } else {
                    _state.value = ParcelScanState.Error(response.error ?: "تعذر تحديث حالة الشحنة.")
                    return@launch
                }
            } catch (e: Exception) {
                _state.value = ParcelScanState.Error(friendly(e))
            }
        }
    }

    /** Scanning is useless offline — the status lives on the server and two
     *  branches must not disagree about it — so say so plainly instead of
     *  showing a raw network error. */
    private fun friendly(e: Exception): String {
        val message = e.message ?: ""
        return when {
            message.contains("Unable to resolve host", true) ||
                message.contains("timeout", true) ||
                message.contains("failed to connect", true) ->
                "لا يوجد اتصال بالخادم — المسح يحتاج إنترنت ليرى كل الفروع نفس الحالة."
            else -> "تعذر تنفيذ العملية: $message"
        }
    }

    class Factory(private val apiService: ApiService) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ParcelScanViewModel(apiService) as T
    }
}
