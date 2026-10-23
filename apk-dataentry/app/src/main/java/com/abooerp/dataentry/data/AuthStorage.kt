package com.abooerp.dataentry.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class AuthStorage(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val sharedPreferences = EncryptedSharedPreferences.create(
        context,
        "dataentry_auth_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun saveTokens(accessToken: String, refreshToken: String) {
        sharedPreferences.edit()
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .apply()
    }

    fun getAccessToken(): String? = sharedPreferences.getString("access_token", null)
    fun getRefreshToken(): String? = sharedPreferences.getString("refresh_token", null)

    fun saveEmployeeName(name: String) {
        sharedPreferences.edit().putString("employee_name", name).apply()
    }
    fun getEmployeeName(): String? = sharedPreferences.getString("employee_name", null)

    fun saveUserId(userId: String) {
        sharedPreferences.edit().putString("user_id", userId).apply()
    }
    fun getUserId(): String? = sharedPreferences.getString("user_id", null)

    fun saveBranch(branchId: String, branchLabel: String) {
        sharedPreferences.edit()
            .putString("branch_id", branchId)
            .putString("branch_label", branchLabel)
            .apply()
    }
    fun getBranchId(): String? = sharedPreferences.getString("branch_id", null)
    fun getBranchLabel(): String? = sharedPreferences.getString("branch_label", null)

    fun savePrinter(address: String, name: String) {
        sharedPreferences.edit()
            .putString("printer_address", address)
            .putString("printer_name", name)
            .apply()
    }
    fun getPrinterAddress(): String? = sharedPreferences.getString("printer_address", null)
    fun getPrinterName(): String? = sharedPreferences.getString("printer_name", null)

    fun clear() {
        sharedPreferences.edit().clear().apply()
    }
}
