package com.abooerp.dataentry.data

import com.squareup.moshi.JsonClass

// NOTE: these mirror the API shape this screen layer expects from the
// backend. The /shift/* and /ledger/* endpoints don't exist yet on the
// server — this is the design/screens phase agreed with the manager;
// wiring against real endpoints is the next phase, after printing is
// deliberately left for last.

@JsonClass(generateAdapter = false)
data class ApiResponse<T>(
    val success: Boolean,
    val data: T? = null,
    val error: String? = null,
)

@JsonClass(generateAdapter = false)
data class LoginRequest(val username: String, val password: String)

@JsonClass(generateAdapter = false)
data class SessionData(val accessToken: String, val refreshToken: String)

@JsonClass(generateAdapter = false)
data class UserData(
    val id: String,
    val username: String,
    val fullName: String?,
    val userType: String,
    val branchId: String? = null,
)

@JsonClass(generateAdapter = false)
data class BranchInfo(val id: String, val code: String?, val name: String)

@JsonClass(generateAdapter = false)
data class LoginResponseData(val user: UserData, val session: SessionData)

@JsonClass(generateAdapter = false)
data class AgentQuickCode(
    val id: String,
    val code: String,
    val name: String?,
    val governorate: String?,
    @com.squareup.moshi.Json(name = "is_active") val isActive: Boolean = true,
)

enum class ShiftStatus { NONE, OPEN, PENDING_CONFIRMATION, CONFIRMED, REJECTED }

data class CurrencyBalance(val currencyCode: String, val amount: Double)

data class Shift(
    val id: String,
    val employeeName: String,
    val status: ShiftStatus,
    val openedAt: String,
    val closedAt: String? = null,
    // Cash handed to the employee by the accountant at shift start — kept
    // separate from `balances` (which is opening + collected-today) so the
    // closing summary can show both clearly to the accountant.
    val openingBalances: List<CurrencyBalance> = emptyList(),
    val balances: List<CurrencyBalance> = emptyList(),
    val rowCount: Int = 0,
    val rejectionReason: String? = null,
)

// Real, existing endpoint (same one the desktop app uses): POST
// /daily-ledger/rows/upsert. lineLabel groups rows into a session — tablet
// intake always uses a fixed, distinguishable label so office staff can
// spot and later transfer these rows into a real trip session.
@JsonClass(generateAdapter = false)
data class UpsertLedgerRowRequest(
    val branchId: String,
    val ledgerDate: String,
    val lineLabel: String,
    val rowNo: Int,
    val receiptNo: String? = null,
    val destination: String? = null,
    val parcelType: String? = null,
    val parcelCount: Int? = null,
    val weightKg: Double? = null,
    val senderName: String? = null,
    val receiverName: String? = null,
    val collectAmountUsd: Double? = null,
    val prepaidAmountUsd: Double? = null,
    val hawalaAmountUsd: Double? = null,
    val transferServiceFeeUsd: Double? = null,
    val notes: String? = null,
)

// Raw daily_ledger_rows DB row as returned by the server (snake_case,
// numeric columns come back as strings from Postgres).
@JsonClass(generateAdapter = false)
data class LedgerRowRemote(
    val id: String,
    @com.squareup.moshi.Json(name = "row_no") val rowNo: Int,
    @com.squareup.moshi.Json(name = "receipt_no") val receiptNo: String?,
    val destination: String?,
    @com.squareup.moshi.Json(name = "parcel_type") val parcelType: String?,
    @com.squareup.moshi.Json(name = "parcel_count") val parcelCount: Int?,
    @com.squareup.moshi.Json(name = "weight_kg") val weightKg: String?,
    @com.squareup.moshi.Json(name = "sender_name") val senderName: String?,
    @com.squareup.moshi.Json(name = "receiver_name") val receiverName: String?,
    @com.squareup.moshi.Json(name = "collect_amount_usd") val collectAmountUsd: String?,
    @com.squareup.moshi.Json(name = "prepaid_amount_usd") val prepaidAmountUsd: String?,
    @com.squareup.moshi.Json(name = "hawala_amount_usd") val hawalaAmountUsd: String?,
    @com.squareup.moshi.Json(name = "transfer_service_fee_usd") val transferServiceFeeUsd: String?,
    val notes: String?,
    @com.squareup.moshi.Json(name = "created_at") val createdAt: String?,
)

// Field order mirrors the real desktop ledger table exactly (server of
// truth: ShipmentQuickLedger.tsx columns), so staff moving between the
// tablet and the office PC see the same sequence: goods type, pieces,
// weight, collect, hawala, hawala fee, prepaid, sender, receiver,
// destination, receipt no, notes.
data class LedgerRow(
    val id: String,
    val rowNo: Int = 0,
    val parcelType: String,
    val parcelCount: Int,
    val weightKg: Double,
    val collectAmount: Double,
    val hawalaAmount: Double,
    val hawalaFee: Double,
    val prepaidAmount: Double,
    val senderName: String,
    val receiverName: String,
    val destination: String,
    val receiptNo: String,
    val notes: String,
    val currencyCode: String,
    val createdAt: String,
    val syncStatus: QueuedRowStatus = QueuedRowStatus.SYNCED,
)

// Offline-first queue: every row is written here THE INSTANT it's entered
// (before any network call), so it survives an app crash/restart even if
// it was never sent. A row moves PENDING -> SYNCED once the server confirms
// it, and — critically — a SYNCED row is never resent, because by then a
// desk reviewer may have already edited it on the office PC; resending
// would silently overwrite that edit. FAILED means the server rejected it
// outright (bad data), which retrying won't fix, so it needs the employee's
// attention instead of being retried forever.
enum class QueuedRowStatus { PENDING, SYNCED, FAILED }

// Real, existing endpoint (same one the agent app uses): GET
// /app/version?platform=android-dataentry — a distinct platform value from
// the agent app's "android" so each app only ever sees its own releases.
@JsonClass(generateAdapter = false)
data class AppVersionInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val changelog: String? = null,
    val mandatory: Boolean = false,
)

// Real, existing endpoint: POST /custody-shifts — opens a custody
// (عهدة) for this employee on the server, replacing the old local-only
// shift state. holderType is always "data_entry_employee" from this app.
@JsonClass(generateAdapter = false)
data class OpeningBalanceRequest(
    val currencyCode: String,
    val amount: Double,
)

@JsonClass(generateAdapter = false)
data class OpenCustodyShiftRequest(
    val branchId: String? = null,
    val holderType: String = "data_entry_employee",
    val holderUserId: String,
    val holderLabel: String? = null,
    val openingBalances: List<OpeningBalanceRequest>,
)

@JsonClass(generateAdapter = false)
data class CustodyBalanceRemote(
    val currencyCode: String,
    val openingAmount: String?,
    val currentAmount: String?,
)

// Raw custody_shifts DB row as returned by the server.
@JsonClass(generateAdapter = false)
data class CustodyShiftRemote(
    val id: String,
    @com.squareup.moshi.Json(name = "holder_user_id") val holderUserId: String?,
    val status: String,
    @com.squareup.moshi.Json(name = "opened_at") val openedAt: String,
    @com.squareup.moshi.Json(name = "closed_at") val closedAt: String?,
    @com.squareup.moshi.Json(name = "rejection_reason") val rejectionReason: String?,
    val balances: List<CustodyBalanceRemote> = emptyList(),
)

@JsonClass(generateAdapter = false)
data class QueuedLedgerRow(
    val localId: String,
    val request: UpsertLedgerRowRequest,
    val status: QueuedRowStatus,
    val lastError: String? = null,
    val serverId: String? = null,
    val serverCreatedAt: String? = null,
)
