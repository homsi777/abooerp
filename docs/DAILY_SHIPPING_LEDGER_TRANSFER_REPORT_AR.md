# تقرير شامل: دفتر الشحن اليومي — التشخيص والتصميم
## نقل إرسالية / إيصال ناقص / الحماية المحاسبية

**المشروع:** AbooERP / Almiya-HSahin — نظام شحن برّي داخل سوريا  
**تاريخ التقرير:** 2026-06-07  
**نوع التقرير:** تقرير تشخيص وتصميم فقط — لا تعديل في الكود  
**المصدر:** قراءة الكود الفعلي في الفرع `web-browser-mode`

---

## 1. الملخص التنفيذي

دفتر الشحن اليومي هو نقطة إدخال الشحنات الأساسية في النظام. يعمل كشاشة إدخال سريع للبيانات التشغيلية قبل «ترحيل» الشحنات رسمياً. الكود الحالي يُميّز بوضوح بين ثلاث مراحل:

1. **حفظ الدفتر** (`upsert`) — يُخزّن البيانات في جداول `daily_ledger_sessions` و `daily_ledger_rows` دون أي أثر مالي.
2. **ترحيل الشحنات** (`post-shipments`) — يُنشئ سجلاً في `shipments` أو يربط بسجل موجود، ويسجّل `posted_shipment_id` على السطر.
3. **التحميل على البيان** (`manifest`) — يُحدّث `loaded_at` و `loaded_manifest_id`، وبعدها يُصبح السطر مقفلاً لا يقبل التعديل.

**أبرز المشكلات المكتشفة:**
- ربط السائق/المركبة يتم على مستوى **الجلسة** (`daily_ledger_sessions`) وليس على مستوى السطر الفردي، مما يعني أن تغيير السائق = إنشاء جلسة جديدة ≠ نقل الأسطر.
- موظف إدخال البيانات ممنوع من التاريخ السابق إلا بصلاحية `shipments.ledger.past_dates`.
- لا توجد آلية رسمية لـ «نقل إرسالية» بين جلسات/رحلات مختلفة.
- لا توجد آلية رسمية لـ «إضافة إيصال ناقص» بتاريخ سابق ربطاً بالشحنة الأصلية.
- بعد الترحيل المالي وتغيير المبالغ، قد لا تُعاد الحركات المحاسبية تلقائياً (ملاحظة مسجّلة في الكود).

---

## 2. الهدف من التقرير

1. توثيق آلية عمل دفتر الشحن اليومي بدقة تقنية وتشغيلية.
2. توثيق كل حقل وزر وإجراء وأثره المحاسبي والتشغيلي.
3. تشخيص مشاكل: تغيير السائق، الإيصالات الناقصة، التاريخ السابق، خطر التكرار.
4. تصميم ميزة «نقل إرسالية» بشكل كامل قابل للتنفيذ لاحقاً.
5. تصميم مسار آمن لإضافة إيصال ناقص بتاريخ سابق.

---

## 3. بنية قاعدة البيانات الحالية لدفتر الشحن

### الجداول المعنية

#### `daily_ledger_sessions` — جلسة دفتر الشحن
```sql
id uuid primary key
company_id uuid not null references companies(id)
branch_id uuid not null references branches(id)
ledger_date date not null
line_label text not null default ''       -- الخط/المصدر مثل «فرع حلب»
origin_label text not null default ''
trip_no text                              -- رقم الرحلة (اختياري)
vehicle_label text                        -- اسم/رقم المركبة (نص)
driver_label text                         -- اسم السائق (نص)
driver_id uuid references drivers(id)    -- FK للسائق (مضاف في 086)
vehicle_id uuid references vehicles(id)  -- FK للمركبة (مضاف في 086)
created_by / updated_by uuid
created_at / updated_at / deleted_at
```

**مفتاح الفريد الحالي (086_daily_ledger_driver_vehicle.sql):**
```sql
UNIQUE (company_id, branch_id, ledger_date, line_label, 
        coalesce(driver_id, '00000000-0000-0000-0000-000000000000'))
WHERE deleted_at is null
```
**تأثير هذا القيد:** جلسة واحدة لكل مجموعة (شركة + فرع + تاريخ + خط + سائق). إذا تغيّر السائق → جلسة جديدة → الأسطر تنفصل.

#### `daily_ledger_rows` — أسطر الدفتر
```sql
id uuid primary key
session_id uuid not null references daily_ledger_sessions(id) ON DELETE CASCADE
row_no integer not null check (row_no > 0)
receipt_no text                           -- رقم الإيصال
destination text not null default ''     -- الوجهة/الجهة
parcel_type text not null default ''     -- نوع الطرود
parcel_count integer                     -- عدد الطرود
weight_kg numeric(12,2)                  -- الوزن
sender_name text not null default ''     -- المرسل
receiver_name text not null default ''   -- المستلم
collect_amount_usd numeric(14,2) default 0   -- تحصيل $
prepaid_amount_usd numeric(14,2) default 0   -- دفع مسبق
hawala_amount_usd numeric(14,2) default 0    -- حوالة
fees_amount_usd numeric(14,2) default 0      -- أجور (مدمج الآن في collect بعد 083)
transfer_service_fee_usd numeric(14,2)       -- أجرة الحوالة
notes text
posted_shipment_id uuid references shipments(id)  -- الشحنة المرتبطة بعد الترحيل
posted_at timestamptz                         -- وقت الترحيل
loaded_manifest_id uuid references manifests(id)   -- البيان المحمّل عليه
loaded_at timestamptz                         -- وقت التحميل (= قفل السطر)
created_by / updated_by
created_at / updated_at / deleted_at
```

**قيود الفريد:**
```sql
UNIQUE (session_id, row_no) WHERE deleted_at is null
```

**فهارس مهمة:**
```sql
idx_daily_ledger_rows_posted_shipment  -- على posted_shipment_id
idx_daily_ledger_rows_loaded           -- على loaded_at
idx_daily_ledger_rows_receipt_no_norm  -- على lower(trim(receipt_no))
```

---

## 4. شرح كل خانة في دفتر الشحن اليومي

| الحقل العربي | الاسم الداخلي (Frontend) | نوع TypeScript | حقل DB | مطلوب للحفظ | مطلوب للترحيل | القيمة الافتراضية | ملاحظات |
|---|---|---|---|---|---|---|---|
| **الخط** | `trip.line` (session) | `string` | `daily_ledger_sessions.line_label` | ✅ | ✅ | أول فرع | جزء من مفتاح الجلسة |
| **رقم الرحلة** | `trip.tripNo` | `string` | `daily_ledger_sessions.trip_no` | ❌ | ❌ | فارغ | معلوماتي فقط، يُسجَّل في ملاحظات الشحنة |
| **التاريخ** | `trip.date` | `string` (ISO date) | `daily_ledger_sessions.ledger_date` | ✅ | ✅ | اليوم | مقيّد بصلاحيات التاريخ السابق |
| **المركبة** | `trip.vehicleId` / `vehicle_id` | `number` (synthetic) | `daily_ledger_sessions.vehicle_id` | ❌ | ❌ | فارغ | تُحفظ على الجلسة لا على السطر |
| **السائق** | `trip.driverId` / `driver_id` | `number` (synthetic) | `daily_ledger_sessions.driver_id` | ❌ مبدئياً | ✅ للترحيل | فارغ | **مطلوب عند الترحيل** — غيابه يمنع حفظ الشحنات |
| **رقم الإيصال** | `receiptNo` | `string` | `daily_ledger_rows.receipt_no` | ✅ | ✅ | فارغ | يجب أن يكون فريداً ضمن نفس الدفتر (فرع+تاريخ+خط) |
| **الجهة** | `destination` | `string` | `daily_ledger_rows.destination` | ✅ | ✅ | فارغ | تُستخدم للبحث عن الوكيل تلقائياً عند الترحيل |
| **نوع الطرود** | `parcelType` | `string` | `daily_ledger_rows.parcel_type` | ❌ | ❌ | فارغ | يُستخدم في تعريف الأسعار |
| **عدد الطرود** | `parcelCount` | `string` | `daily_ledger_rows.parcel_count` | ❌ | ❌ | فارغ | عدد صحيح اختياري |
| **الوزن كغ** | `weightKg` | `string` | `daily_ledger_rows.weight_kg` | ❌ | ❌ | فارغ | يُؤثر على حساب التعريفة التلقائية |
| **المرسل** | `sender` | `string` | `daily_ledger_rows.sender_name` | ✅ | ✅ | فارغ | يُستخدم للبحث عن عميل حسابي |
| **المرسل إليه** | `receiver` | `string` | `daily_ledger_rows.receiver_name` | ✅ | ✅ | فارغ | |
| **تحصيل $** | `collectAmount` | `string` | `daily_ledger_rows.collect_amount_usd` | ❌ | ❌ | تلقائي من تعريف الأسعار | COD — يُحصَّل من المستلم عند التسليم |
| **دفع مسبق $** | `prepaidAmount` | `string` | `daily_ledger_rows.prepaid_amount_usd` | ❌ | ❌ | `0` | الأجرة المدفوعة مسبقاً |
| **حوالة** | `receiverCollect` | `string` | `daily_ledger_rows.hawala_amount_usd` | ❌ | ❌ | `0` | مبلغ الحوالة |
| **أجرة الحوالة** | `transferServiceFee` | `string` | `daily_ledger_rows.transfer_service_fee_usd` | ❌ | ❌ | `0` | عمولة خدمة الحوالة |
| **الملاحظات** | `notes` | `string` | `daily_ledger_rows.notes` | ❌ | ❌ | فارغ | نص حر |

### حقول داخلية لا تظهر للمستخدم مباشرة

| الاسم | المصدر | الوظيفة |
|---|---|---|
| `dbId` | `daily_ledger_rows.id` (UUID) | معرّف السطر في DB |
| `serverRowNo` | `daily_ledger_rows.row_no` | رقم السطر الرسمي |
| `sessionDriverId` | `daily_ledger_sessions.driver_id` | معرّف السائق المرتبط بالجلسة |
| `postedShipmentId` | `daily_ledger_rows.posted_shipment_id` | UUID الشحنة بعد الترحيل |
| `loadedAt` | `daily_ledger_rows.loaded_at` | وقت التحميل — يقفل السطر |
| `collectManual` | في الذاكرة فقط | علامة: هل عدّل المستخدم التحصيل يدوياً |

---

## 5. شرح كل زر وإجراء في دفتر الشحن اليومي

### 5.1 زر «إضافة سطر»
- **الملف:** `src/pages/ShipmentQuickLedger.tsx` — دالة `addRows`
- **السلوك:** يُضيف صفاً فارغاً محلياً (`createEmptyRow`) — لا يُرسل طلب API
- **شرط التفعيل:** دائماً متاح
- **الأثر على DB:** لا شيء حتى يُكمل المستخدم الحقول الإلزامية
- **خطر:** لا خطر — الأسطر الفارغة لا تُحفظ

### 5.2 زر «حفظ الشحنات» / «استكمال الحفظ»
- **الملف:** `ShipmentQuickLedger.tsx` — دالة `saveRows()`
- **المرحلة 1 — مزامنة:** `flushPendingRowSaves()` — يُرسل كل سطر معلّق نحو `/daily-ledger/rows/upsert`
- **المرحلة 2 — تحقق:** يفحص:
  - تكرار رقم الإيصال داخل الدفعة (`findDuplicateWithinBatch`)
  - تعارض مع سطر مرحَّل مسبقاً (`findReceiptConflictWithPosted`)
  - تعارض مع سطر آخر غير مرحَّل (`findReceiptConflictWithUnposted`)
  - غياب السائق للأسطر الجديدة (`rowsMissingDriver`)
- **المرحلة 3 — upsert:** يُرسل كل سطر إلى `POST /daily-ledger/rows/upsert`
- **المرحلة 4 — ترحيل:** يُرسل طلباً واحداً إلى `POST /daily-ledger/rows/post-shipments`
- **Endpoint الترحيل:** يُنشئ شحنة أو يربط بشحنة موجودة لكل سطر
- **الأثر المالي:** الترحيل يُنشئ سجل `shipments` مع `financial_status = 'UNPOSTED'` — لا GL تلقائي
- **خطر التوقف:** إذا فشل سطر واحد تتوقف العملية عنده

### 5.3 الحفظ التلقائي (debounce)
- **الآلية:** عند تعديل أي خانة في السطر → `queueRowSave(id)` → تأخير 280ms → `saveRowToServer(rowId)`
- **Endpoint:** `POST /daily-ledger/rows/upsert`
- **الشرط:** `shouldPersistRow(row)` = إما `dbId` موجود أو السطر اكتمل بالحد الأدنى
- **الأثر:** يُحدِّث الجلسة والسطر في DB — إذا كان السطر مرحَّلاً فعلاً → يُشغّل `syncPostedShipmentFromLedgerRow` في الخلفية

### 5.4 زر «تحديث»
- **الدالة:** `loadRemoteRows()`
- **السلوك:** يُرسل `flushPendingRowSaves()` ثم يجلب كل الأسطر من الخادم
- **لا أثر مالي**

### 5.5 زر «طباعة»
- **التصميم الحالي:** يفتح نافذة حوار تطلب: السائق + فترة من/إلى
- **نوعان:** طباعة شحنات (جدول) / طباعة إيصالات (ورق مطبوع مسبق — نقليات المحمود)
- **مصدر البيانات عند الطباعة:** `fetchAllDailyLedgerRows` مع فلتر: `driverBackendId` + `dateFrom` + `dateTo` + `searchQuick` إن وجد
- **⚠️ مشكلة:** الطباعة مرتبطة بـ **السائق** وليس بالتاريخ وحده — إذا تغيّر السائق بعد إدخال البيانات فالطباعة لن تُظهر الأسطر القديمة المرتبطة بالسائق الأصلي

### 5.6 زر «حذف أسطر»
- **الدالة:** `deleteSelectedRows()`
- **Endpoint:** `POST /daily-ledger/rows/delete`
- **Repository:** `deleteRows()` — حذف منطقي (`deleted_at = now()`)
- **القيد:** الأسطر المحمّلة على بيان (`loaded_at not null`) لا تُحذف في الخادم
- **ملاحظة في حوار التأكيد:** «بعض الأسطر المحددة مرتبطة بشحنات — سيُحذف سطر الدفتر فقط» — أي الشحنة تبقى في النظام

### 5.7 «إظهار المحمّلة» (checkbox)
- يُضيف `includeLoaded=true` في الطلبات
- يعرض الأسطر المحمّلة على بيان (مقفلة، لا تُعدَّل)

### 5.8 زر «سجل الحفظ»
- يُنزّل ملف JSON/NDJSON لعمليات الدفتر المحلية (`quickLedgerLog.download()`)
- لا أثر على DB

### 5.9 «اختصارات الوكلاء» (؟)
- يُظهر قائمة أكواد الوكلاء السريعة (رقم → محافظة)
- لا أثر على DB

---

## 6. آلية الحفظ التفصيلية

### 6.1 مسار `POST /daily-ledger/rows/upsert` (الخادم)

```
الإدخال: branchId + ledgerDate + lineLabel + driverId + vehicleId + rowNo + ...بيانات السطر

1. التحقق من الصلاحية:
   assertLedgerDateAllowed(roleCode, userType, ledgerDate, permissions)
   → Admin/Manager: أي تاريخ
   → data_entry بدون shipments.ledger.past_dates: اليوم فقط

2. في Transaction:
   أ) إذا rowId معطى → تحديث السطر مباشرة
   ب) إذا لا rowId → البحث عن سطر بنفس receipt_no في نفس الجلسة
      → إذا وُجد: هذا هو effectiveRowId
   ج) assertUniqueLedgerReceiptNo(client, companyId, receiptNo, scope, effectiveRowId)
      → يتحقق أنه لا يوجد نفس الإيصال في (branch + date + line) عدا السطر الحالي

3. إذا effectiveRowId موجود → UPDATE daily_ledger_rows
   (يشترط: السطر لم يُحمَّل = loaded_at is null)
   إذا لم يوجد → INSERT daily_ledger_sessions (UPSERT) + INSERT daily_ledger_rows

4. إذا السطر له posted_shipment_id AND لا loaded_at → يستدعي:
   syncPostedShipmentFromLedgerRow(scope, row.id)
   → يُحدِّث الشحنة المرتبطة (مرسل/مستلم/وجهة/وكيل/مبالغ)
   → لا ينشئ شحنة جديدة
```

### 6.2 مسار `POST /daily-ledger/rows/post-shipments` (الترحيل)

```
لكل سطر مكتمل (receipt_no + destination + sender_name + receiver_name) وغير مرحَّل:
  → postRowAsShipment(scope, rowId, allowedBranchIds)
  
  1. إذا posted_shipment_id موجود → syncPostedShipmentFromLedgerRow (تحديث)
  2. إذا لا → ينشئ/يجد sender في senders_receivers
     ثم ينشئ/يجد receiver في senders_receivers
     ثم يجد أو ينشئ goods_type
     ثم يجد agent من الوجهة (resolveAgentForDestination)
     ثم يفحص: هل receipt_no موجود في shipments؟
       نعم → يربط السطر بالشحنة الموجودة (markPosted) ← لا إنشاء مكرر
       لا  → ينشئ shipment جديدة (paymentMode: UNPAID) + markPosted
```

---

## 7. كيف يُحدَّد الوكيل؟

**المسار:** `agentRepository.resolveAgentForDestination(companyId, normalizedDestination)`
- يقرأ وكيل المحافظة/المدينة من جدول `agents` حسب اسم المحافظة أو الرمز
- لا يوجد `agent_id` مخزون على سطر الدفتر مباشرة
- الوكيل يُحسب ديناميكياً وقت الترحيل من حقل `destination`
- **نتيجة:** تغيير `destination` بعد الترحيل وإعادة الحفظ → قد يُغيِّر الوكيل المرتبط بالشحنة

---

## 8. كيف تُحسب المبالغ؟

### 8.1 التحصيل (`collect_amount_usd`)
- قد يُملأ تلقائياً من تعريف الأسعار (`tariffs`) بناءً على: خط الوجهة + نوع الطرد + الوزن
- إذا عدّله المستخدم يدوياً (`collectManual = true`) → لا يُستبدل تلقائياً
- إذا كان prepaid > 0 → يصبح collect = 0 تلقائياً (الشحن مدفوع مسبقاً)
- يُعامَل تشغيلياً في الترحيل كـ `transferFee` (COD — تحصيل من المستلم على عهدة الوكيل)

### 8.2 الدفع المسبق (`prepaid_amount_usd`)
- يُمثّل الأجرة المدفوعة مسبقاً عند الإرسال
- يُعامَل في الترحيل كـ `freightCharge` (أجرة الشحن للشركة)

### 8.3 الحوالة (`hawala_amount_usd`)
- مبلغ الحوالة المالية المصاحبة للشحنة
- يُنقَل إلى `shipments.hawala_amount`

### 8.4 أجرة الحوالة (`transfer_service_fee_usd`)
- عمولة خدمة الحوالة
- يُنقَل إلى `shipments.transfer_service_fee`

### 8.5 معادلة الإجمالي في الواجهة
```
total = collect + prepaid + hawalaAmount + transferServiceFee
```

---

## 9. العمولة وأثرها المحاسبي

- عمولة الوكيل لا تُحسب في دفتر الشحن مباشرة
- تُحسب وتُسجَّل عند إنشاء الشحنة (`shipmentFinancialPostingService`)
- تُخزَّن كـ snapshot على الشحنة:
  - `agent_commission_percentage_snapshot`
  - `agent_commission_amount_snapshot`
  - `agent_commission_base_type = 'FREIGHT_CHARGE'`
- **هذا يعني:** تغيير مبالغ سطر مرحَّل → `syncPostedShipmentFromLedgerRow` → تحديث مبالغ الشحنة → **لكن** الحركات المحاسبية (GL) لا تُعاد تلقائياً إذا كانت الشحنة قد مرّت بمرحلة مالية

---

## 10. ربط السائق والمركبة — المشكلة التفصيلية

### الوضع الحالي

```
daily_ledger_sessions
  ↳ driver_id (FK إلى drivers)
  ↳ vehicle_id (FK إلى vehicles)
  ↳ driver_label (نص)
  ↳ vehicle_label (نص)
```

- السائق والمركبة **خاصية الجلسة** وليسا خاصية السطر
- مفتاح الجلسة الفريد يتضمن `driver_id`
- **نتيجة عملية:** إذا فتح مدير الدفتر وادخل 30 سطراً بسائق A، ثم أراد تغيير السائق إلى B → إما:
  - يُنشئ جلسة جديدة (السائق B = جلسة منفصلة) والأسطر القديمة تبقى مع A
  - أو يحرّر الجلسة الأصلية (تحديث driver_id) لكن هذا يؤثر على **كل** أسطر تلك الجلسة

### في الواجهة: `resolveFleetForLedgerRow`
```typescript
function resolveFleetForLedgerRow(row, trip, driverList, vehicleList) {
  const driverId = row.sessionDriverId ?? trip.driverId;
  // يُعطي الأولوية لسائق الجلسة المرتبطة بالسطر، وإلا سائق الرحلة الحالية
}
```
- `row.sessionDriverId` = `driver_id` من الجلسة المرتبطة بالسطر عند تحميله من DB
- `trip.driverId` = السائق المختار حالياً في أعلى الشاشة

### نتيجة: تغيير السائق في أعلى الشاشة بعد إدخال بيانات
- الأسطر الجديدة ستُحفظ بالجلسة الجديدة (السائق الجديد)
- الأسطر القديمة تحمل `sessionDriverId` من الجلسة الأصلية
- عند الطباعة: تفلتر بـ `driverId` → الأسطر القديمة لن تظهر عند طباعة السائق الجديد، والأسطر الجديدة لن تظهر عند طباعة السائق القديم

---

## 11. الطباعة — التحليل التفصيلي

### 11.1 نوع 1: طباعة شحنات (جدول)
```typescript
// في executeShipmentsPrint()
const rows = await fetchAllDailyLedgerRows(baseParams, false);
// baseParams: branchId + dateFrom + dateTo + lineLabel + driverBackendId (اختياري)
```
- إذا اختار المستخدم سائداً → `driverId=UUID` في الطلب → يُفلتر `s.driver_id = $UUID`
- **إذا لم يختر سائقاً:** يجلب كل أسطر التاريخ
- **⚠️ مشكلة مفتاحية:** الطباعة تعتمد على `driver_id` في `daily_ledger_sessions` — إذا تغيّر السائق بعد إدخال البيانات:
  - الأسطر القديمة = مرتبطة بالسائق الأصلي
  - الأسطر الجديدة = مرتبطة بالسائق الجديد
  - طباعة بسائق واحد = أسطر ناقصة

### 11.2 نوع 2: طباعة إيصالات (نقليات المحمود)
- ورق مطبوع مسبقاً — 4 إيصالات/صفحة
- نفس مصدر البيانات
- نفس مشكلة تصفية السائق

### 11.3 مشكلة الطباعة بعد تغيير السائق
- **السيناريو:** أُدخلت 50 إيصالاً بسائق A، ثم تغيّر إلى سائق B قبل التحميل
- **ما يحدث:** السطور المُدخَلة تبقى مرتبطة بجلسة A، وطباعة سائق B لن تُظهرها
- **المطلوب:** الطباعة بالتاريخ والخط بدون فلتر سائق بشكل افتراضي، والسائق فلتر اختياري

---

## 12. قيد التاريخ السابق — التحليل

### 12.1 في الواجهة (Frontend)
```typescript
// src/pages/ShipmentQuickLedger.tsx
const canPickHistoricalDate = useMemo(() => {
  if (user.userType === 'admin' || user.role === 'admin') return true;
  if (['general_manager', 'branch_manager'].includes(user.role)) return true;
  return hasPermission('shipments.ledger.past_dates');
}, [user, hasPermission]);

// عند تغيير التاريخ:
if (!canPickHistoricalDate && next !== todayIso) {
  showToast('لا يمكن تغيير التاريخ — يلزم صلاحية تعديل تاريخ الدفتر', 'info');
  setTrip((prev) => ({ ...prev, date: todayIso }));
  return;
}
```

### 12.2 في الخادم (Backend)
```typescript
// server/src/routes/dailyLedgerRoutes.ts
function assertLedgerDateAllowed(roleCode, userType, ledgerDate, permissions) {
  const today = todayIsoDate();
  const isAdmin = roleCode === 'admin' || userType === 'admin';
  const isManager = isAdmin || roleCode === 'general_manager' || roleCode === 'branch_manager';
  const canUsePastDates = isManager || permissions.includes('shipments.ledger.past_dates');
  if (ledgerDate > today) throw new Error('لا يمكن إدخال بيانات بتاريخ مستقبلي.');
  if (ledgerDate !== today && !canUsePastDates) 
    throw new Error('لا يمكن العمل على تاريخ مختلف عن اليوم...');
}
```

**التحقق موجود في الخادم → لا يمكن تجاوزه من المتصفح.**

### 12.3 الصلاحية `shipments.ledger.past_dates`
- تُضاف عبر الترحيلة `091_data_entry_past_dates_and_fleet.sql`
- تُمنح لدور `data_entry` بشكل افتراضي بعد تطبيق هذه الترحيلة

---

## 13. هل الحفظ آمن؟ تحليل التكرار والـ Idempotency

### 13.1 ما يحمي من التكرار الآن

| الطبقة | الحماية |
|---|---|
| Frontend | `findDuplicateWithinBatch` + `findReceiptConflictWithPosted` + `findReceiptConflictWithUnposted` |
| Backend (repository) | `assertUniqueLedgerReceiptNo` → يرفض نفس الإيصال في (branch+date+line) |
| Backend (posting) | قبل إنشاء الشحنة: يبحث بـ `shipment_no = receipt_no` → يربط بالموجودة إن وُجدت |
| Backend (posting) | إذا `posted_shipment_id` موجود على السطر → تحديث لا إنشاء |
| DB | `UNIQUE (session_id, row_no)` — لا تكرار لرقم سطر في جلسة |

### 13.2 ما ينقص / الثغرات

| الثغرة | الوضع |
|---|---|
| تكرار الإيصال عبر **جلسات مختلفة** في نفس اليوم | **غير محمي بالكامل** — التحقق يشترط نفس (branch+date+line) لكن إذا اختلف الخط أو الفرع قد تمر |
| تكرار الإيصال عبر **تواريخ مختلفة** | **غير محمي** — لا يوجد constraint عالمي على company + receipt_no |
| إيصال موجود في جلسة تاريخ سابق لم يُرحَّل | **غير محمي** — يمكن إدخال نفس الإيصال اليوم إذا لم يكن في نفس الجلسة |
| حركات GL مكررة عند تعديل مبالغ مرحَّلة | **تحذير في الكود** — `syncPostedShipmentFromLedgerRow` يُحدِّث الشحنة لكن قد لا يعيد GL |

---

## 14. السيناريوهات العملية وما يحدث فعلياً

### السيناريو أ: 50 سطر، 30 للمركبة الأولى و20 لأخرى
- **الوضع الحالي:** كل الأسطر تُحفظ في جلسة السائق الأصلي
- **المشكلة:** لا آلية لنقل 20 سطراً لجلسة سائق آخر
- **ما يحدث عملياً:** إما يُعيد المستخدم الإدخال يدوياً، أو يُغيّر السائق مما ينشئ جلسة جديدة والأسطر الأصلية تبقى منفصلة
- **الخطر:** إذا رحّل من الجلسة الأصلية ثم نقل الشحنات لبيان آخر يدوياً → ازدواج محاسبي محتمل

### السيناريو ب: أسطر محفوظة ومطبوعة ثم تغيير 10 أسطر لسائق آخر
- **الوضع الحالي:** لا آلية للنقل
- إذا تغيّر السائق → جلسة جديدة → 10 أسطر مستقلة → الطباعة الأصلية لا تعكس الواقع
- لا يوجد «إعادة طباعة مع تصحيح» رسمي

### السيناريو ج: تغيير السائق قبل التحميل
- إذا لم يُرحَّل بعد: يمكن تغيير السائق بتحرير الجلسة أو إعادة الإدخال
- إذا رُحِّل: الشحنات موجودة في DB ببيانات السائق القديم (في notes/labels فقط، لا في جدول منفصل)
- **سجل الحفظ (audit log):** موجود كـ client-side log يُنزَّل محلياً فقط — لا سجل مركزي

### السيناريو د: إيصال ناقص بالأمس
- موظف إدخال بيانات بدون `shipments.ledger.past_dates`: **مرفوض** — الخادم يرفض التاريخ
- مدير: يمكنه فتح التاريخ الأمس وإدخال السطر
- **السؤال المفتوح:** إذا الدفتر لذلك اليوم مرحَّل بالفعل:
  - السطر الجديد سيُحفظ في نفس الجلسة (إذا نفس السائق) أو جلسة جديدة (سائق مختلف)
  - عند ترحيله: إذا receipt_no غير موجود في shipments → شحنة جديدة ✅
  - إذا receipt_no موجود في shipments من قبل → ربط ✅ (أفضل حالة)
  - إذا receipt_no موجود في دفتر نفس اليوم في نفس الخط → رفض 409 ❌

### السيناريو هـ: إيصال ناقص لدفتر مرحَّل ومحمَّل
- `loaded_at is not null` → السطر مقفل — لا يمكن تعديله
- **المطلوب:** آلية «ملحق إرسالية» لإضافة سطر إلى شحنة/بيان مغلق

### السيناريو و: حفظ نفس الإيصال مرتين
- Frontend: يُنبّه بخلفية حمراء عند الكشف المحلي
- Backend: يرفض بـ HTTP 409 مع رسالة «رقم الإيصال مكرر في هذا الدفتر»
- **لكن:** إذا في جلستين مختلفتين بنفس اليوم (اختلف السائق) → قد لا يُرفض إذا خط مختلف

### السيناريو ز: سطر مرتبط بحوالة
- حقل `hawala_amount_usd` في السطر يُنقل للشحنة كـ `hawala_amount`
- لا يوجد `transfer_id` على سطر الدفتر
- الحوالة تُنشأ منفصلة في `transfers` وترتبط بـ `shipment_id`
- نقل السطر لجلسة أخرى: يُغيّر الشحنة المرتبطة → قد ينفصل عن الحوالة

### السيناريو ح: سطر مع عمولة وكيل محسوبة
- snapshot محفوظ على `shipments.agent_commission_amount_snapshot`
- إذا تغيّر الوكيل بتغيير `destination` → `syncPostedShipmentFromLedgerRow` → يُحدِّث `agent_id` على الشحنة
- **خطر:** لا يُعاد حساب snapshot العمولة تلقائياً بعد التغيير في الحالات المعقدة

---

## 15. تصميم ميزة «نقل إرسالية»

### 15.1 المتطلبات الأساسية

```
المستخدم يختار أسطراً من دفتر الشحن الحالي
ثم ينقلها إلى:
  - نفس التاريخ + سائق مختلف ✅
  - تاريخ مختلف + نفس السائق ✅
  - تاريخ مختلف + سائق مختلف ✅
  - نفس التاريخ + نفس السائق (تجميع فقط) ✅
  - مركبة مختلفة ✅
```

### 15.2 قواعد العمل (Business Rules)

#### أسطر قابلة للنقل
- ✅ السطر محفوظ في DB (`dbId` موجود)
- ✅ السطر لم يُحمَّل على بيان (`loaded_at is null`)
- ✅ السطر مرحَّل أو غير مرحَّل (كلاهما قابل للنقل، لكن بآليتين مختلفتين)
- ✅ المستخدم لديه صلاحية النقل

#### أسطر غير قابلة للنقل
- ❌ السطر محمَّل على بيان (`loaded_at is not null`)
- ❌ السطر محذوف منطقياً
- ❌ تكرار رقم الإيصال في الجلسة الهدف

#### آلية النقل الصحيحة

```
النوع 1: سطر غير مرحَّل (لا posted_shipment_id)
→ UPDATE daily_ledger_rows SET session_id = <target_session_id>
→ إعادة ترقيم row_no في الجلسة الهدف
→ لا أثر مالي — البيانات التشغيلية فقط

النوع 2: سطر مرحَّل (له posted_shipment_id)
→ UPDATE daily_ledger_rows SET session_id = <target_session_id>
→ إذا تغيّر السائق/المركبة: تحديث notes/labels في الشحنة فقط (لا إعادة GL)
→ إذا تغيّر الوكيل (destination): تحديث agent_id في الشحنة + إعادة حساب عمولة
→ لا إنشاء شحنة جديدة — نفس posted_shipment_id

النوع 3: سطر مرحَّل وترحيل مالي كامل (financial_status = 'POSTED')
→ هذا الحالة تحتاج موافقة مدير + تسجيل قيد تعديل
→ خارج نطاق النقل التشغيلي البسيط
```

### 15.3 الجداول المقترحة للميزة

#### `daily_ledger_row_transfers` (جدول مقترح)
```sql
CREATE TABLE daily_ledger_row_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  transfer_no text NOT NULL,         -- رقم عملية النقل
  source_session_id uuid NOT NULL REFERENCES daily_ledger_sessions(id),
  target_session_id uuid NOT NULL REFERENCES daily_ledger_sessions(id),
  old_driver_id uuid REFERENCES drivers(id),
  new_driver_id uuid REFERENCES drivers(id),
  old_vehicle_id uuid REFERENCES vehicles(id),
  new_vehicle_id uuid REFERENCES vehicles(id),
  reason text,
  transferred_by uuid REFERENCES users(id),
  transferred_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'completed'  -- completed / cancelled
);

CREATE TABLE daily_ledger_row_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES daily_ledger_row_transfers(id),
  row_id uuid NOT NULL REFERENCES daily_ledger_rows(id),
  old_session_id uuid NOT NULL REFERENCES daily_ledger_sessions(id),
  new_session_id uuid NOT NULL REFERENCES daily_ledger_sessions(id)
);
```

#### تعديل `daily_ledger_rows` (مقترح)
```sql
ALTER TABLE daily_ledger_rows
  ADD COLUMN IF NOT EXISTS original_session_id uuid REFERENCES daily_ledger_sessions(id),
  ADD COLUMN IF NOT EXISTS transferred_from_row_id uuid REFERENCES daily_ledger_rows(id),
  ADD COLUMN IF NOT EXISTS transfer_status text;  -- null / 'transferred_out' / 'transferred_in'
```

### 15.4 تدفق تجربة المستخدم (UX Flow)

```
الحالة الطبيعية (Normal Mode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[+] إضافة سطر  [تحديث]  [طباعة]  [حذف أسطر]  [نقل إرسالية] ← زر جديد  [حفظ الشحنات]

الجدول يعرض الأسطر بشكل عادي

↓ عند الضغط على [نقل إرسالية]:

حالة التحديد (Selection Mode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
يظهر checkbox بجانب كل سطر قابل للنقل
الأسطر المحمّلة (loaded) = معطلة مع تلميح «لا يمكن نقل سطر محمّل»

شريط السياق يظهر:
┌──────────────────────────────────────────────────────────────┐
│ تم تحديد: 12 سطر  |  طرود: 45  |  وزن: 230كغ  |  إجمالي: $890  │
│ [إلغاء التحديد]                          [تأكيد النقل →]       │
└──────────────────────────────────────────────────────────────┘

↓ عند الضغط على [تأكيد النقل]:

حوار تأكيد النقل
━━━━━━━━━━━━━━━
┌────────────────────────────────────────────────────────┐
│  نقل إرسالية                                           │
│ ─────────────────────────────────────────────────────── │
│  الأسطر المحددة: 12  |  الطرود: 45  |  الوزن: 230كغ   │
│  الوكلاء/الوجهات ضمن التحديد: الرقة، دير الزور         │
│                                                        │
│  [تحذير] يحتوي التحديد على أسطر مرحّلة — سيُحدَّث     │
│  السائق/المركبة فقط، لن تُنشأ شحنات جديدة.             │
│                                                        │
│  التاريخ الجديد: [2026-06-07 ▼]  (أو تاريخ مختلف)     │
│  السائق:         [أحمد محمد ▼]                         │
│  المركبة:        [نوسف 1234 ▼]                          │
│  سبب النقل*:     [____________________________]         │
│                                                        │
│                        [إلغاء]  [تأكيد النقل ✓]        │
└────────────────────────────────────────────────────────┘
```

### 15.5 منطق Backend للنقل

```
POST /daily-ledger/rows/transfer
Body: {
  rowIds: string[],      // معرّفات الأسطر
  targetLedgerDate: string,
  targetDriverId: string | null,
  targetVehicleId: string | null,
  reason: string
}

التحقق:
1. كل rowIds موجودة ولم تُحذف ولم تُحمَّل
2. المستخدم لديه صلاحية daily_ledger.transfer.create
3. لا تكرار receipt_no في الجلسة الهدف
4. إذا targetLedgerDate != today → يحتاج shipments.ledger.past_dates

التنفيذ (في Transaction):
1. إيجاد أو إنشاء جلسة هدف (target_session)
2. لكل سطر:
   a. تحديث session_id → target_session.id
   b. تعيين original_session_id إذا null
   c. إعادة ترقيم row_no في الجلسة الهدف
   d. إذا posted_shipment_id: تحديث driver_label/vehicle_label في الشحنة
3. إنشاء سجل في daily_ledger_row_transfers
4. تسجيل كل سطر في daily_ledger_row_transfer_items

الإرجاع:
{
  transferId: uuid,
  transferNo: string,
  targetSessionId: uuid,
  movedRows: number,
  errors: []
}
```

---

## 16. تصميم مسار إضافة الإيصال الناقص (تاريخ سابق)

### 16.1 المشكلة
موظف المستودع يجد إيصالاً لم يُسجَّل في يوم سابق. النظام يمنعه من فتح تاريخ سابق.

### 16.2 المسار الآمن المقترح

```
سيناريو 1: الدفتر لم يُرحَّل بعد
→ مدير يفتح التاريخ السابق ويضيف السطر الناقص
→ السطر يُحفظ في نفس الجلسة (إذا نفس السائق/الخط)
→ يُرحَّل مع باقي الأسطر
→ سجل التدقيق يُسجَّل بـ «تاريخ سابق» + سبب

سيناريو 2: الدفتر مرحَّل لكن لم يُحمَّل على بيان
→ مدير يفتح التاريخ السابق ويضيف السطر
→ السطر يُحفظ كسطر جديد في الدفتر
→ عند الترحيل: إذا receipt_no غير موجود في shipments → شحنة جديدة (صحيح)
→ إذا الإيصال موجود بالفعل كشحنة → ربط (صحيح، لا تكرار)

سيناريو 3: الدفتر مرحَّل ومحمَّل على بيان
→ هذا السيناريو يحتاج «ملحق بيان» وليس «دفتر تاريخ سابق»
→ المسار: إضافة الشحنة الناقصة مباشرة في قسم «الشحنات» ثم إضافتها للبيان
→ أو: سماح مشرف بإضافة بيان ملحق

سيناريو 4: الإيصال موجود بالفعل كشحنة مرتبطة بسطر آخر
→ نظام يرفض الإنشاء المكرر (HTTP 409)
→ يجب على المستخدم التحقق والتعديل على السطر الأصلي
```

### 16.3 زر «إضافة إيصال ناقص» المقترح

```
في شاشة الدفتر اليومي — بجانب اختيار التاريخ:
[إضافة إيصال ناقص ←] (يظهر فقط للمدير أو من لديه الصلاحية)

↓ الضغط يفتح حواراً:
- يطلب رقم الإيصال
- يبحث: هل موجود في الدفتر؟ في الشحنات؟ في البيانات؟
- يعرض النتيجة:
  ✅ «إيصال جديد — سيُضاف لدفتر [التاريخ]»
  ⚠️ «موجود في دفتر [التاريخ] غير مرحَّل — اضغط للانتقال إليه»
  ⚠️ «موجود كشحنة [رقم] — هل تريد الربط؟»
  ❌ «موجود في بيان محمَّل — لا يمكن التعديل»
```

---

## 17. تصميم الصلاحيات المطلوبة

### 17.1 الصلاحيات الحالية الموجودة

| الصلاحية | الوصف | الأدوار الحالية |
|---|---|---|
| `shipments.read` | عرض الدفتر | الكل |
| `shipments.write` | حفظ وترحيل | الكل (غير agent) |
| `shipments.ledger.past_dates` | تاريخ سابق | admin + general_manager + branch_manager + data_entry (بعد 091) |

### 17.2 الصلاحيات المقترحة للإضافة

```sql
-- نقل الإرسالية
'daily_ledger.transfer.view'     -- رؤية عمليات النقل
'daily_ledger.transfer.create'   -- إنشاء نقل جديد
'daily_ledger.transfer.confirm'  -- تأكيد النقل (إذا احتاج موافقة ثانية)

-- تاريخ سابق للتعديل
'daily_ledger.backdate.create'   -- إضافة سطر بتاريخ سابق
'daily_ledger.backdate.update'   -- تعديل سطر بتاريخ سابق
'daily_ledger.backdate.approve'  -- الموافقة على التعديل

-- أسطر مرحَّلة
'daily_ledger.posted.adjust'     -- تعديل سطر مرحَّل (مع قيود محاسبية)

-- طباعة
'daily_ledger.print.original'    -- طباعة أصلية
'daily_ledger.print.reprint'     -- إعادة طباعة
'daily_ledger.print.revised'     -- طباعة بعد تصحيح

-- تدقيق
'daily_ledger.audit.view'        -- عرض سجل عمليات الدفتر
```

### 17.3 توزيع الصلاحيات على الأدوار

| الصلاحية | Admin | General Manager | Branch Manager | Data Entry | Accountant |
|---|---|---|---|---|---|
| `transfer.create` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `backdate.create` | ✅ | ✅ | ✅ | بصلاحية خاصة | ❌ |
| `posted.adjust` | ✅ | ✅ | ❌ | ❌ | ✅ |
| `print.reprint` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `audit.view` | ✅ | ✅ | ✅ | ❌ | ✅ |

---

## 18. تصميم منع التكرار المعزَّز

### 18.1 القيود الموجودة حالياً

```sql
-- على الجلسة: company + branch + date + line + driver
UNIQUE INDEX uq_daily_ledger_sessions_unique ...

-- على السطر: session + row_no
UNIQUE INDEX uq_daily_ledger_rows_row_no (session_id, row_no) WHERE deleted_at is null

-- الإيصال ضمن نفس الجلسة (backend assertion, ليس DB constraint)
assertUniqueLedgerReceiptNo → يتحقق ضمن (company + branch + date + line)
```

### 18.2 القيود المفقودة

```sql
-- مقترح: منع إيصال مكرر على مستوى الشركة + اليوم (ليس فقط الخط)
-- تحتاج تقييم: هل يمكن لنفس الإيصال أن يكون في خطين مختلفين في نفس اليوم؟
-- إذا لا → add unique constraint

-- مقترح: فهرس على shipments.shipment_no per company
-- موجود؟ يحتاج تحقق في ترحيلات جدول shipments
```

### 18.3 Idempotency للحفظ

- `upsert` يستخدم `ON CONFLICT (session_id, row_no) DO UPDATE` → حفظ مكرر = تحديث ✅
- إذا نُقل السطر لجلسة أخرى → `session_id` تغيّر → `row_no` قد يتعارض في الجلسة الجديدة → يحتاج إعادة ترقيم
- **مقترح:** استخدام `rowId` (UUID) بدلاً من `(session_id, row_no)` كمعرّف أساسي للتحديث عند النقل

---

## 19. تصميم سجل التدقيق (Audit Log)

### الموجود حالياً
- `client_logs` جانب المستخدم فقط — يُنزَّل محلياً
- `created_by` / `updated_by` على كل سجل في DB
- `posted_at` عند الترحيل

### المقترح

```sql
CREATE TABLE daily_ledger_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  action_type text NOT NULL,  -- 'create' | 'update' | 'delete' | 'post' | 'load' | 'transfer' | 'backdate_create'
  row_id uuid REFERENCES daily_ledger_rows(id),
  session_id uuid REFERENCES daily_ledger_sessions(id),
  actor_user_id uuid REFERENCES users(id),
  old_values jsonb,
  new_values jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 20. مخاطر محاسبية حالية

| المخاطرة | الخطورة | الحماية الحالية |
|---|---|---|
| ترحيل نفس الإيصال مرتين | عالية | يربط بالموجودة لكن غير مضمون 100% |
| تغيير مبالغ سطر مرحَّل ماليًا | عالية | التحديث يمر لكن GL لا يُعاد |
| تغيير وكيل بعد حساب عمولة | متوسطة | syncPosted يُحدِّث agent_id لكن قد لا يُعيد snapshot العمولة |
| حذف سطر دفتر مرتبط بشحنة | منخفضة | الشحنة تبقى في DB |
| إضافة إيصال ناقص كشحنة جديدة للإيصال نفسه | عالية | 409 إذا نفس الجلسة، غير محمي عبر جلسات مختلفة |
| تغيير السائق بعد الترحيل بدون توثيق | متوسطة | لا توجد سجل رسمي للتغيير |

---

## 21. مخاطر تشغيلية حالية

| المخاطرة | التأثير |
|---|---|
| طباعة بعد تغيير السائق = أسطر مفقودة | المستودع يعمل بمعلومات غير مكتملة |
| لا يوجد «بحث بالإيصال» قبل الإدخال | موظف يُدخل مكرراً دون علم |
| موظف إدخال بيانات ممنوع من تاريخ سابق | لا يستطيع إصلاح خطأ أمس |
| لا يوجد مسار «نقل إرسالية» رسمي | تغيير السائق يُفرّق الأسطر |
| لا يوجد «إغلاق» رسمي للدفتر اليومي | يمكن إضافة أسطر لأي تاريخ متى أُذن |

---

## 22. إجابات الأسئلة التقنية

### هل «نقل إرسالية» ممكن بالمخطط الحالي؟

**نعم، جزئياً.** المخطط يسمح بتحديث `session_id` على سطر، لكن:
- يحتاج إعادة ترقيم `row_no` في الجلسة الهدف
- يحتاج التحقق من عدم تكرار `receipt_no` في الجلسة الهدف
- للأسطر المرحَّلة: يحتاج تحديث labels في الشحنة
- **ينقص:** جدول لتسجيل عمليات النقل (audit)

### الحد الأدنى للتنفيذ الآمن

```
Backend:
1. endpoint: POST /daily-ledger/rows/transfer
2. validation: loaded_at is null + no receipt_no dup in target
3. transaction: update session_id + resequence row_no + create audit record
4. if posted: update driver/vehicle labels on shipment

Frontend:
1. زر «نقل إرسالية» في شريط الأدوات
2. حالة تحديد (checkboxes)
3. شريط سياق مع الإجمالي
4. حوار اختيار الجلسة الهدف
5. إعادة تحميل بعد النقل
```

### هل تُنشأ شحنة جديدة عند النقل؟
**لا** — النقل يُغيّر ارتباط السطر بالجلسة فقط، والشحنة المرتبطة (`posted_shipment_id`) تبقى كما هي.

### هل يُغيّر النقل الأثر المالي؟
- **السائق/المركبة:** لا أثر مالي — يُحدَّث في labels/notes فقط
- **التاريخ:** لا أثر مالي — يُحدَّث موقع السطر في الدفتر
- **الوكيل (destination):** تغيير الوجهة → قد يُغيّر الوكيل → يحتاج مراجعة عمولة

---

## 23. خطة التنفيذ المقترحة

### المرحلة 1: تأكيد قاعدة البيانات والأدوات الحالية
- تأكيد تطبيق ترحيلة 086 (driver_id/vehicle_id على الجلسة)
- تأكيد تطبيق ترحيلة 091 (صلاحية past_dates)
- اختبار السيناريوهات الأساسية محلياً

### المرحلة 2: صلاحيات النقل والتدقيق
- إضافة صلاحيات: `daily_ledger.transfer.create` / `backdate.create`
- تعديل جدول `permissions` و `role_permissions`
- ترحيلة جديدة: `092_ledger_transfer_permissions.sql`

### المرحلة 3: Backend — نقل الإرسالية
- إضافة جدوليْ `daily_ledger_row_transfers` + `daily_ledger_row_transfer_items`
- ترحيلة: `093_daily_ledger_transfers_table.sql`
- إنشاء `POST /daily-ledger/rows/transfer` في `dailyLedgerRoutes.ts`
- خدمة: `DailyLedgerTransferService.ts`
- تحقق: `loaded_at is null` + `no receipt_no dup` + صلاحية

### المرحلة 4: Frontend — وضع التحديد
- تعديل `ShipmentQuickLedger.tsx`:
  - حالة `transferMode` (boolean)
  - `selectedTransferRowIds` (Set)
  - checkboxes على الأسطر القابلة للنقل
  - شريط السياق مع الإجمالي
  - زر «نقل إرسالية» في الشريط العلوي

### المرحلة 5: Frontend — حوار النقل
- مكوّن جديد: `QuickLedgerTransferDialog.tsx`
- اختيار: تاريخ + سائق + مركبة + سبب
- عرض ملخص الأسطر المحددة
- تحذيرات إذا فيها أسطر مرحّلة
- استدعاء `POST /daily-ledger/rows/transfer`

### المرحلة 6: إصلاح الطباعة
- إضافة خيار «طباعة بالتاريخ فقط» بدون فلتر سائق
- إبقاء فلتر السائق اختيارياً
- إضافة عمود «السائق/المركبة» في الجدول المطبوع

### المرحلة 7: مسار الإيصال الناقص
- زر «بحث عن إيصال» أو «إضافة إيصال ناقص»
- بحث في: دفتر الشحن + جدول shipments + جدول manifests
- عرض الحالة: جديد / موجود في دفتر / موجود كشحنة / محمّل على بيان
- ربط أو إنشاء حسب الحالة

### المرحلة 8: الاختبار الميداني
- محاكاة سيناريوهات: 50 إيصال → نقل 20 → بيان
- محاكاة: إيصال ناقص بالأمس → بحث → إضافة
- تحقق من عدم التكرار في الشحنات والعمولات

### المرحلة 9: الاختبار المحلي (Electron)
- تشغيل النظام محلياً
- اختبار كامل للسيناريوهات

### المرحلة 10: نشر VPS
```bash
# على VPS ~/abooerp
git pull
npm install
npm run migrate
npm run build
cp -r dist/ /var/www/abooerp/frontend/
pm2 restart abooerp-backend
# اختبار في المتصفح
```

---

## 24. أسئلة تحتاج قرار صاحب المشروع

1. **عند نقل سطر مرحَّل لوكيل مختلف:** هل يُعاد حساب عمولة الوكيل الجديد تلقائياً؟ أم يظل للوكيل الأصلي؟

2. **نقل السطر المحمَّل:** هل يُسمح بنقل سطر محمَّل على بيان في حالات خاصة (موافقة مدير)؟ أم ممنوع بالكامل؟

3. **إيصال ناقص بتاريخ سابق بدون سائق:** هل يُسمح بإضافة إيصال لدفتر سابق بدون سائق؟ أم يُشترط السائق؟

4. **سبب النقل:** هل سبب النقل إلزامي أم اختياري؟ ومن يملك صلاحية التحقق؟

5. **الطباعة بعد النقل:** هل يجب أن تُعلَّم الطباعة الأصلية بـ «معدَّل» وتُتاح «إعادة طباعة» للدفتر الجديد؟

6. **نقل الأسطر الناقصة من شحنة سابقة:** هل يُضاف مسار مستقل لـ «ملحق إرسالية» يُتيح ربط إيصال بشحنة/بيان موجود؟

7. **موظف إدخال البيانات والتاريخ السابق:** هل يُمنح صلاحية `daily_ledger.backdate.create` بشكل افتراضي أم يحتاج موافقة مدير لكل حالة؟

8. **الحد الزمني للتعديل:** هل يوجد حد أقصى للتعديل بتاريخ سابق؟ مثلاً: «لا يمكن تعديل دفتر أقدم من أسبوع»؟

---

## 25. التوصية النهائية

### الأولوية القصوى (قبل أي برمجة)

1. **تطبيق ترحيلة 091** على الخادم الحالي إذا لم تُطبَّق، وإعادة تسجيل الدخول لتحديث الصلاحيات.
2. **التحقق من سيناريو الإيصال الناقص:** طبّق الخطوات يدوياً كمدير وتحقق من أن الإيصال يُضاف بشكل صحيح دون تكرار.

### الأولوية المتوسطة (التنفيذ التالي)

3. **إصلاح الطباعة:** جعل السائق فلتراً اختيارياً، والتاريخ هو المعيار الأساسي. هذا بسيط وعالي الأثر.
4. **مسار الإيصال الناقص:** إضافة «بحث بالإيصال» قبل الإدخال — يمنع معظم حالات التكرار.

### الأولوية الاستراتيجية (تصميم متأنٍّ)

5. **نقل إرسالية:** تنفيذ كامل حسب التصميم أعلاه — يحل مشكلة تغيير السائق جذرياً.
6. **فصل «إدخال البيانات» عن «تعيين الرحلة»:** السائق/المركبة اختيار اختياري عند الإدخال، وإلزامي فقط عند التحميل على البيان — هذا أكبر إعادة تصميم لكنه يُزيل أصل المشكلة.

### المبدأ الجوهري

> **كل عملية نقل تشغيلية (تغيير سائق/مركبة) لا يجب أن تُنشئ أثراً مالياً جديداً. الأثر المالي يُنشأ فقط عند «ترحيل الشحنة» للمرة الأولى أو عند «تصحيح مالي» مُعتمَد.**

---

## المراجع التقنية

| الملف | الوظيفة |
|---|---|
| `src/pages/ShipmentQuickLedger.tsx` | الواجهة الأمامية الكاملة — 2961 سطر |
| `server/src/routes/dailyLedgerRoutes.ts` | توجيه طلبات الدفتر + التحقق من التاريخ |
| `server/src/services/dailyLedgerService.ts` | طبقة الخدمة — upsert + sync |
| `server/src/services/dailyLedgerShipmentPostingService.ts` | الترحيل + syncPostedShipment |
| `server/src/repositories/dailyLedgerRepository.ts` | SQL — CRUD + markPosted + markLoaded |
| `server/src/db/migrations/074_daily_shipment_ledger.sql` | إنشاء الجداول الأساسية |
| `server/src/db/migrations/086_daily_ledger_driver_vehicle.sql` | إضافة driver_id/vehicle_id للجلسة |
| `server/src/db/migrations/088_daily_ledger_receipt_no_index.sql` | فهرس الإيصال |
| `server/src/db/migrations/091_data_entry_past_dates_and_fleet.sql` | صلاحية التاريخ السابق |
| `src/lib/shipping/mahmoudPreprintedReceiptPrint.ts` | طباعة الإيصالات المسبقة |

---

*انتهى التقرير — هذه وثيقة تشخيص وتصميم فقط. لا تعديل في الكود.*
