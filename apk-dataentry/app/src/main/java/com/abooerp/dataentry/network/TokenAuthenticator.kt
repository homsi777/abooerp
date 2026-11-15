package com.abooerp.dataentry.network

import com.abooerp.dataentry.data.AuthStorage
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

/**
 * Renews an expired session instead of letting every call fail.
 *
 * Without this the app stored a refresh token and never used it: once the
 * access token aged out, every single request came back 401 — saving a
 * row, loading the shift, the background sync loop every 20 seconds — and
 * the employee just saw a stream of errors with no way out, because the
 * app still had a token stored so it never returned to the login screen
 * either. The server logs showed exactly that: dozens of 401s on
 * /auth/me, /custody-shifts, /sync/status and /rows/upsert.
 *
 * OkHttp calls an Authenticator only after a 401, which makes this cost
 * nothing on the normal path, and it retries the original request itself
 * once new tokens are stored.
 */
class TokenAuthenticator(
    private val authStorage: AuthStorage,
    private val baseUrl: String,
) : Authenticator {

    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    // A bare client: refreshing must not go through AuthInterceptor or this
    // authenticator, or a failing refresh would recurse.
    private val bareClient = OkHttpClient.Builder().build()

    @Synchronized
    override fun authenticate(route: Route?, response: Response): Request? {
        // Give up rather than loop: if a retried request 401s again, the
        // new token is not the problem.
        if (response.priorResponse != null) return null

        val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")?.trim()
        val currentToken = authStorage.getAccessToken()
        // Another thread may have refreshed while this request was in
        // flight — reuse that instead of burning the refresh token again.
        if (currentToken != null && currentToken != failedToken) {
            return response.request.newBuilder()
                .header("Authorization", "Bearer $currentToken")
                .build()
        }

        val refreshToken = authStorage.getRefreshToken() ?: return null
        val renewed = requestNewTokens(refreshToken) ?: run {
            // The refresh token is dead too — clear the session so the app
            // lands on the login screen next launch instead of retrying
            // forever against a session that will never come back.
            authStorage.clearTokens()
            return null
        }

        authStorage.saveTokens(renewed.first, renewed.second)
        return response.request.newBuilder()
            .header("Authorization", "Bearer ${renewed.first}")
            .build()
    }

    /** Returns access/refresh on success, null on any failure. */
    private fun requestNewTokens(refreshToken: String): Pair<String, String>? {
        return try {
            val body = """{"refreshToken":"$refreshToken"}"""
                .toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url("${baseUrl}auth/refresh")
                .addHeader("X-Client-Type", "mobile")
                .post(body)
                .build()
            bareClient.newCall(request).execute().use { refreshResponse ->
                if (!refreshResponse.isSuccessful) return null
                val json = refreshResponse.body?.string() ?: return null
                val adapter = moshi.adapter(RefreshEnvelope::class.java)
                val parsed = adapter.fromJson(json) ?: return null
                val session = parsed.data?.session ?: return null
                session.accessToken to session.refreshToken
            }
        } catch (_: Exception) {
            null
        }
    }

    private data class RefreshEnvelope(val success: Boolean = false, val data: RefreshData? = null)
    private data class RefreshData(val session: RefreshSession? = null)
    private data class RefreshSession(val accessToken: String, val refreshToken: String)
}
