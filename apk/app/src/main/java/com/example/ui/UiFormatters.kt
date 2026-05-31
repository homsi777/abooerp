package com.example.ui

import android.content.Context
import android.content.Intent
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private val arabicLocale = Locale("ar", "SY")

fun safeText(value: String?): String = value?.takeIf { it.isNotBlank() } ?: "غير محدد"

fun money(value: Double?, currency: String?): String =
    String.format(Locale.US, "%.2f %s", value ?: 0.0, currency?.takeIf { it.isNotBlank() } ?: "USD")

fun percentage(value: Double?): String = String.format(Locale.US, "%.2f%%", value ?: 0.0)

fun formatDate(value: String?): String {
    if (value.isNullOrBlank()) return "غير محدد"
    return runCatching {
        val input = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val parsed = input.parse(value) ?: return@runCatching value
        val output = SimpleDateFormat("yyyy/MM/dd - hh:mm a", arabicLocale).apply {
            timeZone = TimeZone.getTimeZone("Asia/Damascus")
        }
        output.format(parsed)
    }.getOrDefault(value)
}

fun statusLabel(value: String?): String = when (value?.uppercase()) {
    "REGISTERED" -> "مسجلة"
    "CONFIRMED" -> "مؤكدة"
    "READY_FOR_PICKUP" -> "جاهزة للاستلام"
    "HANDED_TO_DRIVER" -> "محملة مع السائق"
    "HANDED_TO_AGENT", "AGENT_RECEIVED" -> "استلمها الوكيل"
    "IN_TRANSIT" -> "قيد النقل"
    "ARRIVED_AT_DESTINATION", "ARRIVED" -> "وصلت للوجهة"
    "OUT_FOR_DELIVERY" -> "خارجة للتسليم"
    "DELIVERED" -> "مسلمة"
    "RETURN_REQUESTED" -> "مطلوب إرجاعها"
    "RETURNED" -> "مرتجعة"
    "CANCELLED" -> "ملغاة"
    "PENDING" -> "قيد الانتظار"
    "COMPLETED" -> "مكتملة"
    "POSTED" -> "مرحلة"
    else -> "غير محدد"
}

fun movementTypeLabel(value: String?): String = when (value?.uppercase()) {
    "SHIPMENT_COMMISSION" -> "عمولة شحنة"
    "TRANSFER_COMMISSION" -> "عمولة حوالة"
    "RECEIPT_VOUCHER" -> "سند قبض"
    "PAYMENT_VOUCHER" -> "سند دفع"
    "CASHBOX_TRANSACTION" -> "حركة صندوق"
    "SHIPMENT_SHIPPING_FEE" -> "أجرة شحن على العهدة"
    "SENDER_COLLECTION_TRUST" -> "تحصيل لصالح المرسل"
    "LOADING_DUES" -> "مستحقات إضافية"
    "GENERAL_COLLECTION" -> "تحصيل إضافي"
    "SHIPMENT_HAWALA_TRUST" -> "أصل حوالة مرتبطة بشحنة"
    "TRANSFER_PRINCIPAL_COLLECTED" -> "قبض أصل حوالة"
    "TRANSFER_SERVICE_FEE_COLLECTED" -> "قبض أجرة حوالة"
    "TRANSFER_PRINCIPAL_PAID" -> "تسليم أصل حوالة"
    else -> "غير محدد"
}

fun referenceTypeLabel(value: String?): String = when (value?.uppercase()) {
    "SHIPMENT" -> "شحنة"
    "TRANSFER" -> "حوالة"
    "RECEIPT_VOUCHER" -> "سند قبض"
    "PAYMENT_VOUCHER" -> "سند دفع"
    "CASHBOX_TRANSACTION" -> "حركة صندوق"
    else -> "مرجع"
}

fun shareArabicText(context: Context, title: String, text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, title)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, "مشاركة عبر"))
}
