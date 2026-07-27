package com.example.di

import android.content.Context
import com.example.data.AuthStorage
import com.example.network.ApiService
import com.example.network.NetworkModule

class AppContainer(private val context: Context) {
    val authStorage: AuthStorage by lazy {
        AuthStorage(context)
    }

    val apiService: ApiService by lazy {
        NetworkModule.provideApiService(context)
    }
}
