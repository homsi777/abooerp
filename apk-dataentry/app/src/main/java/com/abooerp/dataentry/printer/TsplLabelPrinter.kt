package com.abooerp.dataentry.printer

import android.graphics.Bitmap
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** Label printers listen on the same raw port receipt printers do. */
const val DEFAULT_LABEL_PRINTER_PORT = 9100

/**
 * Prints a parcel label to a TSPL label printer (Xprinter XP-350BM and
 * friends) over plain TCP.
 *
 * TSPL — not ESC/POS: this printer only emulates ESC/POS text and ignores
 * its raster-image command entirely, so [EscPosRaster] cannot be reused
 * here. All of the quirks below were established against the real unit:
 *
 *  - The image goes out as TSPL's own `BITMAP` command.
 *  - Its bit convention is INVERTED versus ESC/POS: 1 = white/background,
 *    0 = black/ink.
 *  - The job must be written in small chunks and the socket must linger on
 *    close; a single large write followed by an immediate close silently
 *    truncated the job (small labels printed, full-size ones did not).
 */
class TsplLabelPrinter {

    suspend fun printLabel(host: String, port: Int, bitmap: Bitmap): PrintResult = withContext(Dispatchers.IO) {
        if (host.isBlank()) return@withContext PrintResult.Failure("عنوان IP لطابعة اللصاقات فارغ")

        val widthMm = Math.ceil(bitmap.width / 8.0).toInt()
        val heightMm = Math.ceil(bitmap.height / 8.0).toInt()
        val mono = toMonochrome(bitmap)

        val header = "SIZE $widthMm mm, $heightMm mm\r\nGAP 2 mm, 0 mm\r\nCLS\r\n" +
            "BITMAP 0,0,${mono.bytesPerRow},${bitmap.height},0,"
        val footer = "\r\nPRINT 1,1\r\n"

        val job = header.toByteArray(Charsets.US_ASCII) + mono.bits + footer.toByteArray(Charsets.US_ASCII)

        var socket: Socket? = null
        try {
            socket = Socket()
            socket.tcpNoDelay = true
            socket.setSoLinger(true, 15)
            socket.connect(InetSocketAddress(host, port), 5000)
            val out = socket.getOutputStream()
            var sent = 0
            while (sent < job.size) {
                val n = minOf(1024, job.size - sent)
                out.write(job, sent, n)
                out.flush()
                sent += n
                delay(15)
            }
            // Let the printer drain what is still in flight before the
            // socket goes away.
            delay(2000)
            PrintResult.Success
        } catch (e: IOException) {
            PrintResult.Failure("تعذر الاتصال بطابعة اللصاقات على $host:$port — تأكدي أنها على نفس الشبكة ومُشغّلة")
        } finally {
            try { socket?.close() } catch (_: IOException) { }
        }
    }

    private class Monochrome(val bits: ByteArray, val bytesPerRow: Int)

    /** Packs the bitmap for TSPL `BITMAP`: one bit per pixel, rows padded to
     *  whole bytes, and inverted (bit set = white) as this firmware expects. */
    private fun toMonochrome(bitmap: Bitmap): Monochrome {
        val width = bitmap.width
        val height = bitmap.height
        val bytesPerRow = (width + 7) / 8
        val bits = ByteArray(bytesPerRow * height) { 0xFF.toByte() }
        val row = IntArray(width)

        for (y in 0 until height) {
            bitmap.getPixels(row, 0, width, 0, y, width, 1)
            for (x in 0 until width) {
                val pixel = row[x]
                val r = (pixel shr 16) and 0xFF
                val g = (pixel shr 8) and 0xFF
                val b = pixel and 0xFF
                val luminance = r * 0.299 + g * 0.587 + b * 0.114
                if (luminance < 160) {
                    val index = y * bytesPerRow + x / 8
                    bits[index] = (bits[index].toInt() and (1 shl (7 - x % 8)).inv()).toByte()
                }
            }
        }
        return Monochrome(bits, bytesPerRow)
    }
}
