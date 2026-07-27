# تقرير: إصلاح حرج — الحفظ/الترحيل يقتصر على الإرسالية النشطة فقط

## 1. الملفات التي تمّت مراجعتها
- `docs/DAILY_SHIPPING_LEDGER_TRANSFER_REPORT_AR.md`
- `docs/DAILY_LEDGER_TRANSFER_IMPLEMENTATION_AR.md`
- `docs/DAILY_LEDGER_TRANSFER_COMPLETION_REPORT_AR.md`
- `docs/DAILY_LEDGER_SESSION_NAVIGATION_REPORT_AR.md`
- `src/pages/ShipmentQuickLedger.tsx`
- `server/src/routes/dailyLedgerRoutes.ts`
- `server/src/services/dailyLedgerService.ts`
- `server/src/services/dailyLedgerShipmentPostingService.ts`
- `server/src/repositories/dailyLedgerRepository.ts`

## 2. الملفات المُعدّلة
- `src/pages/ShipmentQuickLedger.tsx`
- `src/index.css`
- `server/src/routes/dailyLedgerRoutes.ts`
- `server/src/services/dailyLedgerService.ts`
- `server/src/services/dailyLedgerShipmentPostingService.ts`

## 3. السبب الجذري للخطأ

بعد إضافة تبويبات `[الكل] [1] [2]`، بقي زر **«حفظ الشحنات»** يعمل على **`rowsRef.current` الكامل** (كل أسطر اليوم في الذاكرة)، وليس على الإرسالية النشطة فقط.

```typescript
// قبل الإصلاح — خطأ
const rowsToPost = currentRows.filter((row) => isRowComplete(row) && !row.postedShipmentId);
```

النتيجة العملية:
1. موظف ينقل أسطر منبج إلى إرسالية `[2]`.
2. يبقى على `[الكل]` أو `[1]`.
3. يضغط «حفظ الشحنات».
4. يُرحَّل **كل** الأسطر غير المُرحَّلة في الذاكرة — بما فيها أسطر `[2]` المنقولة — مع الإرسالية المصدر.

مشكلة ثانوية مرتبطة: عند التبديل بين `[1]` و `[2]` كان `flushPendingRowSaves()` يحفظ **كل** الأسطر (87 سطراً) فيتجمد الزر ولا يستجيب بسرعة على المتصفح.

## 4. أي الإجراءات كانت تستخدم كل الأسطر؟

| الإجراء | قبل الإصلاح | بعد الإصلاح |
|---------|-------------|-------------|
| **حفظ الشحنات / الترحيل** (`saveRows`) | كل `rowsRef.current` | إرسالية نشطة فقط |
| **POST `/daily-ledger/rows/post-shipments`** | كل أسطر التاريخ/الخط (أو rowIds بدون تحقق جلسة) | يتطلب `sessionId` عند وجود أكثر من إرسالية |
| **طباعة اليوم** | كل الأسطر | بدون تغيير ✅ |
| **طباعة الإرسالية** | حسب النطاق | بدون تغيير ✅ |
| **نقل إرسالية** | الأسطر المحددة | بدون تغيير ✅ |
| **عرض `[الكل]`** | كل الأسطر | بدون تغيير ✅ |

## 5. كيف يُفرَض `activeSessionId` الآن (الواجهة)

1. **حظر من `[الكل]`:** إذا `activeSessionId === null` → رسالة:
   > لا يمكن تنفيذ هذا الإجراء من وضع "الكل". اختر إرسالية محددة أولاً.

2. **زر «حفظ الشحنات»:** معطّل في `[الكل]` مع `title` توضيحي.

3. **تلميح مرئي:** عند `[الكل]` ووجود أكثر من إرسالية:
   > وضع «الكل» للمراجعة والطباعة اليومية فقط. اختر إرسالية [1] أو [2]… قبل «حفظ الشحنات» أو الترحيل.

4. **نطاق الحفظ:** دالة `rowInActiveSessionScope(row, sessionId)`:
   - أسطر `sessionId === activeSessionId`
   - أو أسطر إدخال جديدة (`!dbId && !sessionId`) ضمن الإرسالية المعروضة

5. **إرسال للخادم:** `post-shipments` يُرسل `sessionId: activeSessionId` مع `rowIds`.

6. **إحصائيات الشاشة:** عند اختيار إرسalia محددة، تُعرض إحصائيات **تلك الإرسالية** فقط.

7. **تبديل الإرساليات:** `selectSession` يحفظ أسطر الإرسالية الحالية فقط (لا 87 سطراً)، مع مؤشر «جاري التبديل…».

8. **تحديث `sessionId` محلياً** بعد كل `upsert` من استجابة الخادم.

## 6. ماذا يحدث في `[الكل]`؟

- ✅ عرض كل الأسطر
- ✅ إجماليات اليوم
- ✅ طباعة اليوم
- ✅ البحث والمراجعة
- ❌ حفظ/ترحيل الشحنات (محظور)
- ❌ زر الحفظ معطّل

## 7. ماذا يحدث في `[1]`، `[2]`…؟

- ✅ عرض أسطر تلك الإرسالية فقط (+ سطر إدخال جديد)
- ✅ «حفظ الشحنات» يُرحّل **هذه الإرسالية فقط**
- ✅ طباعة الإرسالية الحالية
- ✅ نقل إرسالية (من الأسطر المعروضة)
- ✅ إحصائيات محصورة بالإرسalia

## 8. الحماية في الخادم (Backend)

في `DailyLedgerShipmentPostingService.postPendingShipments`:

1. **`sessionId` اختياري في الطلب** — لكن:
   - إذا وُجدت **أكثر من إرسالية** لنفس (فرع + تاريخ + خط) ولم يُرسَل `sessionId` → خطأ `DAILY_LEDGER_SESSION_REQUIRED`.
   - إذا وُجدت **إرسالية واحدة فقط** → يُسمح للتوافق مع العملاء القديمين.

2. **عند إرسال `sessionId`:** يُفلتر `loadPendingRows` بـ `s.id = sessionId`.

3. **عند إرسال `rowIds` + `sessionId`:** يُتحقَّق أن **كل** الأسطر تنتمي لنفس الإرسalia — وإلا خطأ.

4. **لا UPDATE/DELETE/INSERT تصحيحي** على بيانات مُرحَّلة قديمة.

## 9. لماذا لم تُعدَّل البيانات المُرحَّلة الحقيقية؟

- لا migration.
- لا سكربت تصحيح تلقائي.
- لا حذف شحنات.
- لا عكس قيود محاسبية.
- هذا الإصلاح **يمنع تكرار الخطأ** فقط.

أي تصحيح للبيانات التي أُرحِلت بالفعل خطأً يحتاج قراراً محاسبياً يدوياً منفصلاً.

## 10. هل أُضيفت Migration؟

**لا.**

## 11. نتائج الاختبار

- `npm run server:check`: ✅ نجح
- `npm run build`: ✅ نجح
- `npm run server:migrate`: **لم يُشغَّل** (لا حاجة)

## 12. قائمة اختبار يدوي

- [ ] `[الكل]` + حفظ → محظور برسالة عربية
- [ ] `[1]` + حفظ → فقط أسطر `[1]`
- [ ] بعد حفظ `[1]`، `[2]` لم تتغير
- [ ] `[2]` + حفظ → فقط أسطر `[2]`
- [ ] `[الكل]` + طباعة يوم → كل الأسطر
- [ ] `[1]` + طباعة إرسالية → `[1]` فقط
- [ ] نقل من `[1]` إلى `[2]` ثم حفظ `[1]` → منبج في `[2]` لا تُرحَّل
- [ ] حفظ `[2]` → فقط أسطر `[2]`
- [ ] نقر مزدوج حفظ → لا ازدواج
- [ ] تبديل `[1]` ↔ `[2]` → استجابة سريعة (لا تجميد)

## 13. استعلامات تدقيق SELECT-only (لا تُنفَّذ UPDATE/DELETE)

### أ) أسطر منقولة ومُرحَّلة (محتمل تأثر بالخطأ)

```sql
-- أسطر لها last_transfer_id ومرتبطة بشحنة
SELECT
  r.id,
  r.row_no,
  r.receipt_no,
  r.session_id AS current_session_id,
  r.original_session_id,
  r.last_transfer_id,
  r.posted_shipment_id,
  r.transfer_status,
  s.driver_label,
  s.ledger_date
FROM daily_ledger_rows r
JOIN daily_ledger_sessions s ON s.id = r.session_id
WHERE r.deleted_at IS NULL
  AND r.last_transfer_id IS NOT NULL
  AND r.posted_shipment_id IS NOT NULL
ORDER BY s.ledger_date DESC, r.row_no;
```

### ب) أسطر منقولة حيث الجلسة الحالية ≠ الجلسة الأصلية

```sql
SELECT
  r.id,
  r.receipt_no,
  r.original_session_id,
  r.session_id AS current_session_id,
  r.posted_shipment_id,
  t.transfer_no,
  t.old_driver_id,
  t.new_driver_id,
  t.transferred_at
FROM daily_ledger_rows r
JOIN daily_ledger_row_transfers t ON t.id = r.last_transfer_id
WHERE r.deleted_at IS NULL
  AND r.original_session_id IS NOT NULL
  AND r.original_session_id <> r.session_id
ORDER BY t.transferred_at DESC;
```

### ج) إيصالات منبج المُرحَّلة في يوم معيّن (مثال من الحادثة)

```sql
-- استبدل التاريخ والوجهة حسب الحاجة
SELECT
  r.receipt_no,
  r.destination,
  r.posted_shipment_id,
  sh.shipment_no,
  r.session_id,
  s.driver_label,
  r.last_transfer_id
FROM daily_ledger_rows r
JOIN daily_ledger_sessions s ON s.id = r.session_id
LEFT JOIN shipments sh ON sh.id = r.posted_shipment_id
WHERE r.deleted_at IS NULL
  AND s.ledger_date = '2026-06-07'::date  -- عدّل التاريخ
  AND lower(trim(coalesce(r.destination, ''))) LIKE '%منبج%'
  AND r.posted_shipment_id IS NOT NULL
ORDER BY r.receipt_no;
```

### د) جلسات متعددة في يوم واحد

```sql
SELECT
  s.ledger_date,
  s.line_label,
  s.id AS session_id,
  s.driver_label,
  s.vehicle_label,
  count(r.id) AS rows_count,
  count(r.posted_shipment_id) AS posted_count
FROM daily_ledger_sessions s
LEFT JOIN daily_ledger_rows r ON r.session_id = s.id AND r.deleted_at IS NULL
WHERE s.deleted_at IS NULL
GROUP BY s.id
HAVING count(r.id) > 0
ORDER BY s.ledger_date DESC, s.created_at;
```

### هـ) تكرار رقم إيصال (تحقق أمان)

```sql
SELECT
  r.receipt_no,
  count(*) AS row_count,
  count(DISTINCT r.posted_shipment_id) AS shipment_count
FROM daily_ledger_rows r
WHERE r.deleted_at IS NULL
  AND coalesce(trim(r.receipt_no), '') <> ''
GROUP BY lower(trim(r.receipt_no))
HAVING count(DISTINCT r.posted_shipment_id) > 1;
```

## 14. مخاطر متبقية

1. **بيانات أُرحِلت بالفعل خطأً** قبل هذا الإصلاح — تحتاج مراجعة محاسبية يدوية؛ لا يُصلَحها هذا التحديث تلقائياً.
2. **حذف أسطر من `[الكل]`** — لم يُحظر في هذه المهمة (التركيز على save/post).
3. **إرسalia واحدة فقط في اليوم** — الخادم يقبل طلباً بدون `sessionId` (توافق قديم).
4. **يجب إعادة نشر السحابة** بعد `git push` + `deploy` + `pm2 restart` + **Ctrl+F5** + **إعادة تسجيل الدخول**.

---

*انتهى التقرير — إصلاء وقائي دون مساس بالبيانات المُرحَّلة الحالية.*
