package com.abooerp.dataentry.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.abooerp.dataentry.data.AuthStorage
import com.abooerp.dataentry.data.LoginRequest
import com.abooerp.dataentry.network.ApiService
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
    private val authStorage: AuthStorage,
) : ViewModel() {
    private val _authState = MutableStateFlow<AuthState>(
        if (authStorage.getAccessToken() != null) AuthState.Success else AuthState.Idle,
    )
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    fun login(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            _authState.value = AuthState.Error("الرجاء إدخال اسم المستخدم وكلمة المرور")
            return
        }
        viewModelScope.launch {
            _authState.value = AuthState.Loading
            try {
                val response = apiService.login(LoginRequest(username, password))
                if (response.success && response.data != null) {
                    authStorage.saveTokens(response.data.session.accessToken, response.data.session.refreshToken)
                    authStorage.saveEmployeeName(response.data.user.fullName ?: response.data.user.username)
                    authStorage.saveUserId(response.data.user.id)
                    val branchId = response.data.user.branchId
                    if (branchId != null) {
                        val branchLabel = try {
                            apiService.getBranches().data?.find { it.id == branchId }?.name
                        } catch (_: Exception) {
                            null
                        }
                        authStorage.saveBranch(branchId, branchLabel ?: "الفرع")
                    }
                    _authState.value = AuthState.Success
                } else {
                    _authState.value = AuthState.Error(response.error ?: "اسم المستخدم أو كلمة المرور غير صحيحة")
                }
            } catch (e: retrofit2.HttpException) {
                val body = e.response()?.errorBody()?.string()
                _authState.value = AuthState.Error(
                    when (e.code()) {
                        401 -> "اسم المستخدم أو كلمة المرور غير صحيحة"
                        403 -> "لا تملك صلاحية الدخول بهذا الحساب"
                        else -> "خطأ من الخادم (${e.code()}): ${body ?: "بدون تفاصيل"}"
                    },
                )
            } catch (e: java.io.IOException) {
                _authState.value = AuthState.Error("تعذر الاتصال بالخادم: ${e.message}")
            } catch (e: Exception) {
                _authState.value = AuthState.Error("خطأ غير متوقع: ${e::class.simpleName} — ${e.message}")
            }
        }
    }

    fun logout() {
        authStorage.clear()
        _authState.value = AuthState.Idle
    }

    fun resetState() {
        if (_authState.value is AuthState.Error) _authState.value = AuthState.Idle
    }

    class Factory(
        private val apiService: ApiService,
        private val authStorage: AuthStorage,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            AuthViewModel(apiService, authStorage) as T
    }
}
