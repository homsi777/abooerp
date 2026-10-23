package com.example

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.example.data.local.AppDatabase
import com.example.data.local.TokenManager
import com.example.data.remote.ApiClient
import com.example.data.repository.DriverRepository

class AbooDriverApp : Application() {

    lateinit var tokenManager: TokenManager
        private set

    lateinit var database: AppDatabase
        private set

    lateinit var apiClient: ApiClient
        private set

    lateinit var repository: DriverRepository
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        try {
            tokenManager = TokenManager(this)
            database = AppDatabase.getInstance(this)
            apiClient = ApiClient(this, tokenManager)
            repository = DriverRepository(apiClient, database.offlinePingDao(), tokenManager)
            createNotificationChannel()
        } catch (t: Throwable) {
            android.util.Log.e("AbooDriverApp", "Error during app initialization", t)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_desc)
                setShowBadge(false)
            }

            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "driver_tracking_channel"
        lateinit var instance: AbooDriverApp
            private set
    }
}
