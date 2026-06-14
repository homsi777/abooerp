package com.example.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.AuthStorage
import com.example.data.LoginRequest
import com.example.network.ApiService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class AuthState {
    object Idle : AuthState()
    object Loading : AuthState()
    object Success : AuthState()
    data class Error(val message: String) : AuthState()
}

class AuthViewModel(
    private val apiService: ApiService,
    private val authStorage: AuthStorage
) : ViewModel() {

    private val _authState = MutableStateFlow<AuthState>(AuthState.Idle)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    init {
        checkLoginStatus()
    }

    private fun checkLoginStatus() {
        if (authStorage.getAccessToken() != null) {
            _authState.value = AuthState.Success
        }
    }

    fun login(username: String, pass: String) {
        if (username.isBlank() || pass.isBlank()) {
            _authState.value = AuthState.Error("الرجاء إدخال اسم المستخدم وكلمة المرور")
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Loading
            try {
                val response = apiService.login(LoginRequest(username, pass))
                if (response.success && response.data != null) {
                    val user = response.data.user
                    if (user.userType != "agent") {
                        _authState.value = AuthState.Error("غير مصرح بالدخول. التطبيق مخصص للوكلاء فقط.")
                    } else {
                        val session = response.data.session
                        authStorage.saveTokens(session.accessToken, session.refreshToken)
                        _authState.value = AuthState.Success
                    }
                } else {
                    val errorMsg = when (response.error) {
                        "DEVICE_NOT_REGISTERED" -> "الجهاز غير مصرح له بالدخول"
                        "Invalid username or password.", "Invalid username or password" -> "اسم المستخدم أو كلمة المرور غير صحيحة"
                        else -> response.error ?: "خطأ في بيانات الدخول"
                    }
                    _authState.value = AuthState.Error(errorMsg)
                }
            } catch (e: retrofit2.HttpException) {
                val errorBody = e.response()?.errorBody()?.string()
                val serverError = extractApiError(errorBody)
                val errorMessage = when {
                    serverError == "DEVICE_NOT_REGISTERED" -> "الجهاز غير مصرح له بالدخول"
                    serverError == "DEVICE_BLOCKED" -> "هذا الجهاز محظور"
                    serverError == "DEVICE_PENDING_APPROVAL" -> "الجهاز بانتظار موافقة الإدارة"
                    serverError == "Invalid username or password." ||
                        serverError == "Invalid username or password" ||
                        e.code() == 401 -> "اسم المستخدم أو كلمة المرور غير صحيحة"
                    e.code() >= 500 -> "حدث خطأ في الخادم"
                    !serverError.isNullOrBlank() -> serverError
                    else -> "استجابة غير متوقعة من الخادم"
                }
                _authState.value = AuthState.Error(errorMessage)
            } catch (e: java.io.IOException) {
                _authState.value = AuthState.Error("تعذر الاتصال بالخادم")
            } catch (e: Exception) {
                val errorMessage = when {
                    e.message?.contains("DEVICE_NOT_REGISTERED") == true -> "الجهاز غير مصرح له بالدخول"
                    e.message?.contains("Expected") == true || e.message?.contains("Non-null") == true ->
                        "تعذّر قراءة استجابة الخادم — تأكد من نشر آخر إصدار للـ API"
                    else -> "استجابة غير متوقعة من الخادم"
                }
                _authState.value = AuthState.Error(errorMessage)
            }
        }
    }

    fun logout() {
        val refreshToken = authStorage.getRefreshToken() ?: ""
        authStorage.clear()
        _authState.value = AuthState.Idle
        viewModelScope.launch {
            try {
                apiService.logout(com.example.data.LogoutRequest(refreshToken))
            } catch (e: Exception) {
                // Ignore logout network errors
            }
        }
    }

    fun resetState() {
        if (_authState.value is AuthState.Error) {
            _authState.value = AuthState.Idle
        }
    }

    private fun extractApiError(errorBody: String?): String? {
        if (errorBody.isNullOrBlank()) return null
        val match = """"error"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex().find(errorBody) ?: return null
        return match.groupValues[1]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    }

    class Factory(
        private val apiService: ApiService,
        private val authStorage: AuthStorage
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return AuthViewModel(apiService, authStorage) as T
        }
    }
}
