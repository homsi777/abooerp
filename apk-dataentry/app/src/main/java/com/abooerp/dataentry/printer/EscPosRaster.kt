package com.abooerp.dataentry.printer

import android.graphics.Bitmap

/**
 * Converts a rendered receipt bitmap into the ESC/POS raster image command
 * (GS v 0), which virtually every 80mm thermal printer understands
 * regardless of brand or firmware. We deliberately never send raw text to
 * the printer — most cheap thermal printers have no Arabic codepage at
 * all, so raw Arabic text comes out as garbage. Rendering the receipt as a
 * bitmap ourselves (Android's text layout fully supports Arabic shaping)
 * and shipping it as dot rows sidesteps that entirely, on any printer.
 */
/** One write to the printer, paired with how many dot-rows it will
 * physically print — 0 for a plain control command (init/feed). The
 * caller waits proportionally to `rows`, not a fixed delay: the print
 * head has a real, roughly fixed dots/second speed, so a bigger band
 * needs proportionally longer for the printer's small buffer to drain
 * before the next write arrives, regardless of how fast Bluetooth itself
 * can push bytes. */
data class PrintChunk(val bytes: ByteArray, val rows: Int)

object EscPosRaster {
    /** 80mm paper, ~72mm printable width at 203dpi (8 dots/mm) — the
     * standard resolution for this printer class. */
    const val PRINTER_DOTS_WIDTH = 576

    /** Many cheap thermal printer controllers have a very small receive
     * buffer — sending one giant GS v 0 raster block for a tall receipt
     * overflows it and the tail (often the notes/footer lines, since
     * they're near the end) gets garbled or silently dropped. Splitting
     * into short horizontal bands, each its own GS v 0 command with a
     * length-proportional pause after it, is the standard workaround. */
    private const val MAX_CHUNK_HEIGHT = 48

    /** Returns the full byte sequence to send, already split into safe
     * write-sized chunks (init/each raster band/feed) — see
     * BluetoothPrinterManager, which writes them one at a time and waits
     * according to each chunk's `rows` so a slow print head never gets
     * outrun, even on a long receipt with a lot of notes text. */
    fun renderChunks(bitmap: Bitmap): List<PrintChunk> {
        val width = bitmap.width
        val height = bitmap.height
        val bytesPerRow = (width + 7) / 8
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        val monoBits = ByteArray(bytesPerRow * height)
        for (y in 0 until height) {
            val rowOffset = y * width
            val byteRowOffset = y * bytesPerRow
            for (x in 0 until width) {
                val pixel = pixels[rowOffset + x]
                val r = (pixel shr 16) and 0xFF
                val g = (pixel shr 8) and 0xFF
                val b = pixel and 0xFF
                val luminance = r * 0.299 + g * 0.587 + b * 0.114
                if (luminance < 160) {
                    val byteIndex = byteRowOffset + (x / 8)
                    val bitIndex = 7 - (x % 8)
                    monoBits[byteIndex] = (monoBits[byteIndex].toInt() or (1 shl bitIndex)).toByte()
                }
            }
        }

        val chunks = mutableListOf<PrintChunk>()
        chunks += PrintChunk(byteArrayOf(0x1B, 0x40), 0) // ESC @ — reset printer state before every job
        // No leading blank-paper feed here — that was doubling up with the
        // margin already baked into the image itself (ReceiptRenderer's
        // MARGIN_START), wasting paper for nothing. The in-image margin
        // alone is enough to prevent clipping.
        var y = 0
        while (y < height) {
            val chunkHeight = minOf(MAX_CHUNK_HEIGHT, height - y)
            val header = byteArrayOf(
                0x1D, 0x76, 0x30, 0x00,
                (bytesPerRow and 0xFF).toByte(), ((bytesPerRow shr 8) and 0xFF).toByte(),
                (chunkHeight and 0xFF).toByte(), ((chunkHeight shr 8) and 0xFF).toByte(),
            )
            val band = monoBits.copyOfRange(y * bytesPerRow, (y + chunkHeight) * bytesPerRow)
            chunks += PrintChunk(header + band, chunkHeight)
            y += chunkHeight
        }
        chunks += PrintChunk(byteArrayOf(0x1B, 0x64, 0x01), 1) // minimal feed so the receipt clears the cutter
        return chunks
    }
}
