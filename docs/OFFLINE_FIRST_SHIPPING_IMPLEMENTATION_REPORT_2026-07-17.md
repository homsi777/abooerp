# تقرير تنفيذ Offline‑First لوحدة الشحن على Windows

تاريخ التحقق: 2026-07-17 (Asia/Damascus)  
المستودع: `C:\Users\Homsi\Desktop\almiya-hsahin`  
نطاق التقرير: ما نُفّذ واختُبر داخل المستودع والبيئات المعزولة فقط. لم تُطبّق migrations على قاعدة العمل الحالية، ولم يُنشر الكود على الخادم المركزي.

## 1. الخلاصة التنفيذية الصريحة

تم تنفيذ أساس متكامل وقابل للبناء لمزامنة دفتر الشحن اليومية Offline‑First: PostgreSQL محلي، Local Backend على loopback، Outbox ذري، Push/Replay/Conflict، Pull/Cursor، Scoped Snapshot، إجراءات مركزية مؤجلة، مصادقة جهاز، نسخ احتياطي مشفر، أداة استعادة، ومؤشر مزامنة محدود التدخل في الواجهة الحالية.

النتيجة **مثبتة آليًا داخل قواعد مؤقتة معزولة**، كما أن النسخة المجمعة `win-unpacked` اجتازت فحص Runtime فعليًا. لكنها **ليست اعتماد إنتاج نهائيًا بعد** للأسباب المثبتة الآتية:

- migration `112_offline_sync_foundation.sql` ما زالت غير مطبقة على قاعدة العمل الحالية.
- Central Sync API لم يُنشر بعد على `www.abooerp.org` ولم يُختبر ضد قاعدة الإنتاج.
- لم يُجر اختبار جهازين Windows فعليين، ولا إعادة تشغيل Windows، ولا تثبيت نظيف على VM Windows 10/11.
- لم تُنفذ مصفوفة الاختبارات اليدوية الإلزامية ذات 35 حالة بالكامل؛ يوضح القسم 14 الحالة الدقيقة لكل اختبار.
- أداة الاستعادة موجودة في كود المستودع واختُبر فك النسخة واستعادتها إلى قاعدة معزولة، لكن مسار swap الكامل لقاعدة جهاز مثبت لم يُنفذ فعليًا.

## 2. المعمارية المنفذة وحدود الملكية

```text
React Renderer
     |
     | HTTP 127.0.0.1 فقط لمسارات Desktop Offline
     v
Local Express Backend ----------------> Local PostgreSQL
     |                                      | business row + outbox
     |                                      | في transaction واحدة
     |
     | HTTPS + device token
     v
Central Sync API ----------------------> Central PostgreSQL
       push / pull / snapshot / conflicts     |
                                              +-- operation results
                                              +-- change feed
                                              +-- conflict records
                                              +-- deferred central actions
```

- الواجهة لا تتصل بـPostgreSQL مباشرة.
- الخادم المحلي والمستخدم المحلي لقاعدة البيانات يستخدمان `127.0.0.1`.
- لا توجد PostgreSQL logical replication بين الجهاز والمركزي.
- ترتيب عمليات الجهاز يعتمد على `sync_device_sequence` وليس ساعة Windows.
- هوية كل عملية UUID في `operation_id`، وهوية سجلات دفتر الشحن UUID أصلًا.
- القاعدة المركزية هي صاحبة القرار النهائي والنسخة authoritative.

### تصنيف البيانات

| التصنيف | الكيانات المنفذة |
|---|---|
| Local Writable | `daily_ledger_sessions`, `daily_ledger_rows`, `daily_ledger_dispatch_definitions`, `daily_ledger_row_transfers`, `daily_ledger_row_transfer_items`, `daily_ledger_print_events`, `daily_ledger_print_documents`, وكيانات sync المحلية |
| Local Read‑Only Snapshot | `companies`, `branches`, `agents`, `senders_receivers`, `customers`, `cities`, `currencies`, `goods_types`, `tariffs`, `drivers`, `vehicles`, المستخدم الحالي، دوره وصلاحياته وفروعه، إعدادات الدفتر والطباعة غير المشفرة، `printers`, وبيانات الشحن/المانيفست اللازمة للنطاق |
| Central‑Only | المالية، المخزون، `transfers` المالية، السندات، التسويات، إدارة الصلاحيات، وأي route كتابي غير موجود في allowlist المحلية |

`daily_ledger_row_transfers` نقل تشغيلي لأسطر الدفتر ومسموح محليًا. أما `transfers` فهي حوالات مالية ولم تدخل allowlist.

## 3. مخطط قاعدة المزامنة

المصدر الكامل القابل للتنفيذ: `server/src/db/migrations/112_offline_sync_foundation.sql` (378 سطرًا).

```text
linked_devices (1) ----< sync_operation_results >---- (1) companies
       |                            |
       | device_id                  | operation_id
       v                            v
sync_local_state              sync_conflicts

sync_device_sequence ---> sync_outbox ---- operation_id ----> sync_deferred_actions

companies (1) ----< sync_change_feed >---- (0..1) branches
                              |
                              +---- entity_type + entity_id (polymorphic reference)

daily_ledger_sessions (1) ----< daily_ledger_rows
          |
          +----< daily_ledger_row_transfers ----< daily_ledger_row_transfer_items
          +----< daily_ledger_print_events
branches/companies ----< daily_ledger_print_documents
```

### `sync_local_state`

| العمود | النوع/القيد | المعنى |
|---|---|---|
| `singleton` | boolean PK, default true, CHECK(singleton) | صف حالة وحيد للجهاز |
| `device_id` | uuid NOT NULL UNIQUE | هوية الجهاز |
| `device_name` | text NOT NULL default `desktop-node` | اسم الجهاز |
| `app_version` | text nullable | نسخة التطبيق |
| `schema_version` | text nullable | نسخة المخطط المحلي |
| `last_central_cursor` | bigint NOT NULL default 0 | آخر cursor مطبق |
| `last_push_at`, `last_pull_at`, `last_successful_sync_at` | timestamptz nullable | أوقات القياس |
| `offline_grant_expires_at` | timestamptz nullable | نهاية صلاحية الدخول Offline |
| `snapshot_initialized_at` | timestamptz nullable | نجاح أول Snapshot |
| `resnapshot_required` | boolean NOT NULL default false | ضرورة إعادة snapshot |
| `created_at`, `updated_at` | timestamptz NOT NULL default now() | تدقيق زمني |

### `sync_outbox`

| العمود | النوع/القيد | المعنى |
|---|---|---|
| `operation_id` | uuid PK default `gen_random_uuid()` | مفتاح idempotency |
| `device_id` | uuid NOT NULL | الجهاز المنشئ |
| `device_sequence` | bigint NOT NULL, UNIQUE مع الجهاز | ترتيب محلي ثابت |
| `company_id`, `branch_id`, `user_id` | uuid nullable مع FKs | نطاق العملية |
| `entity_type` | text NOT NULL | اسم من allowlist ثابتة |
| `entity_id` | uuid NOT NULL | هوية السجل |
| `operation_type` | text CHECK UPSERT/DELETE/ACTION | نوع العملية |
| `payload` | jsonb NOT NULL | الطلب الكامل |
| `payload_version` | integer NOT NULL default 1 | نسخة شكل payload |
| `payload_hash` | text NOT NULL | كشف تبديل طلب لنفس operation |
| `local_base_version` | bigint nullable | أساس optimistic concurrency |
| `sync_status` | text NOT NULL | PENDING/SENDING/ACKNOWLEDGED/RETRY/CONFLICT/REJECTED/BLOCKED |
| `attempt_count` | integer NOT NULL CHECK >=0 | عدد المحاولات |
| `next_retry_at`, `last_attempt_at` | timestamptz nullable | backoff والتشغيل |
| `last_error_code`, `last_error_message` | text nullable | خطأ آمن |
| `acknowledged_central_version` | bigint nullable | النسخة التي أكدها المركزي |
| `central_result_id` | uuid nullable | نتيجة المركزي |
| `committed_at`, `created_at`, `updated_at` | timestamptz NOT NULL | أزمنة محلية |
| `acknowledged_at` | timestamptz nullable | وقت ACK |

الفهارس: جزئي للحالات الجاهزة (`idx_sync_outbox_ready`)، حسب الكيان (`idx_sync_outbox_entity`)، وجزئي لتنظيف ACK (`idx_sync_outbox_retention`). التسلسل `sync_device_sequence` هو `bigint start 1 increment 1 no cycle`.

### `sync_operation_results`

يحفظ النتيجة المركزية الدائمة: UUID PK، `operation_id` UNIQUE، FK للجهاز والشركة والمستخدم، `device_sequence` UNIQUE مع الجهاز، هوية ونوع الكيان، hash الطلب، الحالة، النسخة والـpayload authoritative، بيانات conflict، والخطأ الآمن. الحالات المقيدة هي:

`PROCESSING`, `ACCEPTED`, `ALREADY_APPLIED`, `VALIDATION_REJECTED`, `PERMISSION_REJECTED`, `DEVICE_REVOKED`, `DEPENDENCY_PENDING`, `CONFLICT`, `CENTRAL_PROCESSING_FAILED`.

### `sync_change_feed`

`cursor_id bigserial` هو PK. يحتوي نطاق الشركة/الفرع/الوكيل، الكيان، UPSERT/DELETE، النسخة والـpayload authoritative، الجهاز المصدر، `tombstone boolean`، ووقت الإنشاء. الفهارس `(company_id,cursor_id)` و`(company_id,branch_id,cursor_id)`.

### `sync_conflicts`

UUID PK، `operation_id` UNIQUE، نطاق الجهاز/الشركة/الفرع، payload المحلي وأساسه، payload المركزي ونسخته، الفعل المقصود، كود/سبب التعارض، الحالة OPEN/RESOLVED/REJECTED، نوع وpayload الحل، المستخدم والحاشية والتوقيت. يوجد فهرس جزئي للتعارضات المفتوحة.

### `sync_deferred_actions`

UUID PK، `operation_id`، نطاق الشركة والفرع، هوية الكيان، نوع FINANCIAL/INVENTORY/CENTRAL_ACTION، حالة PENDING/PROCESSING/CONFIRMED/FAILED، payload، الخطأ الآمن، المحاولات والتوقيت. UNIQUE على `(operation_id,action_type)`.

### الأعمدة المضافة لكيانات الدفتر

أضيف إلى الجداول السبعة: `sync_version bigint default 0`، `sync_central_version bigint default 0`، `sync_origin_device_id uuid`، `sync_last_device_sequence bigint`. أضيف `row_sync_no` إلى `daily_ledger_rows` و`dispatch_sync_no` إلى `daily_ledger_dispatch_definitions` مع UNIQUE indexes جزئية عند عدم null.

### Triggers

- `sync_touch_updated_at`: تحديث `updated_at`.
- `sync_increment_entity_version`: يزيد النسخة عند الكتابة العادية، ولا يزيدها عند تطبيق authoritative pull محليًا.
- `sync_emit_central_change`: يكتب Change Feed على المركزي فقط، مع tombstone للحذف.
- `sync_enqueue_local_change`: يكتب Outbox على العقدة المحلية فقط، داخل transaction كتابة السجل نفسها.

لا توجد stored procedures مستقلة. دوال PostgreSQL ومصادر triggers كاملة موجودة في migration 112 وليست مخفية في الكود.

## 4. الحفظ المحلي والحدود الذرية

المسار الفعلي لكتابة الدفتر يمر عبر routes القائمة وخدماتها. عند `app.node_role=local` تعمل trigger الـOutbox ضمن transaction نفسها:

```text
BEGIN
  INSERT/UPDATE/DELETE business row
  trigger -> nextval(sync_device_sequence)
  trigger -> INSERT sync_outbox(PENDING, payload, hash, base version)
COMMIT
```

إذا فشلت كتابة Outbox أو حدث ROLLBACK لا يبقى business row ولا Outbox. الاختبار أثبت أيضًا أن Outbox مرئي داخل المعاملة قبل commit وأن rollback يزيل الاثنين.

الواجهة المحلية في Electron لم تعد تعتبر `navigator.onLine` شرطًا للحفظ/الحذف/النقل/توثيق الطباعة. IndexedDB بقي fallback لنسخة Browser/LAN القديمة فقط، وليس مصدر حقيقة لمسار Desktop المحلي.

## 5. Central Sync API

المسار الأساسي: `/api/v1/sync`، والتعريف في `server/src/routes/syncRoutes.ts`.

| Method | Route | الحماية | الوظيفة |
|---|---|---|---|
| GET | `/bootstrap-status` | عام محليًا | هل اكتمل snapshot والـgrant |
| GET | `/status` | `sync.status.read` | العدادات والحالة |
| POST | `/retry` | `sync.retry` | تشغيل محاولة فورية |
| POST | `/device-activate` | `shipments.write` | إصدار اعتماد مزامنة لجهاز موافق عليه |
| POST | `/push` | device token + `shipments.write` | رفع عمليات مرتبة |
| POST | `/pull` | device token + `shipments.read` | تغييرات بعد cursor |
| POST | `/snapshot` | device token + `shipments.read` | Scoped Snapshot |
| GET | `/conflicts` | `sync.conflicts.resolve` | تعارضات مفتوحة ضمن النطاق |
| POST | `/conflicts/:id/resolve` | `sync.conflicts.resolve` | KEEP_CENTRAL/APPLY_LOCAL/APPLY_EDITED |

المركزي يعيد التحقق في كل طلب من: token hash، حالة الجهاز، موافقته، الشركة، الفرع، المستخدم الحالي، صلاحياته الحالية، وDataScope. الفرع الفارغ لا يعني جميع الفروع.

### Push خطوة بخطوة

1. العامل يستعيد عمليات SENDING العالقة إلى RETRY.
2. يختار batch حسب `device_sequence`.
3. يرسل العملية مع operation/device/sequence/entity/payload/hash/base/schema/app version.
4. المركزي يبدأ transaction ويأخذ قفلًا على نتيجة العملية.
5. إن وجدت نتيجة مكتملة مطابقة يعيدها كـ`ALREADY_APPLIED` بعد إعادة التحقق من الجهاز.
6. إن استُخدم operation ID بهوية أو hash مختلف يرفضه.
7. يتحقق من allowlist، النطاق، dependency، والنسخة الأساسية.
8. يطبق business mutation واحدة.
9. triggers المركزية تحدث النسخة وتضيف change feed.
10. يحفظ نتيجة دائمة ثم commit.
11. المحلي يطبق payload authoritative ويحول العملية إلى ACKNOWLEDGED.
12. أخطاء الشبكة تعيد العملية بـexponential backoff مع jitter؛ فشل عملية لا يلغي نتائج العمليات المستقلة.

إذا فشل التنفيذ بعد بدء المعالجة، يُنفذ rollback لكتابة الأعمال ثم تُحفظ `CENTRAL_PROCESSING_FAILED` في transaction مستقلة كي لا تبقى النتيجة مجهولة.

### Pull وSnapshot

- Pull يستخدم `cursor_id` تصاعديًا وبحجم batch محدود.
- تغييرات scope غير المسموح لا تُعاد.
- عند وجود عملية محلية معلقة على السجل نفسه، لا يكتب Pull فوقها؛ ينشئ conflict.
- الحذف يُمثل Change Feed tombstone ويُطبق بحسب soft/hard delete المعرف للكيان.
- snapshot يعمل في `repeatable read read only` ويعيد cursor متوافقًا مع اللقطة.
- إعادة snapshot ممنوعة إذا كان هناك Outbox غير محسوم؛ وبعد الأمان يستبدل البيانات scoped ويزيل بيانات خارج النطاق.

## 6. التعارضات

التعارض ليس قيمة داخل `shipments.status`. له جدول مستقل وحالة مستقلة.

ينشأ التعارض عند اختلاف `local_base_version` عن النسخة المركزية، أو وصول Pull لسجل عليه عملية محلية معلقة. تحفظ النسختان والفعل المقصود. الحلول المنفذة:

- `KEEP_CENTRAL`: اعتماد المركزي وإغلاق التعارض.
- `APPLY_LOCAL`: تطبيق payload المحلي إداريًا وإصدار Change Feed جديد.
- `APPLY_EDITED`: تطبيق payload معدل يقدمه صاحب الصلاحية.

واجهة دفتر الشحن تعرض عدد التعارضات ضمن بطاقة المزامنة. شاشة مقارنة إدارية كاملة للحقول ليست منفذة؛ الحل متاح حاليًا عبر API المحمي.

## 7. الإجراءات المركزية المؤجلة

عند طلب «حفظ الشحنات» على العقدة المحلية:

1. تُحفظ عملية ACTION باسم `central_action.post_shipments` في Outbox.
2. يُحفظ صف `sync_deferred_actions` في transaction نفسها.
3. تظهر النتيجة للمستخدم «محفوظ محليًا وبانتظار المعالجة المركزية».
4. المركزي يأخذ advisory lock مرتبطًا بالعملية وينفذ خدمة الترحيل القائمة مركزيًا فقط.
5. ACK للعملية منفصل منطقيًا عن تأكيد آثار المالية/المخزون.

لم تُنقل معادلات مالية أو مخزنية إلى الجهاز المحلي. middleware `localOfflinePolicy` يرد `CENTRAL_ACTION_REQUIRED` على أي كتابة ليست في allowlist المحلية، برسالة عربية واضحة.

## 8. المصادقة والأمان والنطاق

- التهيئة تطلب كلمة مدير PostgreSQL محليًا لاختبار/create database فقط، ولا تضعها في المستودع.
- للتثبيت الجديد يُنشأ role خاص باسم جهاز وكلمة عشوائية 32 بايت، ويمتلك قاعدة `almiya_hsahin_offline`.
- الأسرار تحفظ بواسطة Electron `safeStorage`: كلمة مستخدم القاعدة المحلية، device ID/token، ومفتاح backup. كلمة المستخدم المركزية لا تحفظ.
- تتم ترقية الأسرار القديمة من env ثم إزالة `PGPASSWORD` وdevice token وbackup key من الملف القديم.
- يتم رفض `listen_addresses='*'`؛ المقبول loopback فقط.
- Express المحلي يستمع على `127.0.0.1`.
- الدخول المحلي يتطلب snapshot مهيأ وOffline Grant غير منتهٍ. الافتراضي 72 ساعة.
- snapshot ينزل المستخدم الحالي فقط ودوره وصلاحياته وفروعه. ينزل `password_hash` أحادي الاتجاه لتمكين التحقق المحلي؛ لا ينزل كلمة مرور صريحة.
- تعطيل الجهاز مركزيًا يوقف Push/Pull عند أول طلب تالٍ. البيانات المحلية غير المزامنة لا تحذف.
- حالة التوافق: إذا كانت قاعدة `almiya_hsahin_offline` موجودة مسبقًا، يستخدم التهيئة اعتماد postgres المُدخل بدل تدويرها تلقائيًا إلى role الجهاز. هذا workaround صريح للتثبيتات القديمة.

## 9. واجهة المستخدم

حُفظ تصميم React وRTL والبنية الحالية. التغييرات البصرية محصورة في:

- حقول التهيئة داخل modal الدخول الموجود: PostgreSQL المحلي، مستخدم المركزي، الفرع، وموافقة الجهاز.
- `ShippingSyncIndicator` صغير داخل شاشة `ShipmentQuickLedger` يعرض الاتصال، pending/sending/conflict، آخر نجاح، التقدم الحقيقي، وزر إعادة المحاولة.
- لا تصل النسبة إلى 100% إلا عندما لا توجد عمليات PENDING/SENDING/RETRY/CONFLICT/BLOCKED.
- فصل اتصال المركزي عن نجاح الحفظ المحلي؛ انقطاع الإنترنت لا يعطل إدخال الدفتر المحلي.

لم يُنفذ visual regression آلي أو مقارنة pixel، لذلك حفظ التصميم مؤكد بالمراجعة البنيوية والبناء فقط، لا بقياس بصري آلي.

## 10. PostgreSQL المحلي والتثبيت والتحديث والإزالة

- التطبيق يكتشف PostgreSQL CLI المثبت ويجرب تشغيل خدمة Windows عند توقفها.
- التهيئة تتحقق أن PostgreSQL لا يستمع خارج loopback.
- Local Backend المجمّع يعمل على `127.0.0.1:4010` ويمرر الأسرار من safeStorage إلى process environment فقط.
- migration runner ينشئ backup مشفرًا قبل migration محلية خطرة.
- `deleteAppDataOnUninstall=false`: uninstall/update لا يطلب حذف AppData تلقائيًا.
- `server/.env` غير موجود في `extraResources`، وفحص الحزمة يرفض وجود `app-config.env` أو السر المحظور.
- المثبت NSIS x64 مبني محليًا. لم يُثبت داخل VM نظيفة، ولم تُثبت صحة وجود PostgreSQL على جهاز لا يحتويه؛ المثبت الحالي لا يضم PostgreSQL installer نفسه.

## 11. النسخ الاحتياطي والاستعادة

المصدر: `server/src/db/localMigrationBackup.ts`, `server/src/db/localBackupRestore.ts`, `server/src/scripts/restoreOfflineBackup.ts`.

- `pg_dump -Fc` إلى ملف مؤقت.
- تشفير AES‑256‑GCM بصيغة تبدأ `ABOOERP1` وIV 12 بايت وauthentication tag.
- sidecar JSON يحفظ SHA‑256 والحجم والسبب واسم القاعدة دون المفتاح.
- المسار: `%APPDATA%\offline-backups`.
- جدولة كل 6 ساعات افتراضيًا والاحتفاظ بآخر 7 نسخ.
- قبل migration محلية ينفذ backup إضافي.
- الاستعادة تفك وتتحقق من GCM وSHA، تستعيد أولًا إلى قاعدة مؤقتة، تتحقق من `schema_migrations` و`sync_outbox`، ثم تبدل الاسم مع الاحتفاظ بالقاعدة السابقة.
- CLI يرفض العمل دون `--confirm-local-restore`، ويتطلب توقف الخادم و`SYNC_NODE_ROLE=local` والمفتاح.

اختُبرت دورة encrypt/decrypt/hash/`pg_restore --list` والاستعادة إلى قاعدة معزولة والتحقق من migrations وOutbox. لم يُنفذ swap النهائي على قاعدة جهاز عامل. نافذة الفقد عند تلف القرص بالكامل تصل افتراضيًا إلى 6 ساعات منذ آخر backup مجدول؛ أما crash عادي مع سلامة PostgreSQL فلا يفقد committed rows/outbox.

## 12. التسجيل والتشخيص

- سجل Electron runtime يسجل handshake وبدء الخادم وأخطاء bootstrap وحالة window/runtime smoke دون طباعة الأسرار.
- الخادم يسجل نجاح backup بالحجم وSHA فقط.
- Outbox يحتفظ بعدد المحاولات وآخر كود/رسالة خطأ آمنة.
- operation results تحفظ نتيجة replay الدائمة.
- conflicts تحفظ النسختين وقرار الحل.
- لا توجد بعد حزمة diagnostics export واحدة تجمع السجلات والحالة مع redaction؛ الموجود IPC diagnostics العام وسجلات التشغيل الحالية.

## 13. أدلة التنفيذ الفعلية

### فحص قاعدة العمل الحالية — قراءة فقط

الأمر `npm run server:migrate:status` أعاد:

```text
Applied: 112 / 114
Pending migrations:
  - 111_daily_ledger_dispatch_save_logs.sql
  - 112_offline_sync_foundation.sql
Vehicle trip report prerequisites: OK
```

المعنى: 112 ملف migration مطبق من أصل 114، لكن migration رقم 112 الخاصة بهذه المهمة **ليست مطبقة**. لم يتم تغيير هذه الحالة.

### Integration smoke المعزول

`npm run test:offline-sync-integration` نجح سابقًا في نفس دورة التنفيذ وأعاد:

```text
[OFFLINE-SYNC-SMOKE] {"accepted":"ACCEPTED","replay":"ALREADY_APPLIED","conflict":"CONFLICT","conflictResolution":"APPLY_LOCAL","dependency":"DEPENDENCY_PENDING","scope":"PERMISSION_REJECTED","durableFailure":"CENTRAL_PROCESSING_FAILED","concurrentDevices":["ACCEPTED","ACCEPTED"],"deferredAction":"ACCEPTED","deferredReplay":"ALREADY_APPLIED","localDeferredQueueAtomicity":"PASS","scopedSnapshot":"PASS","snapshotApplyAndPrune":"PASS","incrementalPull":5,"atomicOutboxRollback":"PASS","revoked":"DEVICE_REVOKED","feedCount":5}
[OFFLINE-BACKUP-SMOKE] {"encrypted":true,"integrityVerified":true,"pgRestoreListVerified":true,"restoredIntoIsolatedDatabase":true,"size":381437}
```

أنشأ الاختبار قاعدة باسم مقيد `almiya_sync_test_<timestamp>` وحذفها exact-match بعده. رسائل PostgreSQL الخاصة بـ`not-an-integer` متوقعة لأنها حالة فشل مركزي مقصودة لاختبار النتيجة الدائمة.

### Packaged runtime smoke

`npm run electron:smoke:packaged` شغّل executable من `dist-release-next\win-unpacked` أمام API وقاعدة معزولين، طبق جميع migrations حتى 112 داخل القاعدة المؤقتة فقط، ثم أعاد:

```json
{"status":"PASS","executable":"شركة عبو المحمود لنقل والخدمات الوجستية.exe","isolatedDatabase":"almiya_pkg_smoke_a35b4df4ca5c","serverHealth":200,"electronExitCode":0,"stdout":"","stderr":""}
```

حُذفت القاعدة المؤقتة بعد الاختبار.

### البناء والفحوص

| الأمر | النتيجة والقياس |
|---|---|
| `npm run server:check` | PASS، TypeScript بلا أخطاء |
| `npm run electron:compile` | PASS |
| `npm run test:daily-ledger-helpers` | PASS، 4 suites |
| `npm run test:daily-ledger-row-filter` | PASS |
| `npm run test:daily-ledger-access` | PASS |
| `npm run build` | PASS، 283 modules، 2.38s في آخر تشغيل؛ تحذير chunk size فقط |
| `RELEASE_DIR=dist-release-next npm run verify:release` | PASS؛ migration 112 موجودة، ولا ملف أسرار مطلوب |
| Central `/api/health` | HTTP 200 قراءة فقط |
| Central `/api/v1/auth/branches` | HTTP 200 قراءة فقط |

## 14. مصفوفة الاختبارات الإلزامية (35)

التصنيف: PASS = نُفذ بدليل؛ PARTIAL = غطى الكود/اختبار جزءًا؛ NOT RUN = لا يوجد ادعاء نجاح.

| # | الاختبار | الحالة | الدليل/الحد |
|---:|---|---|---|
| 1 | 100 سطر دون إنترنت | NOT RUN | الاختبار الحالي لا ينشئ 100 سطر عبر UI |
| 2 | إغلاق وفتح وبقاء الأسطر | NOT RUN | لا GUI persistence restart |
| 3 | إعادة تشغيل Windows | NOT RUN | يحتاج جهاز/VM |
| 4 | عودة الإنترنت ومزامنة الجميع | PARTIAL | Push/Pull معزول نجح، ليس 100 سطر/شبكة فعلية |
| 5 | فقد الرد بعد قبول المركزي | PASS | ACCEPTED ثم replay = ALREADY_APPLIED |
| 6 | عدم تكرار السجل | PASS | نفس operation لم يُنشئ سجلًا ثانيًا |
| 7 | الضغط المزدوج | PARTIAL | idempotency يحمي نفس operation؛ UI double-click غير مشغّل آليًا |
| 8 | جهازان ينشئان معًا | PASS | Promise.all وACCEPTED للجهازين |
| 9 | جهازان يعدلان السجل نفسه | PASS | CONFLICT محفوظ |
| 10 | تغيير مركزي مع حدث محلي | PASS | central change ثم conflict للجهاز الثاني |
| 11 | حفظ conflict في الجدول | PASS | listOpenSyncConflicts وجد السجل |
| 12 | حل إداري | PASS | APPLY_LOCAL وخروج payload authoritative |
| 13 | انقطاع وسط batch | PARTIAL | retry/backoff موجود؛ لا network fault injection وسط batch |
| 14 | crash أثناء SENDING | PARTIAL | recovery code موجود؛ لا process-kill test |
| 15 | استعادة العمليات العالقة | PARTIAL | worker يعيد SENDING؛ لا restart test فعلي |
| 16 | فشل عملية واستمرار المستقلات | PASS | durable failure ثم عمليات لاحقة ناجحة |
| 17 | تغيير ساعة Windows | PARTIAL | sequence/cursor غير معتمدين على الساعة؛ لا OS clock test |
| 18 | انتهاء Offline Authentication | PARTIAL | middleware/login ينفذان الرفض؛ لا E2E زمني |
| 19 | تعطيل الجهاز | PASS | DEVICE_REVOKED |
| 20 | سحب صلاحية فرع | PARTIAL | wrong-scope = PERMISSION_REJECTED؛ لا تعديل صلاحية حي |
| 21 | Snapshot scoped | PASS | الفرع الآخر غائب بعد apply/prune |
| 22 | Pull cursor | PASS | incrementalPull=5 |
| 23 | Tombstone | PARTIAL | DDL/trigger/apply موجودة؛ لا delete assertion مستقلة |
| 24 | تجاوز retention وResnapshot | PARTIAL | resnapshot path موجود؛ لا محاكاة مدة retention |
| 25 | فشل المالية بعد Business Sync | PARTIAL | deferred/result separation موجود؛ لا خدمة مالية فاشلة E2E |
| 26 | عدم إعادة إنشاء الشحنة | PASS | durable replay للإجراء المركزي |
| 27 | فشل Local Migration | PARTIAL | pre-migration backup موجود؛ لا migration فاشلة متعمدة |
| 28 | استعادة Backup | PASS | restoredIntoIsolatedDatabase=true |
| 29 | تحديث مع Outbox | NOT RUN | يحتاج installer upgrade فعلي |
| 30 | uninstall/update غير مكتمل | PARTIAL | AppData لا يحذف؛ لا إلغاء installer فعلي |
| 31 | لا 100% قبل ACK | PARTIAL | حساب الواجهة مضبوط؛ لا UI automation |
| 32 | عدد بطاقة المزامنة | PARTIAL | API/UI wiring؛ لا visual assertion |
| 33 | عدم تغير التصميم العام | PARTIAL | تعديل محدود وبناء ناجح؛ لا visual baseline |
| 34 | طباعة Offline | PARTIAL | routes والـIPC مسموحة وprinter callable؛ لا طباعة ورقية فعلية |
| 35 | منع الحساس Offline | PARTIAL | middleware allowlist ورسالة عربية؛ لا E2E لكل route |

المحصلة: 13 PASS، 18 PARTIAL، 4 NOT RUN. هذه الأرقام تمنع وصف المهمة كاعتماد إنتاج نهائي رغم اكتمال الجزء البرمجي الأساسي.

## 15. المثبت المحلي

- المسار: `C:\Users\Homsi\Desktop\almiya-hsahin\dist-release-next\شركة عبو المحمود لنقل والخدمات الوجستية Setup 1.0.1.exe`
- الحجم: `118,654,861` bytes (`113.16 MiB` تقريبًا).
- SHA‑256: `7AC97F3D2B1C0737AB8B80C0573033BC99EAC46BCE54936AB2695D16716C5D50`
- الهدف: NSIS Windows x64.
- حالة التوقيع الرقمي بشهادة موثوقة: غير مثبتة في هذا التحقيق؛ لا يوجد ادعاء بأن الملف signed.
- لم يُرفع المثبت إلى أي مكان.

## 16. الملفات المصدرية الجديدة والمعدلة

### قاعدة البيانات والمزامنة

- `server/src/db/migrations/112_offline_sync_foundation.sql`
- `server/src/sync/payloadHash.ts`
- `server/src/sync/localOutbox.ts`
- `server/src/sync/centralSyncService.ts`
- `server/src/sync/localSyncWorker.ts`
- `server/src/sync/centralDeferredActions.ts`
- `server/src/sync/localDeferredActions.ts`
- `server/src/routes/syncRoutes.ts`
- `server/src/middleware/localOfflinePolicy.ts`
- `server/src/app.ts`
- `server/src/index.ts`
- `server/src/config/env.ts`
- `server/src/db/pool.ts`
- `server/src/db/migrate.ts`
- `server/src/routes/authRoutes.ts`
- `server/src/routes/dailyLedgerRoutes.ts`

### Backup/Restore والاختبار

- `server/src/db/localMigrationBackup.ts`
- `server/src/db/localBackupRestore.ts`
- `server/src/scripts/restoreOfflineBackup.ts`
- `server/src/scripts/offlineSyncIntegrationSmoke.ts`
- `scripts/packagedRuntimeSmoke.mjs`

### Electron والتهيئة

- `electron/security/desktopSecrets.ts`
- `electron/ipc/desktopSetup.ts`
- `electron/localPostgres.ts`
- `electron/main.ts`
- `electron/preload.ts`
- `electron/preload.cjs`
- `electron/ipc/runtimeConfig.ts`
- `src/types/electron-runtime.d.ts`
- `config/runtime.json`

### الواجهة والحزمة

- `src/components/login/DeviceLoginBootstrap.tsx`
- `src/components/shipping/ShippingSyncIndicator.tsx`
- `src/pages/ShipmentQuickLedger.tsx`
- `src/lib/offline/useCloudConnectionStatus.ts`
- `src/pages/Login.tsx`
- `src/index.css`
- `package.json`
- `scripts/validatePackage.mjs`
- `scripts/verifyReleaseBundle.mjs`

مخرجات `dist`, `dist-electron`, `dist-server`, و`dist-release-next` أعيد توليدها. ملف `docs/SHIPPING_DATA_PERSISTENCE_AUDIT_2026-07-17.md` وملف التاسك الأصلي كانا untracked ومحفوظين دون حذف.

## 17. ما لم يُطبق أو يُنشر

- لا migration 111 ولا 112 على قاعدة العمل الحالية.
- لا migration أو deploy على قاعدة/خادم الإنتاج.
- لا تغيير في schema live.
- لا seed على قاعدة المستخدم.
- لا اختبار central sync endpoints على الدومين، لأن الكود الجديد غير منشور.
- لا اختبار installer clean install أو upgrade/uninstall على Windows 10/11 VM.
- لا اختبار جهازين ماديين ولا انقطاع شبكة حقيقي طويل.
- لا شاشة إدارة conflicts كاملة ولا diagnostics export package موحدة.
- لا تضمين مثبت PostgreSQL داخل NSIS؛ يعتمد الإعداد الحالي على PostgreSQL 16 المحلي الموجود.

## 18. نقاط واضحة تحتاج عدم إساءة تفسيرها

1. وجود installer ناجح لا يعني أن النظام جاهز للنشر المركزي؛ القاعدة المركزية ما زالت بلا migration 112.
2. نتيجة packaged smoke تثبت سلامة executable/IPC/handshake الأساسية، ولا تثبت رحلة مستخدم كاملة من التثبيت حتى 100 سطر Offline.
3. اختبارات قواعد البيانات كلها استخدمت أسماء معزولة وحذفتها؛ قاعدة العمل لم تُعدّل.
4. الـOutbox يمنع التكرار عند ثبات `operation_id`. طلب مختلف يحاول إعادة استخدام الهوية نفسها يُرفض ولا يُعامل replay.
5. ACK لمزامنة بيانات الشحن لا يساوي نجاح الأثر المالي المؤجل؛ الحالتان منفصلتان عمدًا.
6. retention الخاص بـChange Feed ليس job مكتملًا في هذا التنفيذ؛ مسار `resnapshot_required` موجود لكن سياسة الحذف الزمنية المركزية لم تُشغّل وتُقَس فعليًا.
7. بيانات المستخدم المحلية تشمل password hash للتحقق Offline. لا توجد كلمة مرور صريحة، لكن hash يظل مادة حساسة داخل قاعدة الجهاز.

هذا التقرير يوثق الحالة الفعلية في نهاية التحقيق، بما فيها النجاحات والحدود، ولا يمنح اعتماد إنتاج لمراحل لم تُنفذ.
