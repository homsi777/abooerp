package com.example.service

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.example.AbooDriverApp
import com.example.MainActivity
import com.example.R
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class DriverLocationService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var fusedLocationClient: FusedLocationProviderClient? = null
    private var locationCallback: LocationCallback? = null
    private var locationManager: LocationManager? = null
    private var fallbackListener: LocationListener? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private var currentTripId: String = ""

    companion object {
        const val NOTIFICATION_ID = 1001
        const val ACTION_START_TRACKING = "com.example.action.START_TRACKING"
        const val ACTION_STOP_TRACKING = "com.example.action.STOP_TRACKING"
        const val EXTRA_TRIP_ID = "extra_trip_id"

        private val _isServiceRunning = MutableStateFlow(false)
        val isServiceRunning: StateFlow<Boolean> = _isServiceRunning.asStateFlow()

        private val _lastLocation = MutableStateFlow<Location?>(null)
        val lastLocation: StateFlow<Location?> = _lastLocation.asStateFlow()

        private val _lastPingTimeStr = MutableStateFlow<String?>(null)
        val lastPingTimeStr: StateFlow<String?> = _lastPingTimeStr.asStateFlow()

        private val _lastSentSuccess = MutableStateFlow(true)
        val lastSentSuccess: StateFlow<Boolean> = _lastSentSuccess.asStateFlow()

        fun start(context: Context, tripId: String) {
            val intent = Intent(context, DriverLocationService::class.java).apply {
                action = ACTION_START_TRACKING
                putExtra(EXTRA_TRIP_ID, tripId)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, DriverLocationService::class.java).apply {
                action = ACTION_STOP_TRACKING
            }
            context.startService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "AbooDriver::LocationTrackingWakeLock"
            ).apply {
                setReferenceCounted(false)
            }
        } catch (e: Exception) {
            // WakeLock optional
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_TRACKING -> {
                currentTripId = intent.getStringExtra(EXTRA_TRIP_ID)
                    ?: AbooDriverApp.instance.tokenManager.activeTripId
                    ?: "TRP-SYR-2026-084"
                startForegroundTracking()
            }
            ACTION_STOP_TRACKING -> {
                stopTracking()
            }
        }
        return START_STICKY
    }

    private fun startForegroundTracking() {
        _isServiceRunning.value = true
        AbooDriverApp.instance.repository.setTrackingActive(true)

        try {
            wakeLock?.acquire(24 * 60 * 60 * 1000L) // 24 hours max safeguard
        } catch (e: Exception) {
            // ignore
        }

        val notification = buildNotification(
            statusText = getString(R.string.tracking_active),
            detailsText = "الرحلة: $currentTripId — بانتظار إحداثيات GPS..."
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        initLocationUpdates()
    }

    @SuppressLint("MissingPermission")
    private fun initLocationUpdates() {
        // Interval: 60 to 120 seconds per specification
        val intervalMs = 60_000L
        val minIntervalMs = 30_000L

        try {
            fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
            val locationRequest = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, intervalMs)
                .setMinUpdateIntervalMillis(minIntervalMs)
                .setMinUpdateDistanceMeters(10f)
                .build()

            locationCallback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    result.lastLocation?.let { handleNewLocation(it) }
                }
            }

            fusedLocationClient?.requestLocationUpdates(
                locationRequest,
                locationCallback!!,
                Looper.getMainLooper()
            )
        } catch (e: Exception) {
            // Fallback to standard LocationManager
            setupLocationManagerFallback(intervalMs)
        }
    }

    @SuppressLint("MissingPermission")
    private fun setupLocationManagerFallback(intervalMs: Long) {
        try {
            locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            fallbackListener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    handleNewLocation(location)
                }
                @Deprecated("Deprecated in Java")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
            }

            if (locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true) {
                locationManager?.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    intervalMs,
                    10f,
                    fallbackListener!!,
                    Looper.getMainLooper()
                )
            } else if (locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true) {
                locationManager?.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    intervalMs,
                    10f,
                    fallbackListener!!,
                    Looper.getMainLooper()
                )
            }
        } catch (e: Exception) {
            // Permissions missing or handled by UI
        }
    }

    private fun handleNewLocation(location: Location) {
        _lastLocation.value = location
        val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        val timeStr = timeFormat.format(Date(location.time))
        _lastPingTimeStr.value = timeStr

        serviceScope.launch {
            val repository = AbooDriverApp.instance.repository
            val success = repository.sendLocationPing(
                lat = location.latitude,
                lng = location.longitude,
                accuracy = location.accuracy,
                tripId = currentTripId
            )
            _lastSentSuccess.value = success

            val pendingCount = repository.getPendingPingsCount()
            val details = if (pendingCount > 0) {
                "إحداثيات: ${"%.4f".format(location.latitude)}, ${"%.4f".format(location.longitude)} • معلّق: $pendingCount"
            } else {
                "إحداثيات: ${"%.4f".format(location.latitude)}, ${"%.4f".format(location.longitude)} • متصل ومزامن ✓"
            }

            updateNotification(
                statusText = getString(R.string.tracking_active),
                detailsText = details
            )
        }
    }

    private fun buildNotification(statusText: String, detailsText: String): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, AbooDriverApp.CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(detailsText)
            .setSubText(statusText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    private fun updateNotification(statusText: String, detailsText: String) {
        val notification = buildNotification(statusText, detailsText)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun stopTracking() {
        _isServiceRunning.value = false
        AbooDriverApp.instance.repository.setTrackingActive(false)

        try {
            locationCallback?.let { fusedLocationClient?.removeLocationUpdates(it) }
            fallbackListener?.let { locationManager?.removeUpdates(it) }
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) {
            // ignore
        }

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopTracking()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
