package com.abooerp.dataentry.network

import android.content.Context
import com.abooerp.dataentry.data.AuthStorage
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

object NetworkModule {
    @Volatile private var apiService: ApiService? = null

    private const val BASE_URL = "https://www.abooerp.org/api/v1/"

    fun provideApiService(context: Context): ApiService {
        return apiService ?: synchronized(this) {
            apiService ?: create(context.applicationContext).also { apiService = it }
        }
    }

    private fun create(appContext: Context): ApiService {
        val authStorage = AuthStorage(appContext)
        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.NONE }
        val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .addInterceptor(AuthInterceptor(authStorage))
            .addInterceptor(logging)
            .build()
        val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(ApiService::class.java)
    }
}
