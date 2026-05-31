package com.example.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.AgentProfile
import com.example.data.WorkspaceSummary
import com.example.network.ApiService
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class HomeState {
    object Loading : HomeState()
    data class Success(val profile: AgentProfile, val summary: WorkspaceSummary) : HomeState()
    data class Error(val message: String) : HomeState()
}

class HomeViewModel(private val apiService: ApiService) : ViewModel() {

    private val _uiState = MutableStateFlow<HomeState>(HomeState.Loading)
    val uiState: StateFlow<HomeState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    fun loadData() {
        viewModelScope.launch {
            _uiState.value = HomeState.Loading
            try {
                val profileRes = apiService.getProfile()
                val summaryRes = apiService.getWorkspaceSummary()
                if (profileRes.success && summaryRes.success && profileRes.data != null && summaryRes.data != null) {
                    _uiState.value = HomeState.Success(profileRes.data.agent, summaryRes.data)
                } else {
                    _uiState.value = HomeState.Error(profileRes.error ?: summaryRes.error ?: "خطأ في تحميل البيانات")
                }
            } catch (e: retrofit2.HttpException) {
                if (e.code() == 401) {
                    _uiState.value = HomeState.Error("انتهت الجلسة، يرجى تسجيل الدخول مجدداً")
                } else if (e.code() >= 500) {
                    _uiState.value = HomeState.Error("حدث خطأ في الخادم")
                } else {
                    _uiState.value = HomeState.Error("استجابة غير متوقعة من الخادم")
                }
            } catch (e: Exception) {
                if (e.message?.contains("401") == true || e.message?.contains("Unauthorized") == true) {
                    _uiState.value = HomeState.Error("انتهت الجلسة، يرجى تسجيل الدخول مجدداً")
                } else if (e is IOException) {
                    _uiState.value = HomeState.Error("تعذر الاتصال بالخادم")
                } else {
                    _uiState.value = HomeState.Error("استجابة غير متوقعة من الخادم")
                }
            }
        }
    }

    class Factory(private val apiService: ApiService) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return HomeViewModel(apiService) as T
        }
    }
}
