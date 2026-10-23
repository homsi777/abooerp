package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.data.local.TokenManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExampleRobolectricTest {

  @Test
  fun testAppNameResource() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val appName = context.getString(R.string.app_name)
    assertEquals("عبو المحمود", appName)
  }

  @Test
  fun testTokenManagerEncryptedStorage() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val tokenManager = TokenManager(context)
    tokenManager.clear()

    assertFalse(tokenManager.isLoggedIn)
    assertFalse(tokenManager.isDemoMode)

    tokenManager.saveSession(
      access = "test_access_jwt",
      refresh = "test_refresh_token",
      user = "driver_omar",
      dId = "driver-uuid-123"
    )

    assertTrue(tokenManager.isLoggedIn)
    assertFalse(tokenManager.isDemoMode)
    assertEquals("test_access_jwt", tokenManager.accessToken)
    assertEquals("driver_omar", tokenManager.username)
    assertEquals("driver-uuid-123", tokenManager.driverId)

    // Demo session
    tokenManager.saveDemoSession("driver_demo")
    assertTrue(tokenManager.isLoggedIn)
    assertTrue(tokenManager.isDemoMode)

    tokenManager.clear()
    assertFalse(tokenManager.isLoggedIn)
    assertFalse(tokenManager.isDemoMode)
  }
}
