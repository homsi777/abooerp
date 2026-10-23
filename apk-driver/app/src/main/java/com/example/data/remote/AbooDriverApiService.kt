package com.example.data.remote

import com.example.data.model.ActionResponse
import com.example.data.model.CurrentTripResponse
import com.example.data.model.LocationPingRequest
import com.example.data.model.LocationPingResponse
import com.example.data.model.LoginRequest
import com.example.data.model.LoginResponse
import com.example.data.model.RefreshRequest
import com.example.data.model.TripActionRequest
import retrofit2.Call
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface AbooDriverApiService {

    @POST("auth/login")
    suspend fun login(
        @Body body: LoginRequest
    ): Response<LoginResponse>

    @POST("auth/refresh")
    fun refreshTokenSync(
        @Body body: RefreshRequest
    ): Call<LoginResponse>

    @GET("driver/current-trip")
    suspend fun getCurrentTrip(): Response<CurrentTripResponse>

    @POST("driver/trip/start")
    suspend fun startTrip(
        @Body body: TripActionRequest
    ): Response<ActionResponse>

    @POST("driver/trip/end")
    suspend fun endTrip(
        @Body body: TripActionRequest
    ): Response<ActionResponse>

    @POST("driver/location-ping")
    suspend fun sendLocationPing(
        @Body body: LocationPingRequest
    ): Response<LocationPingResponse>
}
