package com.example.data.local

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class TokenManager(context: Context) {
    private val prefs: SharedPreferences = createSafePreferences(context)

    companion object {
        private const val ENCRYPTED_PREFS_NAME = "aboo_driver_encrypted_prefs"
        private const val FALLBACK_PREFS_NAME = "aboo_driver_standard_prefs"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_DRIVER_ID = "driver_id"
        private const val KEY_USERNAME = "driver_username"
        private const val KEY_ACTIVE_TRIP_ID = "active_trip_id"
        private const val KEY_IS_TRACKING = "is_tracking"
        private const val KEY_BASE_URL = "api_base_url"
        private const val KEY_IS_DEMO_MODE = "is_demo_mode"

        const val DEFAULT_BASE_URL = "https://www.abooerp.org/api/v1"

        private fun createSafePreferences(context: Context): SharedPreferences {
            // Try EncryptedSharedPreferences first, with a failsafe fallback to standard SharedPreferences
            try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()

                return EncryptedSharedPreferences.create(
                    context,
                    ENCRYPTED_PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
            } catch (t: Throwable) {
                Log.w("TokenManager", "EncryptedSharedPreferences unavailable on this device/emulator, using fallback", t)
            }

            return context.getSharedPreferences(FALLBACK_PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    private fun safeGetString(key: String, default: String? = null): String? {
        return try {
            prefs.getString(key, default)
        } catch (t: Throwable) {
            Log.e("TokenManager", "Failed to read $key", t)
            default
        }
    }

    private fun safePutString(key: String, value: String?) {
        try {
            prefs.edit().putString(key, value).apply()
        } catch (t: Throwable) {
            Log.e("TokenManager", "Failed to write $key", t)
        }
    }

    private fun safeGetBoolean(key: String, default: Boolean = false): Boolean {
        return try {
            prefs.getBoolean(key, default)
        } catch (t: Throwable) {
            Log.e("TokenManager", "Failed to read boolean $key", t)
            default
        }
    }

    private fun safePutBoolean(key: String, value: Boolean) {
        try {
            prefs.edit().putBoolean(key, value).apply()
        } catch (t: Throwable) {
            Log.e("TokenManager", "Failed to write boolean $key", t)
        }
    }

    var accessToken: String?
        get() = safeGetString(KEY_ACCESS_TOKEN)
        set(value) = safePutString(KEY_ACCESS_TOKEN, value)

    var refreshToken: String?
        get() = safeGetString(KEY_REFRESH_TOKEN)
        set(value) = safePutString(KEY_REFRESH_TOKEN, value)

    var driverId: String?
        get() = safeGetString(KEY_DRIVER_ID)
        set(value) = safePutString(KEY_DRIVER_ID, value)

    var username: String?
        get() = safeGetString(KEY_USERNAME)
        set(value) = safePutString(KEY_USERNAME, value)

    var activeTripId: String?
        get() = safeGetString(KEY_ACTIVE_TRIP_ID)
        set(value) = safePutString(KEY_ACTIVE_TRIP_ID, value)

    var isTracking: Boolean
        get() = safeGetBoolean(KEY_IS_TRACKING, false)
        set(value) = safePutBoolean(KEY_IS_TRACKING, value)

    var baseUrl: String
        get() = safeGetString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        set(value) {
            val formatted = if (value.endsWith("/")) value.dropLast(1) else value
            safePutString(KEY_BASE_URL, formatted)
        }

    var isDemoMode: Boolean
        get() = safeGetBoolean(KEY_IS_DEMO_MODE, false)
        set(value) = safePutBoolean(KEY_IS_DEMO_MODE, value)

    val isLoggedIn: Boolean
        get() = isDemoMode || (!accessToken.isNullOrBlank())

    fun saveSession(access: String, refresh: String, user: String, dId: String?) {
        try {
            prefs.edit()
                .putString(KEY_ACCESS_TOKEN, access)
                .putString(KEY_REFRESH_TOKEN, refresh)
                .putString(KEY_USERNAME, user)
                .putString(KEY_DRIVER_ID, dId)
                .putBoolean(KEY_IS_DEMO_MODE, false)
                .apply()
        } catch (t: Throwable) {
            Log.e("TokenManager", "Failed to saveSession", t)
        }
    }

    fun saveDemoSession(user: String) {
        try {
            prefs.edit()
                .putString(KEY_ACCESS_TOKEN, "demo_token_aboo_driver")
                .putString(KEY_REFRESH_TOKEN, "demo_refresh_token")
                .putString(KEY_USERNAME, user)
                .putString(KEY_DRIVER_ID, "driver_demo_uuid")
                .putBoolean(KEY_IS_DEMO_MODE, true)
                .apply()
        } catch (t: Throwable) {
            Log.e("TokenManager", "Failed to saveDemoSession", t)
        }
    }

    fun clear() {
        try {
            prefs.edit()
                .remove(KEY_ACCESS_TOKEN)
                .remove(KEY_REFRESH_TOKEN)
                .remove(KEY_DRIVER_ID)
                .remove(KEY_USERNAME)
                .remove(KEY_ACTIVE_TRIP_ID)
                .putBoolean(KEY_IS_TRACKING, false)
                .putBoolean(KEY_IS_DEMO_MODE, false)
                .apply()
        } catch (t: Throwable) {
            Log.e("TokenManager", "Failed to clear", t)
        }
    }
}
