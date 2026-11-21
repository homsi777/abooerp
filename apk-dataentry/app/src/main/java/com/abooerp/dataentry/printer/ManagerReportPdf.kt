package com.abooerp.dataentry.printer

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.TextUtils
import androidx.core.content.FileProvider
import com.abooerp.dataentry.R
import com.abooerp.dataentry.data.LedgerRowRemote
import java.io.File
import java.io.IOException

/**
 * A4 (landscape) report of one employee's ledger rows for one day, for the
 * manager to share on WhatsApp or print: company logo + name header, the
 * same column order as the desktop daily ledger, and a totals strip at the
 * end. Arabic is shaped by StaticLayout (RTL), same approach as the receipt.
 */
object ManagerReportPdf {

    sealed class Result {
        object Success : Result()
        data class Failure(val message: String) : Result()
    }

    // A4 landscape in PDF points (1/72 in).
    private const val PAGE_W = 842
    private const val PAGE_H = 595
    private const val MARGIN = 20
    private const val HEADER_H = 78
    private const val FOOTER_H = 22
    private const val ROW_H = 24
    private const val HEAD_ROW_H = 26

    private class Col(val title: String, val width: Int)

    // Listed right-to-left: the first column is drawn at the right edge.
    private val columns = listOf(
        Col("ت", 28),
        Col("رقم الإيصال", 62),
        Col("الجهة", 74),
        Col("نوع البضاعة", 86),
        Col("العدد", 34),
        Col("المرسل", 100),
        Col("المستلم", 100),
        Col("تحصيل \$", 52),
        Col("حوالة \$", 52),
        Col("أجرة الحوالة", 56),
        Col("دفع مسبق \$", 56),
        Col("ملاحظات", 102),
    )

    fun shareAsPdf(
        context: Context,
        companyName: String,
        branchLabel: String,
        employeeName: String,
        dateIso: String,
        rows: List<LedgerRowRemote>,
    ): Result {
        val file = try {
            writePdf(context, companyName, branchLabel, employeeName, dateIso, rows)
        } catch (e: IOException) {
            return Result.Failure("تعذر إنشاء ملف PDF: ${e.message ?: ""}")
        }
        val uri: Uri = try {
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        } catch (e: IllegalArgumentException) {
            return Result.Failure("تعذر تجهيز الملف للمشاركة.")
        }
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "سجلات $employeeName — $dateIso")
            putExtra(Intent.EXTRA_TEXT, "سجلات شحنات $employeeName بتاريخ $dateIso — $companyName")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        for (whatsapp in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            try {
                context.startActivity(Intent(intent).setPackage(whatsapp))
                return Result.Success
            } catch (_: ActivityNotFoundException) {
                // try the next one, then the chooser (which also offers Print)
            }
        }
        return try {
            context.startActivity(Intent.createChooser(intent, "مشاركة / طباعة التقرير"))
            Result.Success
        } catch (_: ActivityNotFoundException) {
            Result.Failure("لا يوجد تطبيق يمكنه مشاركة الملف على هذا الجهاز.")
        }
    }

    private fun writePdf(
        context: Context,
        companyName: String,
        branchLabel: String,
        employeeName: String,
        dateIso: String,
        rows: List<LedgerRowRemote>,
    ): File {
        val ordered = rows.sortedBy { it.rowNo }
        val rowsPerFirstPage = (PAGE_H - MARGIN - HEADER_H - HEAD_ROW_H - FOOTER_H) / ROW_H
        val rowsPerPage = rowsPerFirstPage
        val pageCount = maxOf(1, (ordered.size + rowsPerPage - 1) / rowsPerPage)

        val logo = BitmapFactory.decodeResource(context.resources, R.drawable.company_logo)
        val document = PdfDocument()
        try {
            for (pageIndex in 0 until pageCount) {
                val page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageIndex + 1).create())
                val canvas = page.canvas
                canvas.drawColor(Color.WHITE)
                var y = MARGIN
                y = drawHeader(canvas, logo, companyName, branchLabel, employeeName, dateIso, y)
                y = drawTableHead(canvas, y)
                val from = pageIndex * rowsPerPage
                val to = minOf(ordered.size, from + rowsPerPage)
                for (i in from until to) {
                    drawRow(canvas, ordered[i], i + 1, y)
                    y += ROW_H
                }
                if (pageIndex == pageCount - 1) drawTotals(canvas, ordered, y)
                drawFooter(canvas, pageIndex + 1, pageCount)
                document.finishPage(page)
            }
            val directory = File(context.getExternalFilesDir(null), "reports").apply { mkdirs() }
            val safeName = employeeName.filter { it.isLetterOrDigit() }.ifEmpty { "user" }
            val file = File(directory, "ledger-$safeName-$dateIso.pdf")
            file.outputStream().use { document.writeTo(it) }
            return file
        } finally {
            document.close()
            logo?.recycle()
        }
    }

    private fun drawHeader(
        canvas: Canvas,
        logo: android.graphics.Bitmap?,
        companyName: String,
        branchLabel: String,
        employeeName: String,
        dateIso: String,
        top: Int,
    ): Int {
        val right = PAGE_W - MARGIN
        if (logo != null) {
            val size = 56
            val dest = android.graphics.Rect(right - size, top, right, top + size)
            canvas.drawBitmap(logo, null, dest, Paint(Paint.FILTER_BITMAP_FLAG))
        }
        val textRight = right - 66
        val textWidth = PAGE_W - 2 * MARGIN - 66
        drawText(canvas, companyName, paint(17f, bold = true), MARGIN, top, textWidth, Layout.Alignment.ALIGN_OPPOSITE, 1, rightEdge = textRight)
        drawText(canvas, "سجل شحنات الموظف: $employeeName   —   التاريخ: $dateIso", paint(12f, bold = true), MARGIN, top + 24, textWidth, Layout.Alignment.ALIGN_OPPOSITE, 1, rightEdge = textRight)
        drawText(canvas, "الفرع: $branchLabel", paint(11f, bold = false), MARGIN, top + 42, textWidth, Layout.Alignment.ALIGN_OPPOSITE, 1, rightEdge = textRight)
        val line = Paint().apply { color = Color.BLACK; strokeWidth = 1.2f }
        canvas.drawLine(MARGIN.toFloat(), (top + HEADER_H - 14).toFloat(), right.toFloat(), (top + HEADER_H - 14).toFloat(), line)
        return top + HEADER_H - 8
    }

    private fun drawTableHead(canvas: Canvas, top: Int): Int {
        val fill = Paint().apply { color = Color.rgb(230, 230, 230); style = Paint.Style.FILL }
        canvas.drawRect(MARGIN.toFloat(), top.toFloat(), (PAGE_W - MARGIN).toFloat(), (top + HEAD_ROW_H).toFloat(), fill)
        var x = PAGE_W - MARGIN
        val p = paint(9.5f, bold = true)
        for (c in columns) {
            x -= c.width
            drawCell(canvas, c.title, p, x, top, c.width, HEAD_ROW_H)
        }
        return top + HEAD_ROW_H
    }

    private fun drawRow(canvas: Canvas, row: LedgerRowRemote, index: Int, top: Int) {
        val values = listOf(
            index.toString(),
            row.receiptNo ?: row.rowNo.toString(),
            row.destination ?: "",
            row.parcelType ?: "",
            row.parcelCount?.toString() ?: "",
            row.senderName ?: "",
            row.receiverName ?: "",
            money(row.collectAmountUsd),
            money(row.hawalaAmountUsd),
            money(row.transferServiceFeeUsd),
            money(row.prepaidAmountUsd),
            row.notes ?: "",
        )
        var x = PAGE_W - MARGIN
        val p = paint(9f, bold = false)
        for ((i, c) in columns.withIndex()) {
            x -= c.width
            drawCell(canvas, values[i], p, x, top, c.width, ROW_H)
        }
    }

    private fun drawTotals(canvas: Canvas, rows: List<LedgerRowRemote>, top: Int) {
        fun sum(selector: (LedgerRowRemote) -> String?) = rows.sumOf { selector(it)?.toDoubleOrNull() ?: 0.0 }
        val collect = sum { it.collectAmountUsd }
        val hawala = sum { it.hawalaAmountUsd }
        val fee = sum { it.transferServiceFeeUsd }
        val prepaid = sum { it.prepaidAmountUsd }
        val fill = Paint().apply { color = Color.rgb(240, 240, 240); style = Paint.Style.FILL }
        canvas.drawRect(MARGIN.toFloat(), top.toFloat(), (PAGE_W - MARGIN).toFloat(), (top + ROW_H).toFloat(), fill)
        // Same right-to-left grid as the rows so the sums sit under their columns.
        var x = PAGE_W - MARGIN
        val p = paint(9.5f, bold = true)
        val totals = mapOf(0 to "", 2 to "الإجمالي (${rows.size} سطر)", 7 to money(collect.toString()), 8 to money(hawala.toString()), 9 to money(fee.toString()), 10 to money(prepaid.toString()))
        for ((i, c) in columns.withIndex()) {
            x -= c.width
            val label = totals[i] ?: ""
            if (label.isNotEmpty()) drawCell(canvas, label, p, x, top, c.width, ROW_H)
        }
    }

    private fun drawFooter(canvas: Canvas, page: Int, pages: Int) {
        drawText(
            canvas, "صفحة $page من $pages", paint(9f, bold = false),
            MARGIN, PAGE_H - MARGIN - 4, PAGE_W - 2 * MARGIN, Layout.Alignment.ALIGN_CENTER, 1,
        )
    }

    /** One bordered, centred, ellipsised cell. */
    private fun drawCell(canvas: Canvas, text: String, p: TextPaint, x: Int, top: Int, w: Int, h: Int) {
        val border = Paint().apply { color = Color.rgb(120, 120, 120); style = Paint.Style.STROKE; strokeWidth = 0.6f }
        canvas.drawRect(x.toFloat(), top.toFloat(), (x + w).toFloat(), (top + h).toFloat(), border)
        if (text.isBlank()) return
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, p, w - 4)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setTextDirection(TextDirectionHeuristics.RTL)
            .setIncludePad(false)
            .setMaxLines(2)
            .setEllipsize(TextUtils.TruncateAt.END)
            .build()
        canvas.save()
        canvas.translate((x + 2).toFloat(), top + (h - layout.height) / 2f)
        layout.draw(canvas)
        canvas.restore()
    }

    private fun drawText(
        canvas: Canvas,
        text: String,
        p: TextPaint,
        x: Int,
        top: Int,
        width: Int,
        align: Layout.Alignment,
        maxLines: Int,
        rightEdge: Int? = null,
    ) {
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, p, width)
            .setAlignment(align)
            .setTextDirection(TextDirectionHeuristics.RTL)
            .setIncludePad(false)
            .setMaxLines(maxLines)
            .setEllipsize(TextUtils.TruncateAt.END)
            .build()
        canvas.save()
        canvas.translate(if (rightEdge != null) (rightEdge - width).toFloat() else x.toFloat(), top.toFloat())
        layout.draw(canvas)
        canvas.restore()
    }

    private fun paint(size: Float, bold: Boolean): TextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        textSize = size
        typeface = Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun money(raw: String?): String {
        val v = raw?.toDoubleOrNull() ?: return ""
        if (v == 0.0) return ""
        val s = "%.2f".format(v).trimEnd('0').trimEnd('.')
        return s.ifEmpty { "0" }
    }
}
