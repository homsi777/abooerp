package com.abooerp.dataentry.printer

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import androidx.core.content.ContextCompat
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

sealed class PrintResult {
    object Success : PrintResult()
    data class Failure(val message: String) : PrintResult()
}

/**
 * Connects directly to an already-PAIRED (bonded) printer over classic
 * Bluetooth SPP and streams raw ESC/POS bytes — no system dialog, no
 * notification, completely silent, exactly like the desktop app's
 * default-printer flow. Pairing itself still happens once via the phone's
 * own Bluetooth settings; this only ever talks to a device already bonded,
 * which is also why no scan/location permission is needed here.
 */
class BluetoothPrinterManager(private val context: Context) {

    fun hasBluetoothPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    }

    fun bondedPrinters(): List<BluetoothDevice> {
        if (!hasBluetoothPermission()) return emptyList()
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return emptyList()
        return try {
            adapter.bondedDevices?.toList() ?: emptyList()
        } catch (_: SecurityException) {
            emptyList()
        }
    }

    suspend fun printBitmap(macAddress: String, bitmap: Bitmap): PrintResult = withContext(Dispatchers.IO) {
        if (!hasBluetoothPermission()) return@withContext PrintResult.Failure("صلاحية البلوتوث غير مفعّلة")
        val adapter = BluetoothAdapter.getDefaultAdapter()
            ?: return@withContext PrintResult.Failure("لا يوجد بلوتوث على هذا الجهاز")
        var socket: BluetoothSocket? = null
        try {
            val device = adapter.getRemoteDevice(macAddress)
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            // No cancelDiscovery() call — we never scan for devices (only
            // ever connect to an already-bonded one), and cancelDiscovery()
            // itself requires BLUETOOTH_SCAN, a permission this app
            // deliberately never requests, which threw a SecurityException here.
            socket.connect()
            // Written as separate chunks (not one big blob), each followed
            // by a pause proportional to how many dot-rows it prints — a
            // fixed delay was too short for longer receipts (a full print
            // head's-worth of rows takes real time to physically burn),
            // which silently dropped/garbled whatever came near the end
            // (often the notes line, since it's close to the footer).
            for (chunk in EscPosRaster.renderChunks(bitmap)) {
                socket.outputStream.write(chunk.bytes)
                socket.outputStream.flush()
                val waitMs = if (chunk.rows > 0) (chunk.rows * 4L).coerceAtLeast(40L) else 30L
                delay(waitMs)
            }
            PrintResult.Success
        } catch (e: IOException) {
            PrintResult.Failure("تعذر الاتصال بالطابعة: ${e.message ?: "تأكدي أنها مُشغّلة وقريبة"}")
        } catch (e: SecurityException) {
            PrintResult.Failure("صلاحية البلوتوث مرفوضة")
        } finally {
            try { socket?.close() } catch (_: IOException) { }
        }
    }
}
