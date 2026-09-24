package com.example.network

import com.example.data.AuthStorage
import com.example.data.RefreshRequest
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * Silently exchanges the refresh token for a new access token whenever a request
 * comes back 401, instead of surfacing "session expired" to the user during normal
 * use. The access token only lives 15 minutes server-side, but the refresh token
 * lives 7 days — this keeps the agent logged in transparently for that whole window.
 *
 * Uses a separate, un-intercepted ApiService (refreshApi) so refreshing the token
 * doesn't itself go through this authenticator and loop forever.
 */
class TokenAuthenticator(
    private val authStorage: AuthStorage,
    private val refreshApi: ApiService,
) : Authenticator {

    override fun authenticate(route: Route?, response: Response): Request? {
        // Never retry more than twice for the same original request.
        if (responseCount(response) >= 3) return null

        val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")

        synchronized(this) {
            // Another thread may have already refreshed the token while we were
            // waiting on the lock — if so, just retry the request with it.
            val currentToken = authStorage.getAccessToken()
            if (currentToken != null && currentToken != failedToken) {
                return response.request.newBuilder()
                    .header("Authorization", "Bearer $currentToken")
                    .build()
            }

            val refreshToken = authStorage.getRefreshToken()
            if (refreshToken.isNullOrBlank()) return null

            val newSession = try {
                runBlocking {
                    val res = refreshApi.refresh(RefreshRequest(refreshToken))
                    if (res.success && res.data != null) res.data.session else null
                }
            } catch (_: Exception) {
                null
            }

            if (newSession == null) {
                // Refresh token itself is expired/revoked — this is the one case where
                // the user genuinely has to log in again.
                authStorage.clear()
                return null
            }

            authStorage.saveTokens(newSession.accessToken, newSession.refreshToken)
            return response.request.newBuilder()
                .header("Authorization", "Bearer ${newSession.accessToken}")
                .build()
        }
    }

    private fun responseCount(response: Response): Int {
        var result = 1
        var prior = response.priorResponse
        while (prior != null) {
            result++
            prior = prior.priorResponse
        }
        return result
    }
}
