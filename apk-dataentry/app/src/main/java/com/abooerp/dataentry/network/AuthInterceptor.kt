package com.abooerp.dataentry.network

import com.abooerp.dataentry.data.AuthStorage
import java.util.UUID
import okhttp3.Interceptor
import okhttp3.Response

class AuthInterceptor(private val authStorage: AuthStorage) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = authStorage.getAccessToken()
        // Server checks this header for an exact, case-insensitive match on
        // "mobile" to allow JWT-only auth without Electron device registration.
        val builder = request.newBuilder().addHeader("X-Client-Type", "mobile")
        if (token != null) builder.addHeader("Authorization", "Bearer $token")
        // Several write endpoints (custody-shifts, journal-entries, etc.)
        // require an idempotency key so a retried request never double-posts
        // a real financial action — the web client auto-generates one per
        // request the same way; this was missing here entirely, which is
        // exactly what caused "x-idempotency-key header is required" on
        // every write call from this app.
        val method = request.method
        if (method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE") {
            builder.addHeader("X-Idempotency-Key", UUID.randomUUID().toString())
        }
        return chain.proceed(builder.build())
    }
}
