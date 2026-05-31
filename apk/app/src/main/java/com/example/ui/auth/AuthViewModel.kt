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
                // Try to parse the error body if possible, fallback to standard messages
                val errorBody = e.response()?.errorBody()?.string()
                val errorMessage = if (errorBody?.contains("DEVICE_NOT_REGISTERED") == true) {
                    "الجهاز غير مصرح له بالدخول"
                } else if (e.code() == 401 || errorBody?.contains("Invalid username or password") == true) {
                    "اسم المستخدم أو كلمة المرور غير صحيحة"
                } else if (e.code() >= 500) {
                    "حدث خطأ في الخادم"
                } else {
                    "استجابة غير متوقعة من الخادم"
                }
                _authState.value = AuthState.Error(errorMessage)
            } catch (e: java.io.IOException) {
                _authState.value = AuthState.Error("تعذر الاتصال بالخادم")
            } catch (e: Exception) {
                val errorMessage = if (e.message?.contains("DEVICE_NOT_REGISTERED") == true) {
                    "الجهاز غير مصرح له بالدخول"
                } else {
                    "استجابة غير متوقعة من الخادم"
                }
                _authState.value = AuthState.Error(errorMessage)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try {
                val refreshToken = authStorage.getRefreshToken() ?: ""
                apiService.logout(com.example.data.LogoutRequest(refreshToken))
            } catch (e: Exception) {
                // Ignore logout network errors
            } finally {
                authStorage.clear()
                _authState.value = AuthState.Idle
            }
        }
    }

    fun resetState() {
        if (_authState.value is AuthState.Error) {
            _authState.value = AuthState.Idle
        }
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
