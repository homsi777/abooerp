package com.example.data.remote

import android.content.Context
import com.example.data.local.TokenManager
import com.example.data.model.RefreshRequest
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

class ApiClient(private val context: Context, private val tokenManager: TokenManager) {

    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private var currentBaseUrl: String = tokenManager.baseUrl
    private var cachedService: AbooDriverApiService? = null

    val service: AbooDriverApiService
        get() {
            val configuredBaseUrl = if (tokenManager.baseUrl.endsWith("/")) {
                tokenManager.baseUrl
            } else {
                "${tokenManager.baseUrl}/"
            }

            if (cachedService != null && currentBaseUrl == configuredBaseUrl) {
                return cachedService!!
            }

            currentBaseUrl = configuredBaseUrl

            val authInterceptor = Interceptor { chain ->
                val originalRequest = chain.request()
                val requestBuilder = originalRequest.newBuilder()
                    .header("X-Client-Type", "mobile")
                    .header("Accept", "application/json")

                val token = tokenManager.accessToken
                if (!token.isNullOrBlank()) {
                    requestBuilder.header("Authorization", "Bearer $token")
                }

                chain.proceed(requestBuilder.build())
            }

            val tokenAuthenticator = Authenticator { _: Route?, response: Response ->
                // Avoid infinite loop if refresh itself fails
                if (response.request.header("Authorization") == null || responseCount(response) >= 2) {
                    return@Authenticator null
                }

                val currentRefreshToken = tokenManager.refreshToken
                if (currentRefreshToken.isNullOrBlank()) {
                    tokenManager.clear()
                    return@Authenticator null
                }

                try {
                    // Synchronously refresh the token using an isolated client
                    val refreshOkHttp = OkHttpClient.Builder()
                        .connectTimeout(15, TimeUnit.SECONDS)
                        .readTimeout(15, TimeUnit.SECONDS)
                        .build()

                    val refreshRetrofit = Retrofit.Builder()
                        .baseUrl(configuredBaseUrl)
                        .client(refreshOkHttp)
                        .addConverterFactory(MoshiConverterFactory.create(moshi))
                        .build()

                    val refreshService = refreshRetrofit.create(AbooDriverApiService::class.java)
                    val refreshCall = refreshService.refreshTokenSync(RefreshRequest(currentRefreshToken))
                    val refreshResponse = refreshCall.execute()

                    if (refreshResponse.isSuccessful && refreshResponse.body()?.success == true) {
                        val session = refreshResponse.body()?.data?.session
                        val newAccess = session?.accessToken
                        val newRefresh = session?.refreshToken ?: currentRefreshToken
                        if (!newAccess.isNullOrBlank()) {
                            tokenManager.accessToken = newAccess
                            tokenManager.refreshToken = newRefresh
                            return@Authenticator response.request.newBuilder()
                                .header("Authorization", "Bearer $newAccess")
                                .header("X-Client-Type", "mobile")
                                .build()
                        }
                    }
                } catch (e: Exception) {
                    // Network or refresh failure
                }

                tokenManager.clear()
                null
            }

            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
            }

            val okHttpClient = OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .addInterceptor(authInterceptor)
                .addInterceptor(logging)
                .authenticator(tokenAuthenticator)
                .build()

            val retrofit = Retrofit.Builder()
                .baseUrl(configuredBaseUrl)
                .client(okHttpClient)
                .addConverterFactory(MoshiConverterFactory.create(moshi))
                .build()

            val instance = retrofit.create(AbooDriverApiService::class.java)
            cachedService = instance
            return instance
        }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }

    fun invalidateCache() {
        cachedService = null
    }
}
