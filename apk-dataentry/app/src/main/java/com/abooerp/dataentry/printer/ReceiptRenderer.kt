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
import com.abooerp.dataentry.data.SypPayment

/** Everything needed to draw one tablet-intake receipt — the sender's
 * proof of handover, printed immediately after a ledger row is saved.
 * Field set mirrors LedgerRow, the same data already synced to the
 * desktop's daily ledger. */
data class ReceiptData(
    val companyName: String,
    val branchLabel: String,
    val employeeName: String,
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
    val collectAmount: Double,
    val hawalaAmount: Double,
    val hawalaFee: Double,
    val prepaidAmount: Double,
    val currencyCode: String,
    val notes: String,
    /** Present when the customer paid in Syrian pounds: the receipt then
     *  shows what they actually handed over next to the USD the ledger
     *  recorded, plus the rate used, so neither side can dispute it later. */
    val sypPayment: SypPayment? = null,
)

/**
 * Draws the receipt in the same visual language as the parcel label
 * ([LabelRenderer]): a header band, bordered sections, and the receipt
 * number as a scannable QR — plus the money box, which is the whole point
 * of the receipt and never appears on the label.
 *
 * Laid out landscape and rotated 90° at the end, because the print head is
 * a fixed ~72mm wide while the roll is unlimited in length: the long axis
 * of the design has to become the direction the paper feeds.
 *
 * Arabic shaping comes from StaticLayout with an RTL heuristic, so no
 * printer-side font is involved — the whole receipt is just a bitmap.
 */
object ReceiptRenderer {
    // The landscape canvas height becomes the printed WIDTH once rotated,
    // so it is pinned to the print head; the width becomes the length.
    private const val LAND_HEIGHT = EscPosRaster.PRINTER_DOTS_WIDTH
    private const val LAND_WIDTH = 1000

    private const val MARGIN = 14
    private const val BOX_PAD = 10
    private const val BOX_GAP = 10
    private const val QR_MODULE = 7
    private const val RIGHT_COL_WIDTH = 470

    fun render(data: ReceiptData): Bitmap {
        val companyPaint = textPaint(38f, bold = true)
        val metaPaint = textPaint(25f, bold = true)
        val codePaint = textPaint(30f, bold = true)
        val linePaint = textPaint(25f, bold = true)
        val finePaint = textPaint(18f, bold = false)

        val syp = data.sypPayment
        // When the customer paid in pounds, what they handed over leads and
        // the USD the ledger recorded follows in brackets.
        fun money(usdAmount: Double, sypAmount: Double?): String =
            if (syp != null && sypAmount != null) {
                "${trimmed(sypAmount)} ل.س (${trimmed(usdAmount)} USD)"
            } else {
                "${trimmed(usdAmount)} ${data.currencyCode}"
            }

        val bitmap = Bitmap.createBitmap(LAND_WIDTH, LAND_HEIGHT, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }

        // ---- header ----
        var headerY = 6
        headerY = drawCentered(canvas, data.companyName, companyPaint, 0, LAND_WIDTH, headerY, 2)
        headerY = drawCentered(
            canvas,
            "إيصال استلام بضاعة  -  ${data.branchLabel}  -  ${data.dateTime}",
            metaPaint,
            0,
            LAND_WIDTH,
            headerY,
            4,
        )
        canvas.drawLine(MARGIN.toFloat(), headerY.toFloat(), (LAND_WIDTH - MARGIN).toFloat(), headerY.toFloat(), border)
        val contentTop = headerY + 6

        // ---- right column: shipment, sender, receiver ----
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

        // ---- left column: QR, receipt number, the money box ----
        val leftX = MARGIN
        val leftWidth = rightX - 2 * MARGIN
        var leftY = contentTop
        leftY = drawCentered(canvas, "رقم الإيصال", metaPaint, leftX, leftWidth, leftY, 2)
        leftY = drawCentered(canvas, data.receiptNo, codePaint, leftX, leftWidth, leftY, 4)

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
        leftY += qrPixels + 8

        leftY = drawBox(
            canvas, border, linePaint, leftX, leftWidth, leftY,
            listOfNotNull(
                "تحصيل: ${money(data.collectAmount, syp?.collectAmount)}",
                "دفع مسبق: ${money(data.prepaidAmount, syp?.prepaidAmount)}",
                "حوالة: ${money(data.hawalaAmount, syp?.hawalaAmount)}",
                "أجرة الحوالة: ${money(data.hawalaFee, syp?.hawalaFee)}",
                syp?.let { "سعر الصرف: ${trimmed(it.rate)} ل.س لكل 1 USD" },
            ),
        )

        leftY = drawCentered(canvas, "الموظف: ${data.employeeName}", finePaint, leftX, leftWidth, leftY, 2)
        if (data.notes.isNotBlank()) {
            leftY = drawCentered(canvas, "ملاحظات: ${data.notes}", finePaint, leftX, leftWidth, leftY, 2)
        }

        // ---- fixed legal disclaimer, full width along the bottom ----
        val disclaimer =
            "الشحن غير مسؤول عن فقدان البضاعة بالقوة القاهرة وقوة السلاح والحريق وعن الكسر والزربان" +
                "  -  لسنا مسؤولين عن فقدان بضاعة داخل الطرد"
        val disclaimerLayout = layoutOf(disclaimer, finePaint, LAND_WIDTH - 2 * MARGIN)
        val disclaimerY = (LAND_HEIGHT - disclaimerLayout.height - 4).coerceAtLeast(maxOf(rightY, leftY))
        canvas.save()
        canvas.translate(MARGIN.toFloat(), disclaimerY.toFloat())
        disclaimerLayout.draw(canvas)
        canvas.restore()

        val matrix = Matrix().apply { postRotate(90f) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, false)
    }

    private fun layoutOf(text: String, paint: TextPaint, width: Int): StaticLayout =
        StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setTextDirection(TextDirectionHeuristics.RTL)
            .setLineSpacing(0f, 1f)
            .setIncludePad(false)
            .build()

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
        val layout = layoutOf(text, paint, width)
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
