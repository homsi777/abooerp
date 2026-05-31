package com.example.network

import com.example.data.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): ApiResponse<LoginResponseData>

    @POST("auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): ApiResponse<LoginResponseData>
    
    @POST("auth/logout")
    suspend fun logout(@Body request: LogoutRequest): ApiResponse<Unit>
    
    @GET("auth/me")
    suspend fun getMe(): ApiResponse<UserData>

    @GET("agent-portal/profile")
    suspend fun getProfile(): ApiResponse<ProfileResponse>
    
    @GET("agent-portal/workspace-summary")
    suspend fun getWorkspaceSummary(): ApiResponse<WorkspaceSummary>

    @GET("agent-portal/shipments")
    suspend fun getShipments(): ApiResponse<List<Shipment>>

    @POST("agent-portal/shipments")
    suspend fun createShipment(@Body request: CreateShipmentRequest): ApiResponse<Shipment>

    @GET("agent-portal/shipments/{id}/details")
    suspend fun getShipmentDetails(@Path("id") id: String): ApiResponse<ShipmentPortalDetails>

    @POST("agent-portal/shipments/{id}/agent-received")
    suspend fun markAgentReceived(@Path("id") id: String, @Body request: ShipmentActionRequest): ApiResponse<Unit>

    @POST("agent-portal/shipments/{id}/mark-in-transit")
    suspend fun markInTransit(@Path("id") id: String, @Body request: ShipmentActionRequest): ApiResponse<Unit>

    @POST("agent-portal/shipments/{id}/arrived")
    suspend fun markArrived(@Path("id") id: String, @Body request: ShipmentActionRequest): ApiResponse<Unit>

    @POST("agent-portal/shipments/{id}/out-for-delivery")
    suspend fun markOutForDelivery(@Path("id") id: String, @Body request: ShipmentActionRequest): ApiResponse<Unit>

    @POST("agent-portal/shipments/{id}/deliver")
    suspend fun deliverShipment(@Path("id") id: String, @Body request: ShipmentActionRequest): ApiResponse<Unit>

    @POST("agent-portal/shipments/{id}/request-return")
    suspend fun requestReturnShipment(@Path("id") id: String, @Body request: ShipmentActionRequest): ApiResponse<Unit>

    @POST("agent-portal/shipments/{id}/mark-returned")
    suspend fun markReturnedShipment(@Path("id") id: String, @Body request: ShipmentActionRequest): ApiResponse<Unit>

    @GET("agent-portal/financial-statement")
    suspend fun getFinancialStatement(): ApiResponse<FinancialStatement>

    @GET("agent-portal/account-statement")
    suspend fun getAccountStatement(): ApiResponse<AccountStatement>

    @GET("agent-portal/transfers")
    suspend fun getTransfers(): ApiResponse<TransfersPage>

    @GET("agent-portal/transfers/{id}")
    suspend fun getTransferDetails(@Path("id") id: String): ApiResponse<AgentTransferDetails>

    @POST("agent-portal/transfers")
    suspend fun createTransfer(@Body request: CreateAgentTransferRequest): ApiResponse<AgentTransfer>

    @POST("agent-portal/transfers/{id}/complete")
    suspend fun completeTransfer(@Path("id") id: String): ApiResponse<AgentTransfer>
}
