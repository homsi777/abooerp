package com.example.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// Soothing Sky Blue Light Palette (لوحة الأزرق السماوي المريحة للعين - فاتحة بالكامل بدون أي خلفية داكنة)
private val LightSkyColorScheme =
  lightColorScheme(
    primary = SkyBluePrimary,                     // Color(0xFF0284C7) Sky 600
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0F2FE),        // Sky 100
    onPrimaryContainer = Color(0xFF03446A),       // Sky 900
    inversePrimary = SkyBlueLight,                // Sky 400
    secondary = SkyBlueNavy,                     // Sky 800
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFBAE6FD),      // Sky 200
    onSecondaryContainer = Color(0xFF082F49),
    tertiary = Color(0xFF0284C7),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE0F2FE),
    onTertiaryContainer = Color(0xFF03446A),
    background = LightBackground,                // Color(0xFFF4F9FD) - خلفية مريحة وفاتحة
    onBackground = LightOnSurface,               // Color(0xFF0F2435) - نصوص واضحة ومقروءة
    surface = LightSurface,                      // Color(0xFFFFFFFF) - بطاقات بيضاء نقية
    onSurface = LightOnSurface,                  // Color(0xFF0F2435)
    surfaceVariant = LightSurfaceVariant,        // Color(0xFFE5F1F9)
    onSurfaceVariant = LightOnSurfaceVariant,    // Color(0xFF476378)
    outline = Color(0xFF94A3B8),                 // Slate 400
    outlineVariant = Color(0xFFCBD5E1),          // Slate 300
    error = Color(0xFFDC2626),
    onError = Color.White,
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF991B1B)
  )

// M3 Shapes with comfortable rounded corners for driver usability
val DriverAppShapes = Shapes(
  extraSmall = RoundedCornerShape(6.dp),
  small = RoundedCornerShape(10.dp),
  medium = RoundedCornerShape(14.dp),
  large = RoundedCornerShape(18.dp),
  extraLarge = RoundedCornerShape(24.dp)
)

@Composable
fun MyApplicationTheme(
  darkTheme: Boolean = false, // Forced light theme per user requirement
  dynamicColor: Boolean = false,
  content: @Composable () -> Unit,
) {
  // Always enforce the clean light theme with zero dark backgrounds
  MaterialTheme(
    colorScheme = LightSkyColorScheme,
    typography = Typography,
    shapes = DriverAppShapes,
    content = content
  )
}
