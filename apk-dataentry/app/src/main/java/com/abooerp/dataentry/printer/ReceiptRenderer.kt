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
    val receiverName: String,
    val collectAmount: Double,
    val hawalaAmount: Double,
    val hawalaFee: Double,
    val prepaidAmount: Double,
    val currencyCode: String,
    val notes: String,
)

/**
 * Renders the receipt entirely as a bitmap rather than raw text sent to
 * the printer — see EscPosRaster for why. Android's own StaticLayout with
 * TextDirectionHeuristics.RTL gives correct Arabic shaping and right
 * alignment on any printer, no printer-side font involved.
 */
object ReceiptRenderer {
    // Deducing which side is which from the rotation math kept getting it
    // backwards in practice (tried both ways — each "fix" moved the
    // clipping instead of removing it), so this stops guessing: both ends
    // use the same generous value that was confirmed completely
    // clip-free before any asymmetric tuning was attempted. Paper savings
    // come from the spacing below instead, which never touches these
    // tear-sensitive edges. MARGIN_STACK (vertical here) becomes padding
    // on the print head's fixed ~576-dot width, which is hard-capped —
    // kept small so the stacked rows never trip the auto-scale-down
    // safety net below.
    private const val MARGIN_START = 200
    private const val MARGIN_END = 200
    private const val MARGIN_STACK = 40
    private const val COLUMN_GAP = 48

    /** One row to draw: any number of cells side by side, first cell
     * rightmost (matching RTL reading order) — lets each row hold a
     * different cell count (4 / 3 / 2 / 2, per the approved layout). */
    private class Row(val cells: List<StaticLayout>, val spacingAfter: Int)

    /**
     * Builds the receipt, then rotates the whole thing 90° so it prints
     * as a genuinely wide/landscape strip instead of a long narrow one.
     *
     * The print head itself is a hard, physical, fixed-width constraint
     * (~72mm) — no image trick changes that; whichever axis of the final
     * bitmap we hand to EscPosRaster maps to that width is capped no
     * matter what. What rotation DOES achieve: content is first laid out
     * in a "natural" bitmap where the SHORT axis (~72mm) is the vertical
     * stack of rows and the LONG axis (unbounded) is how far each line
     * can run — so nothing here is ever shrunk or wrapped to fit; the
     * paper just feeds longer instead. Rotating that finished bitmap 90°
     * before sending it is what makes the printed strip read as landscape
     * once it's turned sideways, which is the only way to get a landscape
     * reading experience out of a fixed-width thermal roll.
     */
    fun render(data: ReceiptData): Bitmap {
        val titlePaint = textPaint(size = 38f, bold = true)
        val headerPaint = textPaint(size = 30f, bold = true)
        val labelPaint = textPaint(size = 28f, bold = false)
        val finePrintPaint = textPaint(size = 19f, bold = false)
        fun money(amount: Double) = "${trimmed(amount)} ${data.currencyCode}"

        val rows = mutableListOf<Row>()
        fun full(text: String, paint: TextPaint, spacingAfter: Int = 34) {
            rows += Row(listOf(buildUnwrapped(text, paint)), spacingAfter)
        }
        // Cells listed in reading order (first = rightmost, RTL) — lets
        // each row hold any number of fields, per the approved layout.
        fun row(vararg fields: Pair<String, String>, spacingAfter: Int = 34) {
            rows += Row(fields.map { (label, value) -> buildUnwrapped("$label: $value", labelPaint) }, spacingAfter)
        }

        // Spacing scaled down to match the tighter margins — still clearly
        // separated, just proportioned to the new, less wasteful size.
        full("${data.companyName} — فرع ${data.branchLabel}", titlePaint, 12)
        full("إيصال استلام بضاعة  •  ${data.dateTime}", headerPaint, 30)

        // Company-approved layout, one row per line exactly as specified:
        // Row 1: المرسل / المرسل إليه / رقم إيصال / الجهة
        // Row 2: نوع البضاعة / تحصيل / مسبق
        // Row 3: حوالة / أجور
        // Row 4: الموظف / ملاحظات
        row("المرسل" to data.senderName, "المرسل إليه" to data.receiverName, "رقم الإيصال" to data.receiptNo, "الجهة" to data.destination, spacingAfter = 28)
        row("نوع البضاعة" to data.parcelType, "تحصيل" to money(data.collectAmount), "مسبق" to money(data.prepaidAmount), spacingAfter = 28)
        row("حوالة" to money(data.hawalaAmount), "أجور" to money(data.hawalaFee), spacingAfter = 28)
        row("الموظف" to data.employeeName, "ملاحظات" to data.notes.ifBlank { "-" }, spacingAfter = 20)

        // Fixed legal disclaimer — same wording on every receipt, small
        // font, always at the bottom, both sentences on one line.
        full(
            "الشحن غير مسؤول عن فقدان البضاعة بالقوة القاهرة وقوة السلاح والحريق وعن الكسر والزربان" +
                "  —  لسنا مسؤولين عن فقدان بضاعة داخل الطرد",
            finePrintPaint,
            16,
        )

        // ---- lay out into the "natural" (pre-rotation) bitmap ----
        var naturalHeight = MARGIN_STACK * 2
        var naturalWidth = MARGIN_START + MARGIN_END
        for (row in rows) {
            naturalHeight += row.cells.maxOf { it.height } + row.spacingAfter
            val rowWidth = row.cells.sumOf { lineWidth(it) } + COLUMN_GAP * (row.cells.size - 1)
            naturalWidth = maxOf(naturalWidth, rowWidth + MARGIN_START + MARGIN_END)
        }

        val natural = Bitmap.createBitmap(naturalWidth, naturalHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(natural)
        canvas.drawColor(Color.WHITE)
        var y = MARGIN_STACK
        for (row in rows) {
            var x = naturalWidth - MARGIN_START
            for (cell in row.cells) {
                val w = lineWidth(cell)
                x -= w
                canvas.save(); canvas.translate(x.toFloat(), y.toFloat()); cell.draw(canvas); canvas.restore()
                x -= COLUMN_GAP
            }
            y += row.cells.maxOf { it.height } + row.spacingAfter
        }

        // Safety net: naturalHeight becomes the final bitmap's WIDTH after
        // rotation below, and that is hard-capped by the print head's
        // physical dots (it can never exceed this, full stop). Content
        // here is tuned to stay comfortably under it, but if a future
        // change (bigger font, more spacing, an extra field) ever pushes
        // past the limit, scale the whole thing down proportionally
        // instead of silently producing a corrupted/clipped printout.
        val maxShortAxis = EscPosRaster.PRINTER_DOTS_WIDTH
        val scaled = if (natural.height > maxShortAxis) {
            val scale = maxShortAxis.toFloat() / natural.height
            Bitmap.createScaledBitmap(natural, (natural.width * scale).toInt().coerceAtLeast(1), maxShortAxis, true)
        } else {
            natural
        }

        // ---- rotate the finished receipt 90° for landscape printing ----
        val matrix = Matrix().apply { postRotate(90f) }
        return Bitmap.createBitmap(scaled, 0, 0, scaled.width, scaled.height, matrix, false)
    }

    private fun lineWidth(layout: StaticLayout): Int = layout.getLineWidth(0).toInt()

    /** No max-width cap — a line never wraps or shrinks; the paper simply
     * feeds further to fit it at full size. The box handed to StaticLayout
     * is deliberately wider than the raw measured text (not just a few
     * px) — too tight a box made the text-shaping engine visibly cram
     * letters/words together to force-fit it, which read as overlapping. */
    private fun buildUnwrapped(text: String, paint: TextPaint): StaticLayout {
        val width = (paint.measureText(text) * 1.15f + 60f).toInt().coerceAtLeast(1)
        return StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setTextDirection(TextDirectionHeuristics.RTL)
            .setLineSpacing(0f, 1f)
            .setIncludePad(false)
            .build()
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
