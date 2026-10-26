package com.abooerp.dataentry.printer

import android.graphics.Bitmap
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** Most network ESC/POS thermal printers listen on raw port 9100 ("JetDirect"). */
const val DEFAULT_NETWORK_PRINTER_PORT = 9100

/**
 * Prints to a thermal printer over plain TCP/IP (same Wi-Fi/LAN as the
 * phone) — same silent, no-dialog flow as [BluetoothPrinterManager], just a
 * raw socket instead of an RFCOMM one, and reusing the exact same ESC/POS
 * chunked-write pattern so timing-sensitive printers behave identically
 * either way.
 */
class NetworkPrinterManager {

    suspend fun printBitmap(host: String, port: Int, bitmap: Bitmap): PrintResult = withContext(Dispatchers.IO) {
        if (host.isBlank()) return@withContext PrintResult.Failure("عنوان IP للطابعة فارغ")
        var socket: Socket? = null
        try {
            socket = Socket()
            socket.connect(InetSocketAddress(host, port), 5000)
            for (chunk in EscPosRaster.renderChunks(bitmap)) {
                socket.getOutputStream().write(chunk.bytes)
                socket.getOutputStream().flush()
                val waitMs = if (chunk.rows > 0) (chunk.rows * 4L).coerceAtLeast(40L) else 30L
                delay(waitMs)
            }
            PrintResult.Success
        } catch (e: IOException) {
            PrintResult.Failure("تعذر الاتصال بالطابعة على $host:$port — تأكدي أنها على نفس الشبكة ومُشغّلة")
        } finally {
            try { socket?.close() } catch (_: IOException) { }
        }
    }
}
