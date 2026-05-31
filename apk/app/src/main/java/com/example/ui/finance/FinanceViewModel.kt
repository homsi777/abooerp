package com.example.ui.finance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.AccountStatement
import com.example.data.AgentTransfer
import com.example.data.FinancialStatement
import com.example.data.CreateAgentTransferRequest
import com.example.network.ApiService
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException

sealed class FinanceState {
    object Loading : FinanceState()
    data class Success(
        val financial: FinancialStatement,
        val account: AccountStatement,
        val transfers: List<AgentTransfer>,
        val transfersUnavailable: Boolean = false,
    ) : FinanceState()
    data class Error(val message: String) : FinanceState()
}

class FinanceViewModel(private val apiService: ApiService) : ViewModel() {
    private val _uiState = MutableStateFlow<FinanceState>(FinanceState.Loading)
    val uiState: StateFlow<FinanceState> = _uiState.asStateFlow()
    private val _actionMessage = MutableStateFlow<String?>(null)
    val actionMessage: StateFlow<String?> = _actionMessage.asStateFlow()

    init {
        loadData()
    }

    fun createTransfer(request: CreateAgentTransferRequest) {
        viewModelScope.launch {
            try {
                val response = apiService.createTransfer(request)
                _actionMessage.value = if (response.success) "تم إنشاء الحوالة وتسجيل قبضها بنجاح" else response.error ?: "تعذر إنشاء الحوالة"
                if (response.success) loadData()
            } catch (error: Exception) {
                _actionMessage.value = errorMessage(error)
            }
        }
    }

    fun completeTransfer(id: String) {
        viewModelScope.launch {
            try {
                val response = apiService.completeTransfer(id)
                _actionMessage.value = if (response.success) "تم تسليم الحوالة وترحيل سند الدفع بنجاح" else response.error ?: "تعذر تسليم الحوالة"
                if (response.success) loadData()
            } catch (error: Exception) {
                _actionMessage.value = errorMessage(error)
            }
        }
    }

    fun clearActionMessage() {
        _actionMessage.value = null
    }

    fun loadData() {
        viewModelScope.launch {
            _uiState.value = FinanceState.Loading
            try {
                val financialResponse = apiService.getFinancialStatement()
                val accountResponse = apiService.getAccountStatement()
                val financial = financialResponse.data
                val account = accountResponse.data
                if (!financialResponse.success || financial == null) {
                    _uiState.value = FinanceState.Error(financialResponse.error ?: "استجابة غير متوقعة من الخادم")
                    return@launch
                }
                if (!accountResponse.success || account == null) {
                    _uiState.value = FinanceState.Error(accountResponse.error ?: "استجابة غير متوقعة من الخادم")
                    return@launch
                }

                var transfers = emptyList<AgentTransfer>()
                var transfersUnavailable = false
                try {
                    val transfersResponse = apiService.getTransfers()
                    if (transfersResponse.success) {
                        transfers = transfersResponse.data?.items.orEmpty()
                    } else {
                        transfersUnavailable = true
                    }
                } catch (error: HttpException) {
                    if (error.code() == 404 || error.code() == 501) {
                        transfersUnavailable = true
                    } else {
                        throw error
                    }
                }
                _uiState.value = FinanceState.Success(financial, account, transfers, transfersUnavailable)
            } catch (error: Exception) {
                _uiState.value = FinanceState.Error(errorMessage(error))
            }
        }
    }

    private fun errorMessage(error: Exception): String = when {
        error is HttpException && error.code() == 401 -> "انتهت الجلسة، يرجى تسجيل الدخول مجدداً"
        error is HttpException && error.code() == 403 -> "ليس لديك صلاحية لعرض هذه البيانات"
        error is HttpException && (error.code() == 404 || error.code() == 501) -> "هذه الميزة غير متاحة حالياً من الخادم"
        error is IOException -> "تعذر الاتصال بالخادم"
        else -> "استجابة غير متوقعة من الخادم"
    }

    class Factory(private val apiService: ApiService) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return FinanceViewModel(apiService) as T
        }
    }
}
