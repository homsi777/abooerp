package com.example.data.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class LoginRequest(
    @Json(name = "username") val username: String,
    @Json(name = "password") val password: String
)

@JsonClass(generateAdapter = true)
data class LoginResponse(
    @Json(name = "success") val success: Boolean,
    @Json(name = "data") val data: LoginData? = null,
    @Json(name = "error") val error: String? = null,
    @Json(name = "message") val message: String? = null
)

@JsonClass(generateAdapter = true)
data class LoginData(
    @Json(name = "user") val user: UserInfo,
    @Json(name = "session") val session: SessionInfo
)

@JsonClass(generateAdapter = true)
data class UserInfo(
    @Json(name = "id") val id: String,
    @Json(name = "username") val username: String,
    @Json(name = "role") val role: String? = null,
    @Json(name = "permissions") val permissions: List<String>? = null,
    @Json(name = "userType") val userType: String? = null,
    @Json(name = "companyId") val companyId: String? = null,
    @Json(name = "branchId") val branchId: String? = null,
    @Json(name = "driverId") val driverId: String? = null
)

@JsonClass(generateAdapter = true)
data class SessionInfo(
    @Json(name = "accessToken") val accessToken: String,
    @Json(name = "refreshToken") val refreshToken: String,
    @Json(name = "tokenType") val tokenType: String = "Bearer",
    @Json(name = "expiresIn") val expiresIn: Long = 900
)

@JsonClass(generateAdapter = true)
data class RefreshRequest(
    @Json(name = "refreshToken") val refreshToken: String
)

@JsonClass(generateAdapter = true)
data class CurrentTripResponse(
    @Json(name = "success") val success: Boolean,
    @Json(name = "data") val data: TripData? = null,
    @Json(name = "error") val error: String? = null
)

@JsonClass(generateAdapter = true)
data class TripData(
    @Json(name = "id") val id: String,
    @Json(name = "tripNumber") val tripNumber: String,
    @Json(name = "date") val date: String,
    @Json(name = "originCity") val originCity: String,
    @Json(name = "destinationCities") val destinationCities: List<String>,
    @Json(name = "shipments") val shipments: List<ShipmentItem> = emptyList(),
    @Json(name = "status") val status: String = "IN_TRANSIT"
)

@JsonClass(generateAdapter = true)
data class ShipmentItem(
    @Json(name = "id") val id: String,
    @Json(name = "receiptNumber") val receiptNumber: String,
    @Json(name = "senderName") val senderName: String,
    @Json(name = "receiverName") val receiverName: String,
    @Json(name = "destinationCity") val destinationCity: String,
    @Json(name = "parcelCount") val parcelCount: Int,
    @Json(name = "weightKg") val weightKg: Double,
    @Json(name = "status") val status: String
)

@JsonClass(generateAdapter = true)
data class TripActionRequest(
    @Json(name = "tripId") val tripId: String
)

@JsonClass(generateAdapter = true)
data class ActionResponse(
    @Json(name = "success") val success: Boolean,
    @Json(name = "message") val message: String? = null
)

@JsonClass(generateAdapter = true)
data class LocationPingRequest(
    @Json(name = "lat") val lat: Double,
    @Json(name = "lng") val lng: Double,
    @Json(name = "accuracyM") val accuracyM: Float,
    @Json(name = "recordedAt") val recordedAt: String,
    @Json(name = "tripId") val tripId: String
)

@JsonClass(generateAdapter = true)
data class LocationPingResponse(
    @Json(name = "success") val success: Boolean
)
