package com.example.network

import com.example.data.AuthStorage
import okhttp3.Interceptor
import okhttp3.Response

class AuthInterceptor(private val authStorage: AuthStorage) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = authStorage.getAccessToken()

        val requestBuilder = request.newBuilder()
            .addHeader("X-Client-Type", "mobile")

        if (token != null) {
            requestBuilder.addHeader("Authorization", "Bearer $token")
        }

        return chain.proceed(requestBuilder.build())
    }
}
