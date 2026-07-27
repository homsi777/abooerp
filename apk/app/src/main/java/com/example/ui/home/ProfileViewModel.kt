package com.example.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.AgentProfile
import com.example.network.ApiService
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class ProfileState {
    object Loading : ProfileState()
    data class Success(val profile: AgentProfile) : ProfileState()
    data class Error(val message: String) : ProfileState()
}

class ProfileViewModel(private val apiService: ApiService) : ViewModel() {
    private val _uiState = MutableStateFlow<ProfileState>(ProfileState.Loading)
    val uiState: StateFlow<ProfileState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    fun loadData() {
        viewModelScope.launch {
            _uiState.value = ProfileState.Loading
            try {
                val res = apiService.getProfile()
                if (res.success && res.data != null) {
                    _uiState.value = ProfileState.Success(res.data.agent)
                } else {
                    _uiState.value = ProfileState.Error(res.error ?: "خطأ في تحميل الملف الشخصي")
                }
            } catch (e: retrofit2.HttpException) {
                if (e.code() == 401) {
                    _uiState.value = ProfileState.Error("انتهت الجلسة، يرجى تسجيل الدخول مجدداً")
                } else if (e.code() >= 500) {
                    _uiState.value = ProfileState.Error("حدث خطأ في الخادم")
                } else {
                    _uiState.value = ProfileState.Error("استجابة غير متوقعة من الخادم")
                }
            } catch (e: Exception) {
                if (e.message?.contains("401") == true || e.message?.contains("Unauthorized") == true) {
                    _uiState.value = ProfileState.Error("انتهت الجلسة، يرجى تسجيل الدخول مجدداً")
                } else if (e is IOException) {
                    _uiState.value = ProfileState.Error("تعذر الاتصال بالخادم")
                } else {
                    _uiState.value = ProfileState.Error("استجابة غير متوقعة من الخادم")
                }
            }
        }
    }

    class Factory(private val apiService: ApiService) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return ProfileViewModel(apiService) as T
        }
    }
}
