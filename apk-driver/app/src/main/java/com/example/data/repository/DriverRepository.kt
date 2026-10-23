package com.example.data.repository

import com.example.data.local.OfflinePingDao
import com.example.data.local.OfflinePingEntity
import com.example.data.local.TokenManager
import com.example.data.model.CurrentTripResponse
import com.example.data.model.LocationPingRequest
import com.example.data.model.LoginRequest
import com.example.data.model.LoginResponse
import com.example.data.model.ShipmentItem
import com.example.data.model.TripActionRequest
import com.example.data.model.TripData
import com.example.data.remote.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class DriverRepository(
    private val apiClient: ApiClient,
    private val offlinePingDao: OfflinePingDao,
    private val tokenManager: TokenManager
) {

    val isUserLoggedIn: Boolean
        get() = tokenManager.isLoggedIn

    val currentDriverUsername: String
        get() = tokenManager.username ?: "السائق"

    val currentDriverId: String?
        get() = tokenManager.driverId

    val isDemoMode: Boolean
        get() = tokenManager.isDemoMode

    val isTrackingActive: Boolean
        get() = tokenManager.isTracking

    fun setTrackingActive(active: Boolean) {
        tokenManager.isTracking = active
    }

    fun setActiveTripId(tripId: String?) {
        tokenManager.activeTripId = tripId
    }

    fun getActiveTripId(): String? = tokenManager.activeTripId

    fun observePendingPingsCount(): Flow<Int> = offlinePingDao.observePendingCount()

    suspend fun getPendingPingsCount(): Int = withContext(Dispatchers.IO) {
        offlinePingDao.getPendingCount()
    }

    suspend fun login(username: String, password: String): Result<LoginResponse> = withContext(Dispatchers.IO) {
        try {
            val response = apiClient.service.login(LoginRequest(username = username, password = password))
            if (response.isSuccessful && response.body()?.success == true) {
                val data = response.body()?.data
                if (data != null) {
                    tokenManager.saveSession(
                        access = data.session.accessToken,
                        refresh = data.session.refreshToken,
                        user = data.user.username,
                        dId = data.user.driverId
                    )
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("استجابة غير صالحة من الخادم"))
                }
            } else {
                val errorMsg = response.body()?.error
                    ?: response.body()?.message
                    ?: "فشل تسجيل الدخول. رمز الخطأ: ${response.code()}"
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun loginDemo(username: String = "driver_omar") {
        tokenManager.saveDemoSession(username)
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        tokenManager.clear()
        offlinePingDao.clearAll()
    }

    suspend fun getCurrentTrip(): Result<TripData> = withContext(Dispatchers.IO) {
        if (tokenManager.isDemoMode) {
            val mockTrip = getMockTrip()
            tokenManager.activeTripId = mockTrip.id
            return@withContext Result.success(mockTrip)
        }

        try {
            val response = apiClient.service.getCurrentTrip()
            if (response.isSuccessful && response.body()?.success == true) {
                val trip = response.body()?.data
                if (trip != null) {
                    tokenManager.activeTripId = trip.id
                    Result.success(trip)
                } else {
                    Result.failure(Exception("لا توجد رحلة حالية مسندة لهذا السائق"))
                }
            } else {
                val errorMsg = response.body()?.error ?: "تعذر تحميل بيانات الرحلة من الخادم (رمز: ${response.code()})"
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(Exception("تعذر تحميل الرحلة — يرجى التحقق من الاتصال بالخادم"))
        }
    }

    suspend fun startTrip(tripId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        if (tokenManager.isDemoMode) {
            tokenManager.isTracking = true
            tokenManager.activeTripId = tripId
            return@withContext Result.success(true)
        }

        try {
            val response = apiClient.service.startTrip(TripActionRequest(tripId))
            if (response.isSuccessful && response.body()?.success == true) {
                tokenManager.isTracking = true
                tokenManager.activeTripId = tripId
                Result.success(true)
            } else {
                val errorMsg = response.body()?.message ?: "تعذر بدء الرحلة في الخادم (رمز: ${response.code()})"
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(Exception("تعذر بدء الرحلة — يرجى التحقق من الاتصال والمحاولة مجدداً"))
        }
    }

    suspend fun endTrip(tripId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        if (tokenManager.isDemoMode) {
            tokenManager.isTracking = false
            return@withContext Result.success(true)
        }

        try {
            val response = apiClient.service.endTrip(TripActionRequest(tripId))
            if (response.isSuccessful && response.body()?.success == true) {
                tokenManager.isTracking = false
                Result.success(true)
            } else {
                val errorMsg = response.body()?.message ?: "تعذر إنهاء الرحلة في الخادم (رمز: ${response.code()})"
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(Exception("تعذر إنهاء الرحلة — يرجى التحقق من الاتصال والمحاولة مجدداً"))
        }
    }

    suspend fun sendLocationPing(
        lat: Double,
        lng: Double,
        accuracy: Float,
        tripId: String,
        recordedAt: String = getCurrentIsoTimestamp()
    ): Boolean = withContext(Dispatchers.IO) {
        if (tokenManager.isDemoMode) {
            return@withContext true
        }

        var sentSuccessfully = false
        try {
            val request = LocationPingRequest(
                lat = lat,
                lng = lng,
                accuracyM = accuracy,
                recordedAt = recordedAt,
                tripId = tripId
            )
            val response = apiClient.service.sendLocationPing(request)
            if (response.isSuccessful && response.body()?.success == true) {
                sentSuccessfully = true
            }
        } catch (e: Exception) {
            sentSuccessfully = false
        }

        if (!sentSuccessfully) {
            // Queue into offline local database
            offlinePingDao.insertPing(
                OfflinePingEntity(
                    lat = lat,
                    lng = lng,
                    accuracyM = accuracy,
                    recordedAt = recordedAt,
                    tripId = tripId
                )
            )
        } else {
            // Since we are online, try to flush any accumulated offline pings
            flushPendingPings()
        }

        sentSuccessfully
    }

    suspend fun flushPendingPings(): Int = withContext(Dispatchers.IO) {
        val pending = offlinePingDao.getAllPending()
        if (pending.isEmpty() || tokenManager.isDemoMode) return@withContext 0

        var flushedCount = 0
        for (item in pending) {
            try {
                val req = LocationPingRequest(
                    lat = item.lat,
                    lng = item.lng,
                    accuracyM = item.accuracyM,
                    recordedAt = item.recordedAt,
                    tripId = item.tripId
                )
                val response = apiClient.service.sendLocationPing(req)
                if (response.isSuccessful && response.body()?.success == true) {
                    offlinePingDao.deleteById(item.id)
                    flushedCount++
                } else {
                    break // Stop if server fails
                }
            } catch (e: Exception) {
                break // Stop on connection issue
            }
        }
        flushedCount
    }

    fun getCurrentIsoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    fun getMockTrip(): TripData {
        return TripData(
            id = "TRP-SYR-2026-084",
            tripNumber = "TRP-2026-084",
            date = "2026-10-18",
            originCity = "حلب (المستودع المركزي)",
            destinationCities = listOf("الرقة", "الحسكة", "القامشلي"),
            shipments = listOf(
                ShipmentItem(
                    id = "shp-101",
                    receiptNumber = "SHP-58412",
                    senderName = "شركة الفرات للأقمشة والغزول",
                    receiverName = "مؤسسة الشام التجارية",
                    destinationCity = "الرقة",
                    parcelCount = 12,
                    weightKg = 240.0,
                    status = "جارٍ النقل"
                ),
                ShipmentItem(
                    id = "shp-102",
                    receiptNumber = "SHP-58419",
                    senderName = "معمل الفجر للصناعات الغذائية",
                    receiverName = "أسواق الجزيرة الكبرى",
                    destinationCity = "الحسكة",
                    parcelCount = 45,
                    weightKg = 580.0,
                    status = "جارٍ النقل"
                ),
                ShipmentItem(
                    id = "shp-103",
                    receiptNumber = "SHP-58425",
                    senderName = "شركة الأمل للمستلزمات الطبية",
                    receiverName = "مجمع السلام الطبي",
                    destinationCity = "القامشلي",
                    parcelCount = 8,
                    weightKg = 65.0,
                    status = "بانتظار التسليم"
                ),
                ShipmentItem(
                    id = "shp-104",
                    receiptNumber = "SHP-58431",
                    senderName = "مؤسسة النور للأجهزة الإلكترونية",
                    receiverName = "معرض التقنية والاتصالات",
                    destinationCity = "القامشلي",
                    parcelCount = 14,
                    weightKg = 110.0,
                    status = "بانتظار التسليم"
                ),
                ShipmentItem(
                    id = "shp-105",
                    receiptNumber = "SHP-58440",
                    senderName = "معمل الأندلس للمنتجات البلاستيكية",
                    receiverName = "مستودعات الشرق للتوزيع",
                    destinationCity = "الحسكة",
                    parcelCount = 30,
                    weightKg = 920.0,
                    status = "جارٍ النقل"
                )
            ),
            status = "IN_TRANSIT"
        )
    }
}
