package com.abooerp.dataentry.network

import com.abooerp.dataentry.data.AgentQuickCode
import com.abooerp.dataentry.data.ApiResponse
import com.abooerp.dataentry.data.AppVersionInfo
import com.abooerp.dataentry.data.BranchInfo
import com.abooerp.dataentry.data.CustodyShiftRemote
import com.abooerp.dataentry.data.LedgerRowRemote
import com.abooerp.dataentry.data.LoginRequest
import com.abooerp.dataentry.data.LoginResponseData
import com.abooerp.dataentry.data.OpenCustodyShiftRequest
import com.abooerp.dataentry.data.ParcelRemote
import com.abooerp.dataentry.data.ParcelScanRequest
import com.abooerp.dataentry.data.ReservedReceiptNumbers
import com.abooerp.dataentry.data.ReserveReceiptNumbersRequest
import com.abooerp.dataentry.data.UpsertLedgerRowRequest
import com.abooerp.dataentry.data.UserData
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {
    // Real, already-existing endpoints shared with the desktop app —
    // rows saved here land in the same daily_ledger_rows table office
    // staff already see, immediately, regardless of shift status.
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): ApiResponse<LoginResponseData>

    @GET("auth/branches")
    suspend fun getBranches(): ApiResponse<List<BranchInfo>>

    // Server-authoritative "who am I" — used to self-heal a locally stale
    // or missing user id (see ShiftViewModel.restoreActiveShift) instead of
    // ever trusting only what was cached on-device at login time.
    @GET("auth/me")
    suspend fun getMe(): ApiResponse<UserData>

    // Powers the destination quick-code lookup (typing "12" -> القامشلي).
    @GET("agents")
    suspend fun getAgents(): ApiResponse<List<AgentQuickCode>>

    @GET("app/version")
    suspend fun getAppVersion(@Query("platform") platform: String = "android-dataentry"): ApiResponse<AppVersionInfo>

    @POST("daily-ledger/rows/upsert")
    suspend fun upsertLedgerRow(@Body request: UpsertLedgerRowRequest): ApiResponse<LedgerRowRemote>

    /** Reserves a block of company-wide-unique receipt numbers to spend
     *  offline — see [com.abooerp.dataentry.data.ReceiptNumberStore]. */
    @POST("parcels/receipt-numbers/reserve")
    suspend fun reserveReceiptNumbers(@Body request: ReserveReceiptNumbersRequest): ApiResponse<ReservedReceiptNumbers>

    /** Looks a scanned QR up without changing anything. */
    @GET("parcels/lookup")
    suspend fun lookupParcel(@Query("code") code: Long): ApiResponse<ParcelRemote>

    /** Advances the parcel to its next status; the server decides which. */
    @POST("parcels/scan")
    suspend fun scanParcel(@Body request: ParcelScanRequest): ApiResponse<ParcelRemote>

    @GET("daily-ledger/rows")
    suspend fun getLedgerRows(
        @Query("branchId") branchId: String,
        @Query("dateFrom") dateFrom: String,
        @Query("dateTo") dateTo: String,
        @Query("lineLabel") lineLabel: String? = null,
        @Query("limit") limit: Int = 500,
    ): ApiResponse<List<LedgerRowRemote>>

    // Real, existing endpoint (same one the desktop accountant screen
    // reads from) — the tablet's "وردية" now lives on the server, visible
    // to the accountant instantly instead of only on this device.
    @GET("custody-shifts")
    suspend fun getCustodyShifts(@Query("status") status: String? = null): ApiResponse<List<CustodyShiftRemote>>

    @POST("custody-shifts")
    suspend fun openCustodyShift(@Body request: OpenCustodyShiftRequest): ApiResponse<CustodyShiftRemote>

    @POST("custody-shifts/{id}/close")
    suspend fun closeCustodyShift(@Path("id") id: String): ApiResponse<CustodyShiftRemote>
}
