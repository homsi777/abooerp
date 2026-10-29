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

    /** The receipt printer — the Bluetooth one the sender's receipt comes
     *  out of. Paired with, not an alternative to, the label printer below. */
    fun savePrinter(address: String, name: String) {
        sharedPreferences.edit()
            .putString("printer_address", address)
            .putString("printer_name", name)
            .apply()
    }
    fun getPrinterAddress(): String? = sharedPreferences.getString("printer_address", null)
    fun getPrinterName(): String? = sharedPreferences.getString("printer_name", null)

    /** The parcel-label printer: a SEPARATE device from the receipt printer
     *  above, reached over the LAN. Saving a row prints the sender's
     *  receipt on one and the parcel label on the other. */
    fun saveLabelPrinter(host: String, port: Int) {
        sharedPreferences.edit()
            .putString("label_printer_host", host)
            .putInt("label_printer_port", port)
            .apply()
    }
    fun getLabelPrinterHost(): String? = sharedPreferences.getString("label_printer_host", null)
    fun getLabelPrinterPort(): Int = sharedPreferences.getInt("label_printer_port", 9100)

    fun clearLabelPrinter() {
        sharedPreferences.edit()
            .remove("label_printer_host")
            .remove("label_printer_port")
            .apply()
    }

    fun clear() {
        sharedPreferences.edit().clear().apply()
    }
}
