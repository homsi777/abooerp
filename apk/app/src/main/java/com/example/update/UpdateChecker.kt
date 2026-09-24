package com.example.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.example.BuildConfig
import com.example.data.AppVersionInfo
import com.example.network.ApiService
import java.io.File

private sealed class UpdateState {
    object Idle : UpdateState()
    data class Available(val info: AppVersionInfo) : UpdateState()
    object Downloading : UpdateState()
    object ReadyToInstall : UpdateState()
}

/**
 * Checks our own /app/version endpoint once per app start and, if a newer
 * build than the one installed is available, offers to download and install
 * it directly — the app isn't distributed through Play Store, so this is
 * the only update channel agents/customers have.
 */
@Composable
fun UpdateGate(apiService: ApiService) {
    val context = LocalContext.current
    var state by remember { mutableStateOf<UpdateState>(UpdateState.Idle) }
    var downloadedFile by remember { mutableStateOf<File?>(null) }

    LaunchedEffect(Unit) {
        try {
            val response = apiService.getAppVersion("android")
            val info = response.data
            if (response.success && info != null && info.versionCode > BuildConfig.VERSION_CODE) {
                state = UpdateState.Available(info)
            }
        } catch (_: Exception) {
            // No update-check on this run is fine — never block the app over this.
        }
    }

    val current = state
    if (current is UpdateState.Available) {
        AlertDialog(
            onDismissRequest = { if (!current.info.mandatory) state = UpdateState.Idle },
            title = { Text("يتوفر تحديث جديد (${current.info.versionName})") },
            text = { Text(current.info.changelog?.takeIf { it.isNotBlank() } ?: "يتوفر إصدار أحدث من التطبيق.") },
            confirmButton = {
                TextButton(onClick = {
                    state = UpdateState.Downloading
                    downloadApk(context, current.info.apkUrl) { file ->
                        downloadedFile = file
                        state = UpdateState.ReadyToInstall
                    }
                }) { Text("تحميل وتثبيت") }
            },
            dismissButton = if (current.info.mandatory) null else {
                { TextButton(onClick = { state = UpdateState.Idle }) { Text("لاحقاً") } }
            },
        )
    } else if (current is UpdateState.Downloading) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text("جاري تحميل التحديث...") },
            text = { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) },
            confirmButton = {},
        )
    }

    LaunchedEffect(current is UpdateState.ReadyToInstall, downloadedFile) {
        if (current is UpdateState.ReadyToInstall) {
            downloadedFile?.let { file -> promptInstall(context, file) }
            state = UpdateState.Idle
        }
    }
}

private fun downloadApk(context: Context, apkUrl: String, onComplete: (File) -> Unit) {
    val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val targetFile = File(context.getExternalFilesDir(null), "update.apk")
    if (targetFile.exists()) targetFile.delete()

    val request = DownloadManager.Request(Uri.parse(apkUrl))
        .setTitle("تحديث التطبيق")
        .setDestinationUri(Uri.fromFile(targetFile))
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)

    val downloadId = downloadManager.enqueue(request)

    val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            if (completedId == downloadId) {
                ctx.unregisterReceiver(this)
                onComplete(targetFile)
            }
        }
    }
    ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
        ContextCompat.RECEIVER_EXPORTED,
    )
}

private fun promptInstall(context: Context, file: File) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !context.packageManager.canRequestPackageInstalls()
    ) {
        // Ask the user to allow installs from this app once — required on
        // Android 8+ for any app installed outside Play Store.
        val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            .setData(Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(settingsIntent)
        return
    }

    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(installIntent)
}
