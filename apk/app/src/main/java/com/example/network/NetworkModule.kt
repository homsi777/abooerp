package com.example.network

import android.content.Context
import com.example.data.AuthStorage
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

object NetworkModule {
    @Volatile
    private var apiService: ApiService? = null

    // Cloud API — same origin as https://www.abooerp.org/
    private const val DEFAULT_BASE_URL = "https://www.abooerp.org/api/v1/"

    fun provideApiService(context: Context): ApiService {
        return apiService ?: synchronized(this) {
            apiService ?: createApiService(context.applicationContext).also { apiService = it }
        }
    }

    private fun createApiService(appContext: Context): ApiService {
        val authStorage = AuthStorage(appContext)
        val authInterceptor = AuthInterceptor(authStorage)

        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.NONE
        }

        val moshi = Moshi.Builder()
            .add(KotlinJsonAdapterFactory())
            .build()

        // Plain client with no auth header and no authenticator — used only to call
        // auth/refresh, so refreshing the token can never itself trigger another refresh.
        val refreshClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .build()
        val refreshApi = Retrofit.Builder()
            .baseUrl(DEFAULT_BASE_URL)
            .client(refreshClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(ApiService::class.java)

        val tokenAuthenticator = TokenAuthenticator(authStorage, refreshApi)

        val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .authenticator(tokenAuthenticator)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(DEFAULT_BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()

        return retrofit.create(ApiService::class.java)
    }
}
