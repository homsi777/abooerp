package com.abooerp.dataentry.printer

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.pdf.PdfDocument
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/**
 * Sends the customer their receipt as a PDF on WhatsApp.
 *
 * Reuses [ReceiptRenderer] rather than laying the receipt out a second
 * time, so what the customer receives on their phone is pixel-identical to
 * what came out of the printer — no second design to keep in sync, and no
 * argument later about two versions of the same receipt disagreeing.
 */
object ReceiptSharer {

    sealed class ShareResult {
        object Success : ShareResult()
        data class Failure(val message: String) : ShareResult()
    }

    fun shareAsPdf(context: Context, data: ReceiptData): ShareResult {
        val file = try {
            writePdf(context, data)
        } catch (e: IOException) {
            return ShareResult.Failure("تعذر إنشاء ملف PDF: ${e.message ?: ""}")
        }

        val uri: Uri = try {
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        } catch (e: IllegalArgumentException) {
            return ShareResult.Failure("تعذر تجهيز الملف للمشاركة.")
        }

        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "إيصال رقم ${data.receiptNo}")
            putExtra(Intent.EXTRA_TEXT, "إيصال استلام بضاعة رقم ${data.receiptNo} — ${data.companyName}")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        // Try WhatsApp directly first so the common case is one tap, then
        // fall back to the normal share sheet — a tablet without WhatsApp
        // installed should still be able to send the receipt some other way
        // rather than hitting a dead button.
        for (whatsapp in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            val direct = Intent(intent).setPackage(whatsapp)
            try {
                context.startActivity(direct)
                return ShareResult.Success
            } catch (_: ActivityNotFoundException) {
                // Not installed — try the next package, then the chooser.
            }
        }

        return try {
            context.startActivity(Intent.createChooser(intent, "مشاركة الإيصال"))
            ShareResult.Success
        } catch (_: ActivityNotFoundException) {
            ShareResult.Failure("لا يوجد تطبيق يمكنه مشاركة الملف على هذا الجهاز.")
        }
    }

    private fun writePdf(context: Context, data: ReceiptData): File {
        val bitmap = ReceiptRenderer.render(data)
        val document = PdfDocument()
        try {
            val pageInfo = PdfDocument.PageInfo.Builder(bitmap.width, bitmap.height, 1).create()
            val page = document.startPage(pageInfo)
            // White background first: the rendered receipt has transparent
            // pixels wherever nothing was drawn, which some PDF viewers show
            // as black.
            page.canvas.drawColor(android.graphics.Color.WHITE)
            page.canvas.drawBitmap(bitmap, 0f, 0f, null)
            document.finishPage(page)

            val directory = File(context.getExternalFilesDir(null), "receipts").apply { mkdirs() }
            // Named by receipt number so the customer can find it later and
            // a re-share overwrites rather than piling up copies.
            val file = File(directory, "receipt-${data.receiptNo}.pdf")
            file.outputStream().use { document.writeTo(it) }
            return file
        } finally {
            document.close()
            bitmap.recycle()
        }
    }
}
