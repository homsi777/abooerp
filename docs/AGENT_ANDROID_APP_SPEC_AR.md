# مواصفات تطبيق Android للوكيل - شركة عبو المحمود

هذا الملف مخصص لإرساله إلى Gemini Studio أو أي فريق/أداة ستبني تطبيق Android منفصل للوكيل.

المطلوب بناء تطبيق Android مخصص للوكيل فقط، وليس نقل نظام ERP كامل إلى الموبايل. التطبيق يجب أن يتصل بنفس backend الخاص بالمشروع، وأن يستخدم نفس قاعدة PostgreSQL عبر API فقط.

## 1. الهدف العام

بناء تطبيق Android للوكيل يسمح له بمتابعة الشحنات والحوالات والحركات المالية الخاصة به فقط، مع واجهة موبايل بسيطة وسريعة، وصلاحيات محدودة حسب حساب الوكيل.

التطبيق لا يجب أن يحتوي على وظائف المدير أو المحاسب أو إعدادات النظام.

## 2. المعمارية المطلوبة

المسار الصحيح:

```text
Flutter Android App
        ↓ HTTPS
Backend API on VPS
        ↓
PostgreSQL
```

ممنوع أن يتصل تطبيق Android مباشرة بقاعدة البيانات.

كل العمليات يجب أن تمر عبر backend الحالي:

```text
https://DOMAIN_OR_IP/api/v1
```

في التطوير المحلي يمكن استخدام:

```text
http://192.168.x.x:4010/api/v1
```

أو عبر Nginx/Vite proxy حسب بيئة التشغيل.

## 3. نوع التطبيق المقترح

يفضل استخدام Flutter.

المتطلبات التقنية:

- Flutter stable.
- Dart null safety.
- RTL Arabic first.
- دعم Android فقط في النسخة الأولى.
- تخزين التوكنات بشكل آمن باستخدام secure storage.
- HTTP client مثل Dio.
- State management بسيط مثل Riverpod أو Bloc أو Provider.
- تصميم mobile-first وليس responsive web داخل WebView.

ممنوع بناء التطبيق كـ WebView للنظام الحالي. المطلوب تطبيق موبايل حقيقي بواجهات Flutter.

## 4. المستخدم المستهدف

المستخدم هو الوكيل.

أمثلة:

- وكيل الرقة.
- وكيل حلب.
- وكيل منطقة معينة.

كل وكيل يرى فقط:

- بياناته الشخصية.
- شحناته.
- حوالاته.
- عمولاته.
- كشفه المالي.
- الإجراءات المسموحة له.

لا يرى:

- كل الفروع.
- كل الصناديق.
- كل الوكلاء.
- الرواتب.
- إعدادات النظام.
- حسابات المدير.
- بيانات وكلاء آخرين.

## 5. تسجيل الدخول

الشاشة الأولى:

- شعار الشركة.
- حقل اسم المستخدم.
- حقل كلمة المرور.
- زر تسجيل الدخول.
- رسالة خطأ واضحة.

بعد نجاح تسجيل الدخول:

- حفظ accessToken و refreshToken في secure storage.
- تحميل بيانات المستخدم.
- إذا كان `userType = agent` يدخل إلى التطبيق.
- إذا لم يكن المستخدم وكيلا، تظهر رسالة:

```text
هذا التطبيق مخصص لحسابات الوكلاء فقط.
```

## 6. المصادقة والتوكنات

التطبيق يستخدم نفس نظام JWT الموجود في backend.

Endpoints المتوقعة:

```http
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Payload تسجيل الدخول:

```json
{
  "username": "agent_user",
  "password": "password"
}
```

ملاحظات مهمة:

- التطبيق يجب أن يرسل `Authorization: Bearer ACCESS_TOKEN` في كل طلب محمي.
- عند انتهاء accessToken يستخدم refreshToken.
- عند فشل refresh يتم تسجيل الخروج.
- لا تعتمد على `window.runtime` أو Electron.
- لا تعتمد على machineId إلا إذا قرر backend لاحقا دعم device registration للموبايل.

## 7. مشكلة Device Authorization

في المشروع الحالي يوجد منطق device authorization مخصص لشبكة LAN/Electron.

تطبيق Android على VPS يجب ألا يتوقف بسبب عدم وجود `x-device-id`.

المطلوب من backend قبل الإنتاج:

- دعم Web/Mobile mode بدون إلزام `x-device-id`.
- أو إضافة آلية موبايل واضحة لتسجيل الجهاز.

النسخة الأولى المفضلة:

- Android App يعتمد على username/password + JWT.
- لا يرسل `x-device-id`.
- لا يتطلب موافقة جهاز مثل Electron.

## 8. شاشة الرئيسية Dashboard

بعد الدخول تظهر شاشة ملخص للوكيل.

المحتوى:

- اسم الوكيل.
- الفرع/المنطقة المرتبطة.
- عدد الشحنات الإجمالي.
- شحنات بانتظار استلام الوكيل.
- شحنات قيد التوصيل.
- شحنات مسلمة.
- شحنات مرتجعة.
- مستحقات العمولة حتى الآن.
- آخر تاريخ مطابقة إن وجد.

تصميم الشاشة:

- بطاقات صغيرة.
- أرقام واضحة.
- أزرار سريعة:
  - الشحنات.
  - الحوالات.
  - كشف الحساب.
  - الملف الشخصي.

Endpoint موجود جزئيا:

```http
GET /api/v1/agent-portal/workspace-summary
GET /api/v1/agent-portal/stats
```

## 9. الملف الشخصي للوكيل

شاشة تعرض:

- اسم الوكيل.
- الكود.
- الهاتف.
- المحافظة.
- المدينة.
- المنطقة.
- الفرع المرتبط.
- نسبة العمولة الحالية.

Endpoint موجود:

```http
GET /api/v1/agent-portal/profile
```

مثال بيانات متوقعة:

```json
{
  "agent": {
    "id": "...",
    "code": "AG-001",
    "name": "وكيل الرقة",
    "phone": "...",
    "governorate": "الرقة",
    "city": "الرقة",
    "area": "...",
    "commission_percentage": 5
  },
  "branchLabel": "فرع الرقة",
  "username": "agent_raqqa"
}
```

## 10. شاشة الشحنات

هذه أهم شاشة في تطبيق الوكيل.

يجب عرض الشحنات كبطاقات وليس كجدول.

كل بطاقة تعرض:

- رقم الشحنة.
- التاريخ.
- المرسل.
- المستلم.
- هاتف المستلم.
- الوجهة.
- عدد الطرود.
- الوزن.
- المبلغ.
- العملة.
- الحالة.
- ملاحظة مختصرة إن وجدت.

مثال بطاقة:

```text
700210
فرع حلب → الرقة
المرسل: نبيل
المستلم: أبو محمود عبو
الهاتف: 09xxxxxxxx
8 طرود | 120 كغ
الحالة: جاهزة للاستلام
[تفاصيل] [استلمت] [خارج للتسليم]
```

Endpoint موجود:

```http
GET /api/v1/agent-portal/shipments
```

يجب أن يرجع backend شحنات هذا الوكيل فقط حسب scope.

## 11. فلترة الشحنات

الفلاتر المطلوبة:

- بحث برقم الشحنة.
- بحث باسم المرسل.
- بحث باسم المستلم.
- بحث برقم هاتف المستلم.
- حسب الحالة.
- حسب التاريخ من/إلى.

حالات مهمة:

- بانتظار استلام الوكيل.
- استلمها الوكيل.
- قيد النقل.
- وصلت الوجهة.
- خارجة للتسليم.
- مسلمة.
- طلب إرجاع.
- مرتجعة.

## 12. تفاصيل الشحنة

عند الضغط على شحنة تفتح شاشة تفاصيل.

تعرض:

- رقم الشحنة.
- التاريخ.
- الفرع المصدر.
- الوجهة.
- بيانات المرسل.
- بيانات المستلم.
- تفاصيل الطرود.
- الوزن.
- المبلغ.
- أجرة الشحن.
- حالة الدفع إن كانت مسموحة للوكيل.
- الحالة الحالية.
- سجل آخر التحديثات إن توفر.
- ملاحظات.

الأزرار تظهر حسب الحالة والصلاحيات فقط.

## 13. إجراءات الشحنة

التطبيق يجب أن يسمح للوكيل بتنفيذ الإجراءات المسموحة فقط.

Endpoints موجودة:

```http
POST /api/v1/agent-portal/shipments/:id/agent-received
POST /api/v1/agent-portal/shipments/:id/mark-in-transit
POST /api/v1/agent-portal/shipments/:id/arrived
POST /api/v1/agent-portal/shipments/:id/out-for-delivery
POST /api/v1/agent-portal/shipments/:id/deliver
POST /api/v1/agent-portal/shipments/:id/request-return
POST /api/v1/agent-portal/shipments/:id/mark-returned
```

Payload:

```json
{
  "note": "ملاحظة اختيارية",
  "metadata": {}
}
```

كل إجراء يجب أن يعرض تأكيد قبل التنفيذ.

مثال:

```text
هل تريد تأكيد تسليم الشحنة؟
```

بعد التنفيذ:

- تحديث الحالة في الشاشة.
- إظهار رسالة نجاح.
- منع الضغط المتكرر.

## 14. إثبات التسليم

في النسخة الأولى يمكن أن يكون بسيطا:

- ملاحظة تسليم.
- اسم الشخص المستلم.
- وقت التسليم.

في نسخة لاحقة:

- توقيع المستلم.
- صورة إثبات.
- تحديد GPS.
- رفع مرفقات.

إذا أضيفت مرفقات لاحقا يجب رفعها إلى backend وليس حفظها محليا فقط.

## 15. الحوالات

شاشة الحوالات تعرض الحوالات المرتبطة بالوكيل.

المطلوب:

- قائمة حوالات.
- بحث باسم المرسل.
- بحث باسم المستلم.
- بحث برقم الشحنة المرتبطة.
- عرض الحالة.
- عرض المبلغ والعملة.
- عرض عمولة الوكيل إن وجدت.

الحركات المتوقعة:

- حوالة بانتظار التسليم.
- حوالة مكتملة.
- حوالة ملغاة.

قد يحتاج backend إلى endpoint خاص للموبايل:

```http
GET /api/v1/agent-portal/transfers
GET /api/v1/agent-portal/transfers/:id
POST /api/v1/agent-portal/transfers/:id/complete
```

إن لم تكن هذه endpoints موجودة، يجب إضافتها في backend قبل اعتماد شاشة الحوالات.

## 16. كشف الوكيل المالي

هذه شاشة أساسية.

تعرض للوكيل:

- إجمالي عمولة الشحن.
- إجمالي عمولة الحوالات.
- إجمالي المستحق للوكيل.
- المدفوع للوكيل.
- الرصيد النهائي.
- تاريخ استخراج الكشف.
- تاريخ آخر مطابقة.
- الرصيد بعد آخر مطابقة.

Endpoints موجودة للإدارة ويمكن استخدامها أو عمل نسخة Agent Portal منها:

```http
GET /api/v1/agents/:id/financial-statement
GET /api/v1/agents/:id/account-statement
```

لكن لتطبيق Android الأفضل إنشاء endpoints آمنة لا تحتاج إرسال agentId من التطبيق:

```http
GET /api/v1/agent-portal/financial-statement
GET /api/v1/agent-portal/account-statement
```

السبب:

- التطبيق يعرف الوكيل من JWT.
- لا يجب أن يرسل `agentId`.
- يمنع أي محاولة للوصول لكشف وكيل آخر.

## 17. كشف حساب شامل للوكيل

يعرض كل الحركات:

- عمولة شحنة.
- حوالة.
- سند قبض.
- سند دفع.
- حركة صندوق إن كانت غير مكررة.
- تسوية/مطابقة إن وجدت.

الأعمدة/الحقول:

- التاريخ.
- المصدر.
- المرجع.
- البيان.
- مدين.
- دائن.
- العملة.
- الحالة.

على الموبايل تعرض كقائمة بطاقات:

```text
2026-05-30
عمولة شحنة
المرجع: 700210
دائن: 5.00 USD
الحالة: مؤكدة
```

## 18. المطابقة

تاريخ آخر مطابقة مهم جدا.

في تطبيق الوكيل:

- يمكن عرض تاريخ آخر مطابقة.
- يمكن عرض الرصيد بعد آخر مطابقة.
- لا يفضل أن يسمح الوكيل بحفظ مطابقة بنفسه في النسخة الأولى.

حفظ المطابقة يجب أن يبقى للمدير/المحاسب من ERP.

للوكيل يظهر:

```text
آخر مطابقة: 2026-05-20
الرصيد بعد آخر مطابقة: 120.00 USD
```

## 19. الإشعارات

مقترح للنسخة الثانية:

- إشعار عند إضافة شحنة جديدة للوكيل.
- إشعار عند تغيير حالة شحنة.
- إشعار عند إضافة حوالة.
- إشعار عند حفظ مطابقة جديدة.

يمكن استخدام Firebase Cloud Messaging.

في النسخة الأولى يمكن الاكتفاء بالسحب اليدوي Refresh.

## 20. البحث بالباركود

مقترح مهم للنسخة الثانية.

المطلوب:

- Scan barcode/QR.
- فتح الشحنة مباشرة.
- تنفيذ إجراء سريع.

الشاشة:

- زر ماسح.
- عند قراءة رقم الشحنة:
  - يبحث في شحنات الوكيل.
  - إذا موجودة يفتح التفاصيل.
  - إذا غير موجودة يظهر:

```text
هذه الشحنة غير موجودة ضمن نطاق وكيلك.
```

## 21. الصلاحيات

التطبيق يعتمد على صلاحيات backend.

صلاحيات متوقعة للوكيل:

- `agent_portal.view`
- `agent_portal.status_action`
- `shipments.read`
- `shipments.agent_received`
- `shipments.out_for_delivery`
- `shipments.deliver`
- `shipments.return`

التطبيق لا يقرر وحده. backend هو مصدر القرار النهائي.

إذا رجع 403:

```text
ليس لديك صلاحية لتنفيذ هذا الإجراء.
```

## 22. الأمان

قواعد إلزامية:

- لا تخزن كلمة المرور.
- لا تخزن التوكنات في SharedPreferences عادي.
- استخدم secure storage.
- لا تعرض بيانات وكيل آخر.
- لا تعتمد على فلترة داخل التطبيق فقط.
- كل scope يجب أن يكون من backend.
- HTTPS إلزامي على VPS.
- لا تضع مفاتيح سرية داخل التطبيق.
- لا تضع بيانات قاعدة البيانات داخل التطبيق.

## 23. التعامل مع الأخطاء

رسائل عربية واضحة:

- لا يوجد اتصال بالإنترنت.
- انتهت الجلسة، يرجى تسجيل الدخول.
- ليس لديك صلاحية.
- تعذر تحميل الشحنات.
- تعذر تحديث حالة الشحنة.
- حدث خطأ غير متوقع.

لا تعرض stack trace للمستخدم.

## 24. Offline Mode

النسخة الأولى لا تحتاج offline كامل.

المسموح:

- حفظ آخر قائمة شحنات للعرض فقط.
- عند عدم وجود إنترنت تظهر نسخة cached مع تحذير.

ممنوع:

- تنفيذ تغيير حالة offline ثم مزامنته لاحقا في النسخة الأولى.

سبب المنع:

- حالات الشحنات مالية وتشغيلية.
- يجب أن تكون مباشرة ومؤكدة من backend.

## 25. التصميم وتجربة المستخدم

التطبيق عربي RTL بالكامل.

المعايير:

- بطاقات بدل جداول.
- أزرار كبيرة مناسبة للمس.
- ألوان حالة واضحة.
- شاشة شحنات سريعة جدا.
- تجنب النصوص الصغيرة.
- لا تستخدم واجهة ERP المكتبية.
- لا تضع Sidebar.
- استخدم Bottom Navigation.

Bottom Navigation مقترح:

- الرئيسية.
- الشحنات.
- الحوالات.
- الحساب.
- المزيد.

## 26. الألوان المقترحة للحالات

- جديد / مؤكد: أزرق.
- بانتظار استلام الوكيل: بنفسجي.
- استلمها الوكيل: سماوي.
- قيد النقل: برتقالي.
- خارجة للتسليم: أصفر/برتقالي.
- مسلمة: أخضر.
- طلب إرجاع: أحمر فاتح.
- مرتجعة: أحمر.
- ملغاة: رمادي.

## 27. نماذج الشاشات المطلوبة

### 27.1 Login

- Username
- Password
- Login button
- Server status optional

### 27.2 Home

- Agent name
- Today stats
- Pending shipments
- Delivered shipments
- Agent due amount

### 27.3 Shipments

- Search
- Filters
- Shipment cards
- Pull to refresh

### 27.4 Shipment Details

- Full shipment details
- Status timeline
- Action buttons

### 27.5 Transfers

- Transfer list
- Transfer details
- Status

### 27.6 Financial Statement

- Summary cards
- Last reconciliation
- Commission details

### 27.7 Account Statement

- All movements
- Date filter
- Movement cards

### 27.8 Profile

- Agent info
- Logout
- App version

## 28. API Base Configuration

يجب أن يكون API base قابلا للتغيير حسب البيئة.

في التطوير:

```text
http://192.168.1.101:4010/api/v1
```

في VPS:

```text
https://abooerp.com/api/v1
```

أو:

```text
http://65.21.136.217:2730/api/v1
```

ممنوع hardcode نهائي داخل الكود بدون config.

الأفضل:

- ملف environment.
- build flavor dev/prod.

## 29. Endpoints الحالية المفيدة

موجود حاليا:

```http
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
GET  /api/v1/agent-portal/profile
GET  /api/v1/agent-portal/workspace-summary
GET  /api/v1/agent-portal/stats
GET  /api/v1/agent-portal/shipments
POST /api/v1/agent-portal/shipments/:id/agent-received
POST /api/v1/agent-portal/shipments/:id/mark-in-transit
POST /api/v1/agent-portal/shipments/:id/arrived
POST /api/v1/agent-portal/shipments/:id/out-for-delivery
POST /api/v1/agent-portal/shipments/:id/deliver
POST /api/v1/agent-portal/shipments/:id/request-return
POST /api/v1/agent-portal/shipments/:id/mark-returned
```

موجود للإدارة وقد يحتاج نسخة Agent Portal آمنة:

```http
GET /api/v1/agents/:id/financial-statement
GET /api/v1/agents/:id/account-statement
```

مطلوب إضافته لاحقا لتطبيق الوكيل:

```http
GET /api/v1/agent-portal/financial-statement
GET /api/v1/agent-portal/account-statement
GET /api/v1/agent-portal/transfers
GET /api/v1/agent-portal/transfers/:id
POST /api/v1/agent-portal/transfers/:id/complete
```

## 30. قاعدة مهمة جدا

التطبيق يجب أن يعتمد على backend في كل شيء:

- تحديد الوكيل.
- تحديد الصلاحيات.
- تحديد الشحنات.
- تحديد الحوالات.
- تحديد الكشف المالي.
- تنفيذ تحديثات الحالة.

التطبيق لا يفلتر بيانات حساسة وحده.

## 31. MVP المطلوب للنسخة الأولى

النسخة الأولى يجب أن تحتوي فقط:

1. Login.
2. Home summary.
3. Agent profile.
4. Shipments list.
5. Shipment details.
6. Shipment status actions.
7. Financial statement summary.
8. Account statement read-only.
9. Logout.

لا تضف في MVP:

- إدارة وكلاء.
- إنشاء شحنة.
- إدارة صناديق.
- رواتب.
- إعدادات.
- صلاحيات.
- طباعة.
- Offline write.

## 32. ترتيب التنفيذ المقترح

1. إنشاء مشروع Flutter.
2. إعداد API client.
3. إعداد auth + secure storage.
4. بناء Login.
5. بناء Home.
6. ربط profile.
7. ربط shipments.
8. بناء shipment details.
9. ربط status actions.
10. بناء financial statement read-only.
11. بناء account statement read-only.
12. اختبار على Android حقيقي.
13. اختبار مع VPS.

## 33. اختبارات القبول

يعتبر التطبيق جاهزا مبدئيا عندما:

- يسجل وكيل الدخول بنجاح.
- المستخدم غير الوكيل يمنع من الدخول.
- تظهر شحنات الوكيل فقط.
- لا تظهر شحنات وكيل آخر.
- يمكن تغيير حالة شحنة مسموحة.
- لا يمكن تنفيذ إجراء غير مسموح.
- يظهر كشف الوكيل المالي.
- يظهر تاريخ آخر مطابقة.
- يعمل refresh token.
- يعمل logout.
- يعمل التطبيق على Android حقيقي.
- يعمل عبر VPS HTTPS.

## 34. ملاحظات مهمة للمطور

- لا تستخدم WebView.
- لا تبن ERP كامل للموبايل.
- ركز على الوكيل فقط.
- كل النصوص عربية RTL.
- كل الأموال يجب أن تعرض العملة.
- كل التاريخ يجب أن يعرض بصيغة مفهومة عربيا.
- أظهر loading واضح.
- أظهر empty states.
- أظهر رسائل أخطاء مفهومة.
- اجعل الواجهات بسيطة وسريعة.

## 35. Prompt مختصر يمكن إرساله إلى Gemini Studio

ابن تطبيق Flutter Android باسم `AbooERP Agent` مخصص للوكلاء فقط. التطبيق عربي RTL، يتصل بـ backend عبر REST API، ولا يستخدم WebView ولا يتصل مباشرة بقاعدة البيانات. يجب أن يحتوي على Login، Home summary، Profile، Shipments list، Shipment details، Status actions، Financial statement، Account statement، Logout. استخدم secure storage للتوكنات، وDio للطلبات، وتصميم mobile-first ببطاقات بدل الجداول. التطبيق يجب أن يستخدم JWT، ويرسل Authorization Bearer، ويجدد الجلسة عبر refresh token. يجب أن يرى الوكيل بياناته وشحناته وكشفه فقط حسب backend scope. استخدم endpoints المذكورة في هذا الملف، وضع API base قابلا للتغيير بين dev وprod.
