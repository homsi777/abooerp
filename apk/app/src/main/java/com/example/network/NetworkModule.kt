package com.example.network

import android.content.Context
import com.example.data.AuthStorage
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

object NetworkModule {
    private var apiService: ApiService? = null
    
    // Cloud API — same origin as https://www.abooerp.org/
    private const val DEFAULT_BASE_URL = "https://www.abooerp.org/api/v1/"
    
    fun provideApiService(context: Context): ApiService {
        if (apiService == null) {
            val authStorage = AuthStorage(context)
            val authInterceptor = AuthInterceptor(authStorage)
            
            val loggingInterceptor = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.NONE
            }

            val client = OkHttpClient.Builder()
                .addInterceptor(authInterceptor)
                .addInterceptor(loggingInterceptor)
                .build()

            val moshi = Moshi.Builder()
                .add(KotlinJsonAdapterFactory())
                .build()

            val retrofit = Retrofit.Builder()
                .baseUrl(DEFAULT_BASE_URL)
                .client(client)
                .addConverterFactory(MoshiConverterFactory.create(moshi))
                .build()

            apiService = retrofit.create(ApiService::class.java)
        }
        return apiService!!
    }
}
