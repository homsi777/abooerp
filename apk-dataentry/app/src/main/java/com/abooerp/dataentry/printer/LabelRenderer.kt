package com.abooerp.dataentry.printer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint

/** The parcel label stuck on the goods themselves — a different document
 *  from the sender's receipt: no money figures on it, just who/what/where
 *  plus the receipt number as a scannable QR. */
data class LabelData(
    val companyName: String,
    val sourceLabel: String,
    val dateTime: String,
    val receiptNo: String,
    val destination: String,
    val parcelType: String,
    val parcelCount: Int,
    val weightKg: Double,
    val senderName: String,
    val senderPhone: String,
    val receiverName: String,
    val receiverPhone: String,
    val notes: String,
)

/**
 * Renders the 70mm x 120mm parcel label, matching the design signed off on
 * the real printer.
 *
 * The design is laid out LANDSCAPE (120mm wide, 70mm tall: QR on the left,
 * data boxes on the right) and only then rotated 90°, because the print
 * head is a fixed ~70mm wide — a 120mm-wide design can physically reach the
 * paper no other way. Same trick as [ReceiptRenderer].
 */
object LabelRenderer {
    private const val DOTS_PER_MM = 8
    private const val LAND_WIDTH = 120 * DOTS_PER_MM   // 960 — label LENGTH after rotation
    private const val LAND_HEIGHT = 70 * DOTS_PER_MM   // 560 — printed WIDTH after rotation

    private const val MARGIN = 12
    // Vertical padding is tuned so the content fills the full 70mm; left
    // short, the printer just leaves the unused strip blank.
    private const val BOX_PAD = 19
    private const val BOX_GAP = 20
    private const val QR_MODULE = 11

    private const val RIGHT_COL_WIDTH = 458

    fun render(data: LabelData): Bitmap {
        val companyPaint = textPaint(42f, bold = true)
        val metaPaint = textPaint(28f, bold = true)
        val codePaint = textPaint(34f, bold = true)
        val linePaint = textPaint(28f, bold = true)

        // Generous scratch height; cropped to the real content below.
        val bitmap = Bitmap.createBitmap(LAND_WIDTH, LAND_HEIGHT + 240, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }

        // ---- header across the full width ----
        var headerY = 8
        headerY = drawCentered(canvas, data.companyName, companyPaint, 0, LAND_WIDTH, headerY, 2)
        headerY = drawCentered(
            canvas,
            "${data.sourceLabel}    -    التاريخ والوقت: ${data.dateTime}",
            metaPaint,
            0,
            LAND_WIDTH,
            headerY,
            6,
        )
        canvas.drawLine(MARGIN.toFloat(), headerY.toFloat(), (LAND_WIDTH - MARGIN).toFloat(), headerY.toFloat(), border)
        val contentTop = headerY + 6

        // ---- right column: shipment / sender / receiver boxes ----
        val rightX = LAND_WIDTH - MARGIN - RIGHT_COL_WIDTH
        var rightY = contentTop
        rightY = drawBox(
            canvas, border, linePaint, rightX, RIGHT_COL_WIDTH, rightY,
            listOf(
                "الوجهة: ${data.destination}",
                "نوع البضاعة: ${data.parcelType}",
                "عدد الطرود: ${data.parcelCount}    الوزن: ${trimmed(data.weightKg)} كغ",
            ),
        )
        // Phone lines only appear when a number is actually known — the
        // daily ledger does not carry phone numbers today.
        rightY = drawBox(
            canvas, border, linePaint, rightX, RIGHT_COL_WIDTH, rightY,
            listOfNotNull(
                "المرسل: ${data.senderName}",
                data.senderPhone.takeIf { it.isNotBlank() }?.let { "الهاتف: $it" },
            ),
        )
        rightY = drawBox(
            canvas, border, linePaint, rightX, RIGHT_COL_WIDTH, rightY,
            listOfNotNull(
                "المستلم: ${data.receiverName}",
                data.receiverPhone.takeIf { it.isNotBlank() }?.let { "الهاتف: $it" },
            ),
        )

        // ---- left column: receipt number, its QR, then notes ----
        val leftX = MARGIN
        val leftWidth = rightX - 2 * MARGIN
        var leftY = contentTop
        leftY = drawCentered(canvas, "رقم الإيصال", metaPaint, leftX, leftWidth, leftY, 2)
        leftY = drawCentered(canvas, data.receiptNo, codePaint, leftX, leftWidth, leftY, 6)

        val qr = QrEncoder.encode(data.receiptNo)
        val qrPixels = qr.size * QR_MODULE
        val qrX = leftX + (leftWidth - qrPixels) / 2
        val fill = Paint().apply { color = Color.BLACK }
        for (row in qr.indices) {
            for (col in qr[row].indices) {
                if (qr[row][col]) {
                    val px = (qrX + col * QR_MODULE).toFloat()
                    val py = (leftY + row * QR_MODULE).toFloat()
                    canvas.drawRect(px, py, px + QR_MODULE, py + QR_MODULE, fill)
                }
            }
        }
        leftY += qrPixels + 10

        if (data.notes.isNotBlank()) {
            leftY = drawCentered(canvas, "ملاحظات: ${data.notes}", linePaint, leftX, leftWidth, leftY, 4)
        }

        // The used height becomes the printed WIDTH after rotation, so it
        // can never exceed the print head's 70mm.
        val used = (maxOf(rightY, leftY) + 6).coerceAtMost(LAND_HEIGHT)
        val cropped = Bitmap.createBitmap(bitmap, 0, 0, LAND_WIDTH, used)

        val matrix = Matrix().apply { postRotate(90f) }
        return Bitmap.createBitmap(cropped, 0, 0, cropped.width, cropped.height, matrix, false)
    }

    /** Draws one RTL-centred line and returns the next free Y. */
    private fun drawCentered(
        canvas: Canvas,
        text: String,
        paint: TextPaint,
        x: Int,
        width: Int,
        y: Int,
        spacing: Int,
    ): Int {
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setTextDirection(TextDirectionHeuristics.RTL)
            .setLineSpacing(0f, 1f)
            .setIncludePad(false)
            .build()
        canvas.save()
        canvas.translate(x.toFloat(), y.toFloat())
        layout.draw(canvas)
        canvas.restore()
        return y + layout.height + spacing
    }

    private fun drawBox(
        canvas: Canvas,
        border: Paint,
        linePaint: TextPaint,
        x: Int,
        width: Int,
        y: Int,
        lines: List<String>,
    ): Int {
        var innerY = y + BOX_PAD
        for (line in lines) {
            innerY = drawCentered(canvas, line, linePaint, x, width, innerY, 2)
        }
        val boxEnd = innerY + BOX_PAD
        canvas.drawRect(x.toFloat(), y.toFloat(), (x + width).toFloat(), boxEnd.toFloat(), border)
        return boxEnd + BOX_GAP
    }

    private fun textPaint(size: Float, bold: Boolean): TextPaint {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.BLACK
        paint.textSize = size
        paint.typeface = Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
        return paint
    }

    private fun trimmed(amount: Double): String {
        val rounded = "%.2f".format(amount).trimEnd('0').trimEnd('.')
        return rounded.ifEmpty { "0" }
    }
}
