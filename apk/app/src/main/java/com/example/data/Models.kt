package com.example.data

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = false)
data class ApiResponse<T>(
    val success: Boolean,
    val data: T? = null,
    val error: String? = null,
    val correlationId: String? = null
)

@JsonClass(generateAdapter = false)
data class LoginRequest(
    val username: String,
    val password: String,
    val branchId: String? = null
)

@JsonClass(generateAdapter = false)
data class LoginResponseData(
    val user: UserData,
    val session: SessionData
)

@JsonClass(generateAdapter = false)
data class UserData(
    val id: String,
    val username: String,
    val role: String,
    val permissions: List<String>,
    val userType: String,
    val companyId: String,
    val baseCurrency: String,
    val branchId: String?,
    val allowedBranchIds: List<String>,
    val agentId: String?
)

@JsonClass(generateAdapter = false)
data class SessionData(
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String,
    val expiresIn: String?
)

@JsonClass(generateAdapter = false)
data class RefreshRequest(
    val refreshToken: String,
    val branchId: String? = null
)

@JsonClass(generateAdapter = false)
data class LogoutRequest(
    val refreshToken: String
)

@JsonClass(generateAdapter = false)
data class AgentProfile(
    val id: String,
    val code: String?,
    val name: String?,
    val phone: String?,
    val governorate: String?,
    val city: String?,
    val area: String?,
    val address: String? = null,
    @Json(name = "branch_id") val branchId: String? = null,
    @Json(name = "commission_percentage") val commissionPercentage: Double? = 0.0,
    @Json(name = "is_active") val isActive: Boolean? = true
)

@JsonClass(generateAdapter = false)
data class ProfileResponse(
    val agent: AgentProfile,
    val branchLabel: String?,
    val username: String?
)

@JsonClass(generateAdapter = false)
data class WorkspaceSummary(
    val counts: SummaryCounts,
    val totals: SummaryTotals,
    val financeToday: FinanceToday? = null
)

@JsonClass(generateAdapter = false)
data class SummaryCounts(
    @Json(name = "CONFIRMED") val confirmed: Int = 0,
    @Json(name = "AGENT_RECEIVED") val agentReceived: Int = 0,
    @Json(name = "OUT_FOR_DELIVERY") val outForDelivery: Int = 0,
    @Json(name = "DELIVERED") val delivered: Int = 0
)

@JsonClass(generateAdapter = false)
data class SummaryTotals(
    val all: Int = 0,
    val today: Int = 0,
    val upcoming: Int = 0
)

@JsonClass(generateAdapter = false)
data class FinanceToday(
    val receiptVouchers: Int = 0,
    val paymentVouchers: Int = 0
)

@JsonClass(generateAdapter = false)
data class Shipment(
    val id: String,
    @Json(name = "shipment_no") val trackingNumber: String?,
    @Json(name = "created_at") val date: String?,
    @Json(name = "branch_id") val branchId: String?,
    @Json(name = "agent_id") val agentId: String?,
    @Json(name = "origin_city") val sourceBranch: String?,
    @Json(name = "destination_city") val destinationBranch: String?,
    @Json(name = "sender_name") val senderName: String?,
    @Json(name = "receiver_name") val receiverName: String?,
    @Json(name = "pieces_count") val pieces: Int?,
    @Json(name = "loaded_pieces_count") val loadedPiecesCount: Int? = 0,
    @Json(name = "weight_kg") val weight: Double?,
    @Json(name = "original_amount") val amount: Double?,
    @Json(name = "original_currency") val currency: String?,
    @Json(name = "freight_charge") val freightCharge: Double? = 0.0,
    @Json(name = "transfer_fee") val senderCollectionAmount: Double? = 0.0,
    @Json(name = "hawala_amount") val hawalaAmount: Double? = 0.0,
    @Json(name = "transfer_service_fee") val transferServiceFee: Double? = 0.0,
    @Json(name = "additional_charges") val additionalCharges: Double? = 0.0,
    @Json(name = "prepaid_amount") val prepaidAmount: Double? = 0.0,
    @Json(name = "agent_commission_percentage_snapshot") val agentCommissionPercentageSnapshot: Double? = 0.0,
    @Json(name = "agent_commission_amount_snapshot") val agentCommissionAmountSnapshot: Double? = 0.0,
    val status: String?,
    val description: String? = null,
    @Json(name = "sender_phone") val senderPhone: String? = null,
    @Json(name = "receiver_phone") val receiverPhone: String? = null,
    val note: String? = null
)

@JsonClass(generateAdapter = false)
data class ShipmentActionRequest(
    val note: String? = null,
    val metadata: Map<String, String>? = null
)

@JsonClass(generateAdapter = false)
data class ShipmentPortalDetails(
    val shipmentInfo: ShipmentInfo,
    val shipmentFinancials: ShipmentFinancials,
    val linkedTransfer: AgentTransfer? = null
)

@JsonClass(generateAdapter = false)
data class ShipmentInfo(
    val id: String,
    val shipmentNo: String?,
    val createdAt: String?,
    val status: String?,
    val sourceCity: String?,
    val destinationCity: String?,
    val senderName: String?,
    val senderPhone: String?,
    val receiverName: String?,
    val receiverPhone: String?,
    val piecesCount: Int? = 0,
    val loadedPiecesCount: Int? = 0,
    val weightKg: Double? = 0.0,
    val description: String? = null
)

@JsonClass(generateAdapter = false)
data class ShipmentFinancials(
    val currency: String?,
    val shippingFee: Double? = 0.0,
    val senderCollectionAmount: Double? = 0.0,
    val additionalCharges: Double? = 0.0,
    val generalCollectionAmount: Double? = 0.0,
    val prepaidAmount: Double? = 0.0,
    val discountAmount: Double? = 0.0,
    val shippingAmountToCollectOnDelivery: Double? = 0.0,
    val linkedTransferPrincipal: Double? = 0.0,
    val linkedTransferServiceFee: Double? = 0.0,
    val totalAmountToCollectOnDelivery: Double? = 0.0,
    val agentCommissionPercentage: Double? = 0.0,
    val agentCommissionAmount: Double? = 0.0
)

@JsonClass(generateAdapter = false)
data class FinancialStatement(
    val agent: FinancialAgent?,
    val currency: String?,
    val summary: FinancialSummary?,
    val period: FinancialPeriod?
)

@JsonClass(generateAdapter = false)
data class FinancialAgent(
    val id: String?,
    val code: String?,
    val name: String?,
    val commissionPercentage: Double?
)

@JsonClass(generateAdapter = false)
data class FinancialSummary(
    val totalShippingCommission: Double? = 0.0,
    val totalTransferCommission: Double? = 0.0,
    val totalDue: Double? = 0.0,
    val totalPaid: Double? = 0.0,
    val balance: Double? = 0.0,
    val lastReconciliationDate: String? = null,
    val balanceAfterLastReconciliation: Double? = 0.0
)

@JsonClass(generateAdapter = false)
data class FinancialPeriod(
    val fromDate: String? = null,
    val toDate: String? = null
)

@JsonClass(generateAdapter = false)
data class Movement(
    val id: String?,
    val date: String?,
    val sourceType: String?,
    val referenceType: String?,
    val referenceId: String?,
    val referenceNo: String?,
    val description: String?,
    val debit: Double?,
    val credit: Double?,
    val currency: String?,
    val status: String?,
    val balance: Double? = null
)

@JsonClass(generateAdapter = false)
data class AccountStatement(
    val agent: FinancialAgent? = null,
    val currency: String? = null,
    val openingBalance: Double? = 0.0,
    val closingBalance: Double? = 0.0,
    val lastReconciliationDate: String? = null,
    val movements: List<Movement>? = emptyList(),
    val pagination: Pagination? = null
)

@JsonClass(generateAdapter = false)
data class Pagination(
    val limit: Int? = 0,
    val offset: Int? = 0,
    val total: Int? = 0
)

@JsonClass(generateAdapter = false)
data class AgentTransfer(
    val id: String?,
    val transferNo: String?,
    val type: String? = null,
    val createdAt: String?,
    val senderName: String?,
    val receiverName: String?,
    val amount: Double?,
    val principalAmount: Double? = null,
    val currency: String?,
    val serviceFee: Double?,
    val transferFee: Double? = null,
    val serviceFeeCurrency: String?,
    val agentCommission: Double?,
    val agentCommissionCurrency: String?,
    val status: String?,
    val linkedShipmentNo: String?,
    val linkedShipment: LinkedShipment? = null,
    val notes: String?,
    val destinationCity: String? = null,
    val sourceCity: String? = null,
    val originAgentName: String? = null,
    val destinationAgentName: String? = null,
    val collectedAt: String? = null,
    val paidOutAt: String? = null,
    val cancelledAt: String? = null,
    val currentAgentRole: String? = null,
    val canCurrentAgentComplete: Boolean? = false,
    val canDeliver: Boolean? = false,
    val shouldCurrentAgentPayPrincipal: Boolean? = false,
    val isTransferFeeIncomeRecognized: Boolean? = false
)

@JsonClass(generateAdapter = false)
data class TransfersPage(
    val items: List<AgentTransfer>? = emptyList(),
    val pagination: Pagination? = null
)

@JsonClass(generateAdapter = false)
data class AgentTransferDetails(
    val id: String?,
    val transferNo: String?,
    val createdAt: String?,
    val senderName: String?,
    val senderPhone: String?,
    val receiverName: String?,
    val receiverPhone: String?,
    val amount: Double?,
    val currency: String?,
    val serviceFee: Double?,
    val serviceFeeCurrency: String?,
    val agentCommission: Double?,
    val agentCommissionCurrency: String?,
    val status: String?,
    val notes: String?,
    val completedAt: String?,
    val linkedShipment: LinkedShipment?
)

@JsonClass(generateAdapter = false)
data class CreateAgentTransferRequest(
    val senderName: String,
    val receiverName: String,
    val destinationCity: String,
    val amount: Double,
    val currency: String = "USD",
    val transferServiceFee: Double = 0.0,
    val notes: String? = null
)

@JsonClass(generateAdapter = false)
data class LinkedShipment(
    val id: String?,
    val shipmentNo: String?
)
