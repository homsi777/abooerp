# تدقيق شامل لاستمرارية بيانات وحدة الشحن

**نوع الوثيقة:** توثيق/تدقيق للحالة الحالية فقط  
**تاريخ لقطة الأدلة:** 2026-07-17 (Asia/Damascus)  
**النطاق:** إنشاء الشحنة، دفتر الشحن اليومي، التتبع والحالات، المناقلات، المنافيست، الاستلام المركزي، التسليم، المخزون المرتبط، الآثار المالية، الطباعة، الصلاحيات والنطاق الجغرافي  
**قاعدة البيانات المفحوصة:** PostgreSQL 16.13، قاعدة `almiya_hsahin` على `127.0.0.1:5432`  
**طريقة الفحص:** قراءة كتالوج PostgreSQL الحي (`information_schema`, `pg_catalog`)، قراءة `schema_migrations`، ومطابقة النتيجة مع المسارات والخدمات والمستودعات والترحيلات وطبقة IndexedDB في المستودع. لم تُنفّذ أي كتابة على قاعدة البيانات أو تعديل على كود التطبيق.

> هذه الوثيقة لا تحتوي حلولاً أو تصميم مزامنة أو توصيات. كل موضع غير محسوم أو غير متسق موسوم صراحةً بـ **[غير واضح]** أو **[عدم اتساق مثبت]** أو **[حل التفافي قائم]**.

## 1. خلاصة الحقائق المثبتة

- قاعدة البيانات الحية تحتوي 69 جدولاً عاماً؛ الجداول الداخلة مباشرة أو تبعياً في مسار الشحن موثقة أدناه بلا حذف للحقول.
- يوجد 133 صفاً في `shipments` و260 صفاً في `shipment_status_history` و172 صفاً في `daily_ledger_rows` ضمن اللقطة الحية.
- جميع المفاتيح الأساسية المفردة في نطاق الشحن من نوع UUID ويولدها PostgreSQL بواسطة `gen_random_uuid()`؛ لا توجد identity columns أو computed columns أو sequences مخصصة لأرقام الشحن/الإيصال/المنافيست/التسليم.
- `shipment_no` إلزامي وفريد عالمياً في الجدول، وليس فريداً ضمن الشركة فقط. الرقم يولد في بعض الواجهات بـ `SHP-${Date.now()}`، ويُمرر رقم إيصال الدفتر كما هو عند ترحيله إلى شحنة، ويُدخل صراحة في بوابة الوكيل. لا يوجد trigger أو sequence يولده.
- لا يوجد أي trigger على الجداول الداخلة في النطاق، ولا توجد stored procedures/functions تطبيقية. الدوال العامة الظاهرة في المخطط هي دوال امتداد `pgcrypto` فقط.
- عمليات الشحنة الأساسية تستخدم معاملات في الإنشاء، تغيير الحالة، والتأكيد المالي، لكن حجز المخزون وربط الحوالة وبعض عمليات الترحيل المالي تحدث في معاملات لاحقة منفصلة؛ حدودها الدقيقة موثقة في القسم 6.
- القفل المتشائم `SELECT ... FOR UPDATE` موجود في تغيير حالة الشحنة، التأكيد المالي، المناقلة بين جلسات الدفتر، وبعض الترحيلات المالية. القفل التفاؤلي موجود بصورة جزئية بواسطة `expectedUpdatedAt` في تعديل الشحنة وبعض عمليات المستودع، لكنه ليس مطلوباً في كل الاستدعاءات.
- توجد طبقة IndexedDB محلية لصفوف دفتر الشحن فقط باسم قاعدة `abooerp_offline`، الإصدار 1، وليست مخزناً محلياً كاملاً للشحنات أو الحالات أو الكيانات التابعة.
- ترحيل `111_daily_ledger_dispatch_save_logs.sql` موجود في الكود، ومسارات `/daily-ledger/dispatch-saves` تستعلم من جدوله، لكن الترحيل 111 غير مسجل كتطبيق في `schema_migrations` والجدول غير موجود في قاعدة البيانات الحية. **[عدم اتساق مثبت]** هذه المسارات ستصل إلى جدول غير موجود في الحالة الحالية.
- لا توجد RLS policies في PostgreSQL لعزل الشركات/الفروع/الوكلاء؛ العزل منفذ في التطبيق بواسطة `DataScope` وشروط SQL. بعض الأدوار المسماة فرعية مصنفة في الكود كنطاق على مستوى الشركة، موضح في القسم 10.

## 2. جرد الجداول والحجم الحالي

الأعداد التالية ناتجة عن `count(*)` مباشر في 2026-07-17؛ وهي لقطة وليست معدل تشغيل.

| المجموعة | الجدول | الغرض | الصفوف |
|---|---|---|---:|
| جوهر الشحنة | `shipments` | السجل الرئيسي للشحنة والقيم المالية والحالة الحالية | 133 |
| جوهر الشحنة | `shipment_status_history` | تاريخ تغيرات الحالة وبياناتها الوصفية | 260 |
| جوهر الشحنة | `shipment_labels` | طلب/نتيجة طباعة ملصق الشحنة | 0 |
| المخزون | `shipment_inventory_movements` | حجز/تحرير/خصم مخزون مرتبط بالشحنة | 0 |
| الدفتر | `daily_ledger_sessions` | جلسة دفتر حسب الشركة/الفرع/التاريخ/الخط/السائق | 4 |
| الدفتر | `daily_ledger_rows` | أسطر الإيصالات التي تتحول إلى شحنات | 172 |
| الدفتر | `daily_ledger_dispatch_definitions` | تعريف إرساليات/رحلات الدفتر | 0 |
| الدفتر | `daily_ledger_print_events` | أحداث طباعة جلسات الدفتر | 0 |
| الدفتر | `daily_ledger_print_documents` | snapshot JSON لمستندات طباعة الدفتر | 0 |
| الدفتر | `daily_ledger_row_transfers` | رأس عملية نقل أسطر بين الجلسات | 0 |
| الدفتر | `daily_ledger_row_transfer_items` | تفاصيل الأسطر داخل عملية النقل | 0 |
| عمليات لاحقة | `manifests` | رأس المنافيست | 0 |
| عمليات لاحقة | `manifest_shipments` | ربط N:N بين المنافيست والشحنات | 0 |
| عمليات لاحقة | `center_receipts` | إثبات الاستلام في المركز | 0 |
| عمليات لاحقة | `deliveries` | محاولة/عملية التسليم | 0 |
| حوالات | `transfers` | حوالة مرتبطة اختيارياً بالشحنة وتحصيلها/دفعها | 5 |
| مالية | `party_financial_movements` | قيود أطراف ناتجة عن الشحنة/الحوالة/السند | 140 |
| مالية | `cashbox_transactions` | حركة صندوق ناتجة عن سندات الشحنة/التسليم | 0 |
| مالية | `receipt_vouchers` | سند قبض مرتبط اختيارياً بالشحنة/التسليم/الحوالة | 0 |
| مالية | `payment_vouchers` | سند دفع مرتبط اختيارياً بالشحنة/التسليم/الحوالة | 0 |
| تحكم | `idempotency_keys` | مفاتيح منع تكرار طلبات HTTP | 826 |
| تدقيق | `audit_logs` | سجل نشاط وتغييرات وفشل عمليات الشحن | 954 |
| نطاق ومرجع | `companies` / `branches` / `agents` | الشركة والفروع والوكلاء والموقع | 1 / 16 / 19 |
| أمن | `users` / `roles` / `permissions` | المستخدمون والأدوار والصلاحيات | 4 / 14 / 125 |
| أمن | `role_permissions` / `user_branches` | ربط الأدوار بالصلاحيات والمستخدمين بالفروع | 573 / 21 |
| أطراف | `senders_receivers` / `customers` | مرسل/مستلم وعميل حساب | 218 / 0 |
| مراجع | `currencies` / `goods_types` / `cities` / `tariffs` | العملة ونوع البضاعة والمدن والتعرفة | 6 / 98 / 26 / 0 |
| أسطول | `drivers` / `vehicles` | السائقون والمركبات | 1 / 1 |
| مخزون | `items` / `item_stock` / `warehouses` | الصنف والرصيد والمستودع | 0 / 0 / 0 |
| صناديق | `cashboxes` | الصناديق المستخدمة في التحصيل والدفع | 18 |
| غير مطبق | `daily_ledger_dispatch_save_logs` | سجل حفظ الإرسالية حسب migration 111 | **غير موجود حياً** |

## 3. مخطط العلاقات

```text
companies 1 ──< branches 1 ──< shipments >── 1 senders_receivers (sender_id)
    │              │             │  └──────> 1 senders_receivers (receiver_id)
    │              │             ├─────────> 0..1 customers
    │              │             ├─────────> 0..1 agents
    │              │             ├──< shipment_status_history
    │              │             ├──< shipment_labels
    │              │             ├──< shipment_inventory_movements >── items
    │              │             │                                  └── warehouses
    │              │             ├──< deliveries (حد أقصى سجل فعال واحد)
    │              │             ├──< center_receipts (حد أقصى سجل فعال واحد)
    │              │             ├──< transfers
    │              │             ├──< party_financial_movements
    │              │             ├──< receipt_vouchers / payment_vouchers
    │              │             └──< cashbox_transactions
    │              │
    │              └──< daily_ledger_sessions 1 ──< daily_ledger_rows
    │                         │                         │
    │                         │                         ├── 0..1 posted shipment
    │                         │                         ├── 0..1 loaded manifest
    │                         │                         └── 0..1 dispatch definition
    │                         ├──< daily_ledger_print_events
    │                         └──< daily_ledger_row_transfers >── daily_ledger_row_transfer_items
    │
    └──< manifests >──< manifest_shipments >── shipments   (N:N)

roles >──< role_permissions >── permissions
users 1 ──< user_branches >── branches
users ──> role; users ──> optional branch/agent; all shipping writes carry application DataScope
```

العلاقات المسماة `financial_responsibility_id` و`related_entity_id` و`reference_id` متعددة الأشكال ولا يفرضها FK واحد. كذلك `shipments.collection_cashbox_id` و`shipment_labels.printer_id/template_id` لا تحمل FK حياً. **[عدم اتساق/مرونة مثبتة]** سلامة هذه الروابط تعتمد على التطبيق.

## 4. قاموس المخطط الحي الكامل

الترميز: `NN` = NOT NULL، `NULL` = يقبل null، والقيمة بعد `=` هي default. المعنى التجاري ملازم لاسم الحقل؛ أضيف تفسير عند الحقول غير البديهية. جميع `id` المفردة UUID PK افتراضياً `gen_random_uuid()` ما لم يذكر غير ذلك.

### 4.1 الشحنة والكيانات المباشرة

#### `shipments`

| الحقل | النوع/الإلزام/default | المعنى |
|---|---|---|
| `id` | uuid NN = `gen_random_uuid()` | هوية الشحنة |
| `shipment_no` | text NN | الرقم التشغيلي/رقم التتبع؛ UNIQUE عالمي |
| `reference_no` | text NULL | مرجع خارجي اختياري |
| `customer_id` | uuid NULL | عميل حساب اختياري |
| `sender_id`, `receiver_id` | uuid NN | طرفا الإرسال والاستلام |
| `branch_id` | uuid NN | فرع تسجيل الشحنة |
| `agent_id` | uuid NULL | وكيل الوجهة/المسؤول |
| `origin_city` | text NULL | منشأ نصي، ليس FK إلى `cities` |
| `destination_city` | text NN | وجهة نصية، ليست FK إلى `cities` |
| `description` | text NULL | وصف المحتوى/الملاحظات |
| `pieces_count` | integer NN = 1 | عدد القطع |
| `weight_kg` | numeric(12,2) NULL | الوزن بالكيلوغرام |
| `status` | text NN = `'created'` | الحالة الحالية؛ يقبل canonical وlegacy وفق CHECK |
| `original_amount` | numeric(14,2) NN = 0 | المبلغ بعملته الأصلية |
| `original_currency` | text NN | رمز العملة؛ FK إلى `currencies(code)` |
| `exchange_rate_to_usd` | numeric(18,8) NN | معامل التحويل إلى USD |
| `base_amount_usd` | numeric(14,2) NN = 0 | القيمة الأساسية بالدولار |
| `created_by`, `updated_by` | uuid NULL | المستخدم المنشئ/المعدل |
| `created_at`, `updated_at` | timestamptz NN = `now()` | أزمنة التدقيق |
| `company_id` | uuid NN | عزل الشركة |
| `deleted_at` | timestamptz NULL | حذف منطقي |
| `financial_status` | text NN = `'UNPOSTED'` | حالة الترحيل المالي |
| `financial_posted_at` | timestamptz NULL | وقت الترحيل المالي |
| `financial_posted_by_user_id` | uuid NULL | منفذ الترحيل |
| `payer_party_kind` | text NULL | نوع الدافع: مرسل/مستلم/وكيل/عميل |
| `payer_name_snapshot` | text NULL | لقطة اسم الدافع |
| `payment_status` | text NULL | UNPAID/PARTIAL/PAID |
| `paid_amount` | numeric(14,2) NN = 0 | المدفوع |
| `remaining_amount` | numeric(14,2) NULL | المتبقي |
| `default_cashbox_id` | uuid NULL | الصندوق الافتراضي؛ FK |
| `financial_notes` | text NULL | ملاحظات مالية |
| `financial_responsibility_type` | text NULL | نوع المسؤول المالي |
| `financial_responsibility_id` | uuid NULL | معرف متعدد الأشكال بلا FK |
| `collection_owner_type` | text NULL | مالك التحصيل |
| `collection_cashbox_id` | uuid NULL | صندوق التحصيل بلا FK حي |
| `freight_charge`, `transfer_fee`, `additional_charges` | numeric(14,2) NN = 0 | أجرة الشحن/التحويل/الإضافات |
| `prepaid_amount`, `discount_amount` | numeric(14,2) NN = 0 | المدفوع مسبقاً/الحسم |
| `loaded_pieces_count` | integer NN = 0 | عدد القطع المحملة |
| `agent_commission_base_type` | text NULL | أساس العمولة snapshot |
| `agent_commission_base_amount` | numeric(14,2) NULL | مبلغ أساس العمولة snapshot |
| `agent_commission_percentage_snapshot` | numeric(5,2) NULL | نسبة الوكيل وقت الإنشاء/التعديل |
| `agent_commission_amount_snapshot` | numeric(14,2) NULL | قيمة العمولة المحسوبة |
| `transfer_service_fee`, `hawala_amount` | numeric(14,2) NN = 0 | أجرة خدمة الحوالة وأصل الحوالة |
| `effective_date` | date NULL | التاريخ التشغيلي/المحاسبي الفعال |

#### `shipment_status_history`

`id` uuid NN؛ `shipment_id` uuid NN؛ `status` text NN (الحالة المسجلة)؛ `note` text NULL؛ `changed_by` uuid NULL؛ `changed_at` timestamptz NN=`now()`؛ `previous_status` text NULL؛ `next_status` text NULL؛ `source` text NULL؛ `metadata` jsonb NN=`{}`. الحذف من `shipments` يتسلسل إلى التاريخ.

#### `shipment_labels`

`id` uuid NN؛ `shipment_id` uuid NULL؛ `printer_id` uuid NULL؛ `template_id` uuid NULL؛ `copies` integer NN=1؛ `print_status` text NN=`queued`؛ `printed_at` timestamptz NULL؛ `company_id` uuid NN؛ `created_at` timestamptz NN=`now()`. لا يخزن الملف المطبوع أو الصورة.

#### `shipment_inventory_movements`

`id` uuid NN؛ `company_id` uuid NN؛ `shipment_id` uuid NULL؛ `item_id` uuid NN؛ `warehouse_id` uuid NN؛ `quantity` numeric(14,4) NN؛ `movement_type` text NN (`reserved/released/deducted`)؛ `notes` text NULL؛ `created_by` uuid NULL؛ `created_at` timestamptz NN=`now()`.

### 4.2 دفتر الشحن اليومي

#### `daily_ledger_sessions`

`id` uuid NN؛ `company_id` uuid NN؛ `branch_id` uuid NN؛ `ledger_date` date NN؛ `line_label` text NN=`''`؛ `origin_label` text NN=`''`؛ `trip_no` text NULL؛ `vehicle_label` text NULL؛ `driver_label` text NULL؛ `created_by/updated_by` uuid NULL؛ `created_at/updated_at` timestamptz NN=`now()`؛ `deleted_at` timestamptz NULL؛ `driver_id/vehicle_id` uuid NULL؛ `printed_at` timestamptz NULL؛ `printed_by` uuid NULL؛ `print_count` integer NN=0؛ `last_printed_at` timestamptz NULL؛ `reprint_required` boolean NN=false؛ `reprint_reason` text NULL.

#### `daily_ledger_rows`

`id` uuid NN؛ `session_id` uuid NN؛ `row_no` integer NN؛ `receipt_no` text NULL؛ `destination` text NN=`''`؛ `parcel_type` text NN=`''`؛ `parcel_count` integer NULL؛ `weight_kg` numeric(12,2) NULL؛ `sender_name/receiver_name` text NN=`''`؛ `collect_amount_usd/prepaid_amount_usd/hawala_amount_usd/fees_amount_usd` numeric(14,2) NN=0؛ `notes` text NULL؛ `posted_shipment_id` uuid NULL؛ `posted_at` timestamptz NULL؛ `loaded_manifest_id` uuid NULL؛ `loaded_at` timestamptz NULL؛ `created_by/updated_by` uuid NULL؛ `created_at/updated_at` timestamptz NN=`now()`؛ `deleted_at` timestamptz NULL؛ `transfer_service_fee_usd` numeric(14,2) NN=0؛ `original_session_id` uuid NULL؛ `last_transfer_id` uuid NULL؛ `transfer_status` text NULL؛ `dispatch_id` uuid NULL.

#### `daily_ledger_dispatch_definitions`

`id` uuid NN؛ `company_id/branch_id` uuid NN؛ `ledger_date` date NN؛ `line_label` text NN=`''`؛ `dispatch_no` integer NN؛ `driver_id/vehicle_id` uuid NULL؛ `driver_label/vehicle_label/trip_no/notes` text NULL؛ `created_by/updated_by` uuid NULL؛ `created_at/updated_at` timestamptz NN=`now()`؛ `deleted_at` timestamptz NULL.

#### `daily_ledger_print_events`

`id` uuid NN؛ `company_id` uuid NN؛ `session_id` uuid NULL؛ `print_type` text NN=`session`؛ `print_scope` text NULL؛ `row_count/pieces_count` integer NN=0؛ `weight_kg` numeric(14,2) NN=0؛ `printed_by` uuid NULL؛ `printed_at/created_at` timestamptz NN=`now()`.

#### `daily_ledger_print_documents`

`id` uuid NN؛ `company_id` uuid NN؛ `branch_id` uuid NULL؛ `ledger_date` date NN؛ `ledger_date_to` date NULL؛ `line_label/origin_label` text NULL؛ `driver_id` uuid NULL؛ `driver_label/destination_label/search_query` text NULL؛ `print_type` text NN=`shipments`؛ `print_scope/title` text NULL؛ `row_count/pieces_count` integer NN=0؛ `weight_kg`, `collect_total_usd`, `prepaid_total_usd`, `hawala_total_usd`, `transfer_fee_total_usd` numeric(14,2) NN=0؛ `rows_snapshot` jsonb NN=`[]`؛ `printed_by` uuid NULL؛ `printed_at/created_at` timestamptz NN=`now()`.

#### `daily_ledger_row_transfers`

`id` uuid NN؛ `company_id` uuid NN؛ `transfer_no` text NN؛ `source_session_id` uuid NULL؛ `target_session_id` uuid NN؛ `old_driver_id/new_driver_id/old_vehicle_id/new_vehicle_id` uuid NULL؛ `old_ledger_date/new_ledger_date` date NULL؛ `reason` text NULL؛ `rows_count/pieces_count` integer NN=0؛ `weight_kg` numeric(14,2) NN=0؛ `status` text NN=`completed`؛ `transferred_by` uuid NULL؛ `transferred_at/created_at` timestamptz NN=`now()`.

#### `daily_ledger_row_transfer_items`

`id` uuid NN؛ `transfer_id` uuid NN؛ `row_id` uuid NN؛ `shipment_id` uuid NULL؛ `receipt_no` text NULL؛ `source_session_id/target_session_id` uuid NULL؛ `weight_kg` numeric(14,2) NULL؛ `pieces_count` integer NULL؛ `financial_posted` boolean NN=false؛ `created_at` timestamptz NN=`now()`.

### 4.3 العمليات اللاحقة والمالية

#### `manifests`

`id` uuid NN؛ `manifest_no` text NN؛ `branch_id` uuid NN؛ `vehicle_id/driver_id` uuid NULL؛ `status` text NN=`created`؛ `created_by` uuid NULL؛ `created_at/updated_at` timestamptz NN=`now()`؛ `company_id` uuid NN؛ `deleted_at` timestamptz NULL.

#### `manifest_shipments`

`manifest_id` uuid NN + `shipment_id` uuid NN هما PK مركب؛ `created_at` timestamptz NN=`now()`.

#### `center_receipts`

`id` uuid NN؛ `company_id` uuid **NULL**؛ `shipment_id` uuid NN؛ `branch_id/agent_id` uuid NULL؛ `center_name` text NN؛ `status` text NN=`received`؛ `received_by_user_id` uuid NULL؛ `received_at` timestamptz NN=`now()`؛ `notes` text NULL؛ `created_at/updated_at` timestamptz NN=`now()`؛ `deleted_at` timestamptz NULL. كون `company_id` nullable مختلف عن أغلب جداول النطاق. **[عدم اتساق مثبت]**

#### `deliveries`

`id` uuid NN؛ `delivery_no` text NN؛ `shipment_id` uuid NN؛ `branch_id/agent_id/operator_user_id` uuid NULL؛ `status` text NN=`pending`؛ `recipient_name` text NULL؛ `received_at` timestamptz NULL؛ `notes` text NULL؛ `original_amount` numeric(14,2) NN=0؛ `original_currency` text NN؛ `exchange_rate_to_usd` numeric(18,8) NN؛ `base_amount_usd` numeric(14,2) NN=0؛ `created_at/updated_at` timestamptz NN=`now()`؛ `company_id` uuid NN؛ `deleted_at` timestamptz NULL.

#### `transfers`

`id` uuid NN؛ `company_id` uuid NN؛ `branch_id/agent_id/shipment_id` uuid NULL؛ `sender_name/receiver_name` varchar(255) NN؛ `amount` numeric(14,2) NN؛ `currency` varchar(10) NN=`USD`؛ `main_amount` numeric(14,2) NN=0؛ `commission` numeric(14,2) NN=0؛ `commission_currency` varchar(10) NN=`USD`؛ `commission_main` numeric(14,2) NN=0؛ `status` varchar(50) NN=`PENDING`؛ `transfer_date` timestamptz NULL=`now()`؛ `notes` text NULL؛ `created_at/updated_at` timestamptz NULL=`now()`؛ `agent_commission` numeric(14,2) NN=0؛ `agent_commission_currency` varchar(10) NN=`USD`؛ `agent_commission_main` numeric(14,2) NN=0؛ `transfer_service_fee` numeric(14,2) NN=0؛ `transfer_service_fee_currency` varchar(10) NN=`USD`؛ `transfer_service_fee_main` numeric(14,2) NN=0؛ `company_transfer_profit` numeric(14,2) NN=0؛ `company_transfer_profit_currency` varchar(10) NN=`USD`؛ `company_transfer_profit_main` numeric(14,2) NN=0؛ `posted_cashbox_id/receipt_voucher_id` uuid NULL؛ `posted_at` timestamptz NULL؛ `posted_by_user_id` uuid NULL؛ `cancelled_at` timestamptz NULL؛ `cancelled_by_user_id` uuid NULL؛ `cancellation_reason/destination_city` text NULL؛ `origin_agent_id/destination_agent_id/collection_cashbox_id/collection_receipt_voucher_id/payout_cashbox_id/payout_payment_voucher_id` uuid NULL؛ `collected_at/paid_out_at` timestamptz NULL.

#### `party_financial_movements`

`id` uuid NN؛ `party_type` text NN؛ `party_id` uuid NN؛ `movement_type` text NN؛ `voucher_type` text NULL؛ `voucher_id/shipment_id/delivery_id/branch_id/agent_id` uuid NULL؛ `direction` text NN؛ `notes` text NULL؛ `original_amount` numeric(14,2) NN=0؛ `original_currency` text NN؛ `exchange_rate_to_usd` numeric(18,8) NN؛ `base_amount_usd` numeric(14,2) NN=0؛ `created_by_user_id` uuid NULL؛ `created_at` timestamptz NN=`now()`؛ `is_reversal` boolean NN=false؛ `reversal_of_movement_id` uuid NULL؛ `reference_type` text NULL؛ `reference_id` uuid NULL؛ `reference_no` text NULL؛ `debit_amount/credit_amount` numeric(14,2) NN=0؛ `currency_code` text NULL؛ `exchange_rate` numeric(18,8) NULL؛ `cashbox_id` uuid NULL؛ `payment_method` text NULL؛ `posted_at` timestamptz NULL؛ `reverse_reason` text NULL؛ `metadata` jsonb NULL.

#### `cashbox_transactions`

`id` uuid NN؛ `transaction_type` text NN؛ `source_voucher_type` text NN؛ `source_voucher_id` uuid NN؛ `branch_id/agent_id/shipment_id/delivery_id` uuid NULL؛ `notes` text NULL؛ `original_amount` numeric(14,2) NN=0؛ `original_currency` text NN؛ `exchange_rate_to_usd` numeric(18,8) NN؛ `base_amount_usd` numeric(14,2) NN=0؛ `created_by_user_id` uuid NULL؛ `created_at` timestamptz NN=`now()`؛ `is_reversal` boolean NN=false؛ `reversal_of_cashbox_transaction_id` uuid NULL؛ `company_id` uuid NN؛ `cashbox_id` uuid NULL.

#### `receipt_vouchers` و`payment_vouchers`

لكل منهما الحقول نفسها: `id` uuid NN؛ `voucher_no` text NN؛ `branch_id/agent_id/shipment_id/delivery_id/customer_id/sender_receiver_id` uuid NULL؛ `related_entity_type` text NULL؛ `related_entity_id` uuid NULL؛ `status` text NN=`draft`؛ `notes` text NULL؛ `original_amount` numeric(14,2) NN=0؛ `original_currency` text NN؛ `exchange_rate_to_usd` numeric(18,8) NN؛ `base_amount_usd` numeric(14,2) NN=0؛ `created_by_user_id` uuid NULL؛ `created_at/updated_at` timestamptz NN=`now()`؛ `company_id` uuid NN؛ `cashbox_id` uuid NULL. يضاف في `receipt_vouchers` قيد UNIQUE على `delivery_id`.

### 4.4 التحكم والتدقيق والمراجع

- `idempotency_keys`: `id` uuid NN؛ `company_id/user_id` uuid NULL؛ `route_key` text NN؛ `idempotency_key` text NN؛ `status` text NN=`processing`؛ `created_at/updated_at` timestamptz NN=`now()`.
- `audit_logs`: `id` uuid NN؛ `company_id` uuid NN؛ `branch_id/user_id` uuid NULL؛ `action/entity_type` text NN؛ `entity_id` uuid NULL؛ `metadata` jsonb NN=`{}`؛ `ip_address/user_agent` text NULL؛ `created_at` timestamptz NN=`now()`.
- `companies`: `id` uuid NN؛ `code/name` text NN؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`؛ `phone/address/logo_data_url` text NULL.
- `branches`: `id` uuid NN؛ `code/name` text NN؛ `city/address/phone` text NULL؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`؛ `company_id` uuid NN.
- `agents`: `id` uuid NN؛ `code/name` text NN؛ `governorate/phone` text NULL؛ `branch_id` uuid NULL؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`؛ `telegram_chat_id/city/area/address/notes` text NULL؛ `commission_percentage` numeric(5,2) NN=0.
- `users`: `id` uuid NN؛ `username/full_name` text NN؛ `email/phone` text NULL؛ `password_hash` text NN؛ `role_id` uuid NN؛ `branch_id/agent_id` uuid NULL؛ `status` text NN=`active`؛ `created_at/updated_at` timestamptz NN=`now()`؛ `role` text NN؛ `company_id` uuid NN؛ `is_active` boolean NN=true؛ `user_type` text NN=`employee`؛ `last_login_at` timestamptz NULL.
- `roles`: `id` uuid NN؛ `code/name` text NN؛ `description` text NULL؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`؛ `company_id` uuid NULL؛ `is_system` boolean NN=false.
- `permissions`: `id` uuid NN؛ `code/name/module/action` text NN؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`.
- `role_permissions`: `role_id/permission_id` uuid NN وهما PK مركب؛ `created_at` timestamptz NN=`now()`؛ `id` uuid NN=`gen_random_uuid()` UNIQUE؛ `permission_code` text NULL.
- `user_branches`: `id` uuid NN؛ `user_id/branch_id` uuid NN؛ `created_at` timestamptz NN=`now()`.
- `senders_receivers`: `id` uuid NN؛ `code/full_name` text NN؛ `phone/city/address` text NULL؛ `type` text NN؛ `status` text NN=`active`؛ `created_at/updated_at` timestamptz NN=`now()`؛ `branch_id/agent_id/created_by_user_id` uuid NULL.
- `customers`: `id` uuid NN؛ `code/name` text NN؛ `phone/city/address` text NULL؛ `branch_id` uuid NULL؛ `status` text NN=`active`؛ `created_at/updated_at` timestamptz NN=`now()`؛ `company_id/agent_id` uuid NULL؛ `customer_type` text NN=`INDIVIDUAL`؛ `is_account_customer` boolean NN=false؛ `credit_limit` numeric(14,2) NN=0؛ `default_currency_code` text NN=`SYP`؛ `second_phone/company_name/area/tax_number/notes` text NULL؛ `created_by_user_id` uuid NULL؛ `opening_balance_amount` numeric(14,2) NN=0؛ `opening_balance_side` text NN=`debit`.
- `currencies`: `id` uuid NN؛ `code/name` text NN؛ `symbol` text NULL؛ `decimal_places` integer NN=2؛ `is_base` boolean NN=false؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`؛ `company_id` uuid NN.
- `goods_types`: `id` uuid NN؛ `code/name` text NN؛ `description` text NULL؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`.
- `cities`: `id` uuid NN؛ `code/name` text NN؛ `region` text NULL؛ `has_branch` boolean NN=false؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`.
- `tariffs`: `id` uuid NN؛ `code` text NN؛ `from_city_id/to_city_id` uuid NN؛ `goods_type_id` uuid NULL؛ `price_per_kg/minimum_charge` numeric(14,2) NN=0؛ `valid_from` date NN؛ `valid_to` date NULL؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`.
- `drivers`: `id` uuid NN؛ `code/full_name` text NN؛ `phone/license_number` text NULL؛ `branch_id` uuid NULL؛ `status` text NN=`active`؛ `created_at/updated_at` timestamptz NN=`now()`؛ `agent_id` uuid NULL.
- `vehicles`: `id` uuid NN؛ `code/plate_number` text NN؛ `model` text NULL؛ `capacity_kg` numeric(12,2) NULL؛ `branch_id` uuid NULL؛ `status` text NN=`active`؛ `created_at/updated_at` timestamptz NN=`now()`؛ `agent_id/driver_id` uuid NULL.
- `items`: `id` uuid NN؛ `company_id` uuid NN؛ `code/name` text NN؛ `description` text NULL؛ `unit` text NN=`piece`؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`؛ `deleted_at` timestamptz NULL.
- `item_stock`: `id` uuid NN؛ `company_id/warehouse_id/item_id` uuid NN؛ `quantity_on_hand/quantity_reserved` numeric(14,4) NN=0؛ `updated_at` timestamptz NN=`now()`.
- `warehouses`: `id` uuid NN؛ `company_id` uuid NN؛ `branch_id` uuid NULL؛ `code/name` text NN؛ `address` text NULL؛ `is_active` boolean NN=true؛ `created_at/updated_at` timestamptz NN=`now()`؛ `deleted_at` timestamptz NULL.
- `cashboxes`: `id` uuid NN؛ `company_id` uuid NN؛ `branch_id/agent_id` uuid NULL؛ `code/name/type/currency_code` text NN؛ `opening_balance/current_balance` numeric(14,2) NN=0؛ `is_active` boolean NN=true؛ `notes` text NULL؛ `created_by_user_id` uuid NULL؛ `created_at/updated_at` timestamptz NN=`now()`؛ `parent_cashbox_id` uuid NULL.

### 4.5 DDL الفعلي للجدول الموجود في الكود وغير الموجود حياً

هذا النص هو المصدر الكامل من `server/src/db/migrations/111_daily_ledger_dispatch_save_logs.sql`، وهو دليل الفارق بين نسخة الكود وقاعدة البيانات:

```sql
create table if not exists daily_ledger_dispatch_save_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  dispatch_id uuid references daily_ledger_dispatch_definitions(id) on delete set null,
  dispatch_no integer,
  ledger_date date not null,
  line_label text not null default '',
  origin_label text,
  driver_id uuid references drivers(id),
  vehicle_id uuid references vehicles(id),
  driver_label text,
  vehicle_label text,
  trip_no text,
  destination_label text,
  save_mode text not null default 'all' check (save_mode in ('all', 'custom')),
  row_count integer not null default 0,
  pieces_count integer not null default 0,
  weight_kg numeric(14, 2) not null default 0,
  collect_total_usd numeric(14, 2) not null default 0,
  prepaid_total_usd numeric(14, 2) not null default 0,
  hawala_total_usd numeric(14, 2) not null default 0,
  transfer_fee_total_usd numeric(14, 2) not null default 0,
  posted_count integer not null default 0,
  error_count integer not null default 0,
  skipped_count integer not null default 0,
  receipt_nos text[] not null default '{}',
  row_ids uuid[] not null default '{}',
  rows_snapshot jsonb not null default '[]'::jsonb,
  outcome text check (outcome in ('success', 'partial', 'failed')),
  summary text,
  saved_by uuid references users(id),
  saved_at timestamptz not null default now(),
  printed_at timestamptz,
  print_document_id uuid references daily_ledger_print_documents(id) on delete set null,
  print_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_dl_dispatch_save_logs_company_date
  on daily_ledger_dispatch_save_logs(company_id, ledger_date desc, saved_at desc);
create index if not exists idx_dl_dispatch_save_logs_dispatch
  on daily_ledger_dispatch_save_logs(company_id, dispatch_id, saved_at desc)
  where dispatch_id is not null;
create index if not exists idx_dl_dispatch_save_logs_driver
  on daily_ledger_dispatch_save_logs(company_id, driver_id, ledger_date desc);
```

## 5. القيود والفهارس والتوليد

### 5.1 القيود المهمة كاملة

- `shipments`: PK `id`؛ UNIQUE `shipment_no`؛ FKs إلى company, branch, agent, customer, sender, receiver, users, currency, default cashbox. CHECKs: `pieces_count > 0`، `exchange_rate_to_usd > 0`، `loaded_pieces_count >= 0 AND <= pieces_count`، وحصر status في canonical+legacy، وحصر financial/payment/payer/responsibility/collection/commission-base في قيمها المعروفة.
- `shipment_status_history`: PK؛ FK shipment `ON DELETE CASCADE`، FK changed_by.
- `shipment_inventory_movements`: PK؛ FKs company/shipment/item/warehouse/user؛ CHECK `quantity > 0` وmovement type؛ UNIQUE جزئي للخصم مرة واحدة لكل `(shipment,item,warehouse)`.
- `daily_ledger_sessions`: PK؛ FKs company/branch/driver/vehicle/users؛ UNIQUE جزئي للسجل الفعال على `(company_id, branch_id, ledger_date, line_label, coalesce(driver_id, zero-uuid))`.
- `daily_ledger_rows`: PK؛ FK session `ON DELETE CASCADE` وبقية روابط shipment/manifest/dispatch/transfer/users؛ CHECK `row_no > 0`؛ UNIQUE جزئي `(session_id,row_no)` للسطر غير المحذوف. لا يوجد UNIQUE على `receipt_no`؛ منع التكرار منطقي في التطبيق ضمن سياق الفرع/التاريخ/الخط.
- `daily_ledger_dispatch_definitions`: PK؛ FKs company/branch/driver/vehicle/users؛ CHECK `dispatch_no > 0`؛ UNIQUE جزئي `(company_id,branch_id,ledger_date,line_label,dispatch_no)` للسجل الفعال.
- `daily_ledger_row_transfers/items`: PKs؛ كل الروابط FKs؛ حذف رأس النقل يسلسل إلى items. لا يوجد UNIQUE على `transfer_no`.
- `manifests`: PK؛ UNIQUE `manifest_no`؛ status محصور؛ FKs company/branch/driver/vehicle/user. `manifest_shipments` PK مركب يمثل N:N ويحذف بالتسلسل من الطرفين.
- `deliveries`: PK؛ UNIQUE `delivery_no`؛ UNIQUE جزئي `shipment_id WHERE deleted_at IS NULL`؛ status محصور؛ سعر الصرف موجب؛ FKs كاملة.
- `center_receipts`: PK؛ UNIQUE جزئي للشحنة الفعالة؛ status `received/cancelled`؛ FKs، مع `company_id` nullable.
- `transfers`: PK؛ FKs إلى company/branch/agent/shipment/cashboxes/vouchers/users؛ UNIQUE جزئي لكل معرف سند تحصيل/دفع غير null؛ لا UNIQUE لرقم نقل لأن الجدول لا يحوي `transfer_no` أصلاً.
- `party_financial_movements`: PK؛ حصر نوع الطرف/الحركة/الاتجاه؛ اقتران voucher type/id؛ فهارس UNIQUE جزئية تمنع تكرار قيد الشحنة، مكونات الشحنة، مكونات الحوالة، وعكس القيد أكثر من مرة.
- `receipt_vouchers/payment_vouchers`: PK؛ UNIQUE `voucher_no`؛ status محصور؛ سعر الصرف موجب؛ UNIQUE جزئية لربط التحصيل/الدفع بالحوالة، و`receipt_vouchers.delivery_id` UNIQUE.
- `idempotency_keys`: PK؛ status محصور؛ UNIQUE على `(coalesce(company_id,zero), coalesce(user_id,zero), route_key, idempotency_key)`.
- الجداول المرجعية: UNIQUE codes في companies/branches/agents/cities/goods_types/drivers، UNIQUE username/email/phone في users، UNIQUE plate/code في vehicles، UNIQUE `(company_id,code)` في items/warehouses/cashboxes، UNIQUE مخزون `(company,warehouse,item)`.

### 5.2 الفهارس التشغيلية

الفهارس غير الضمنية الأهم كما أظهر `pg_indexes`: `shipments` على company/branch/agent/status/effective_date/financial_status/payment_status/financial responsibility/charges/commission؛ التاريخ على `(shipment_id,changed_at DESC)`؛ الدفتر على سياق الجلسة والإيصال وposted shipment/manifest/dispatch؛ المنافيست على company/branch/deleted؛ التسليم على status/branch/company مع unique active shipment؛ الحركات المالية على party/shipment/reference/cashbox/posted_at/currency؛ المخزون على company+item/warehouse/shipment؛ idempotency على created_at إضافة إلى مفتاح النطاق الفريد. فهارس PK/UNIQUE المذكورة أعلاه ينشئها PostgreSQL كفهارس فريدة.

### 5.3 توليد الأرقام

| الرقم | مصدر التوليد الحالي |
|---|---|
| UUID لكل سجل | PostgreSQL `gen_random_uuid()` |
| `shipment_no` من شاشة إدخال الشحنة | `data.shipmentNo || `SHP-${Date.now()}`` في `src/services/phase15Gateway.ts` |
| شحنة ناتجة من الدفتر | `receipt_no` نفسه يمرر إلى `shipmentNo` |
| بوابة الوكيل | القيمة الداخلة مطلوبة؛ لا توليد في DB |
| `manifest_no` | قيمة API؛ بعض الواجهة تستخدم `MAN-${Date.now()}` |
| `delivery_no` | قيمة API؛ بعض الواجهة تستخدم `DEL-${Date.now()}` |
| `dispatch_no` | التطبيق يقرأ `max(dispatch_no)+1` ضمن السياق |
| `daily_ledger_row_transfers.transfer_no` | `TRF-${Date.now()}-${random 4 chars}` داخل الخدمة |

لا يوجد ضمان DB لمنع تصادم `dispatch_no` قبل محاولة الإدخال إلا الـUNIQUE الجزئي، ولا يوجد UNIQUE على transfer number. **[سلوك مثبت]**

### 5.4 triggers/functions/procedures

استعلام `pg_trigger` للجداول في النطاق أعاد صفر triggers. لا توجد procedures أو functions تطبيقية مرتبطة بها؛ لذلك لا يوجد source code إضافي من قاعدة البيانات. وظائف `pgcrypto` هي وظائف امتداد لتوليد UUID والتشفير وليست منطق شحن.

## 6. واجهات الكتابة وحدود المعاملات

### 6.1 خريطة المسارات والطرق الفعلية

جميع المسارات تحت `/api/v1`. المسارات أدناه هي كل مسارات create/update/delete أو تغيير حالة/أثر ضمن النطاق.

| HTTP | المسار | الملف/المعالج | الصلاحية الأساسية |
|---|---|---|---|
| POST | `/shipments` | `server/src/routes/shipmentRoutes.ts` → `ShipmentService.create` | `shipments.write` |
| PUT | `/shipments/:id` | نفس الملف → `ShipmentService.update` | `shipments.write` |
| DELETE | `/shipments/:id` | نفس الملف → `ShipmentService.remove` | `shipments.write` |
| POST | `/shipments/:id/confirm` | `ShipmentService.confirmWithFinancials` | `shipments.write` |
| POST | `/shipments/:id/repost-financials` | `ShipmentService.repostFinancials` | `shipments.write` |
| POST | `/shipments/:id/record-payment` | خدمة الترحيل/السند المالي | `shipments.write` + `finance.vouchers.create` |
| POST | `/shipments/:id/{mark-ready,handover-driver,handover-agent,agent-received,mark-in-transit,arrived,out-for-delivery,deliver,request-return,mark-returned,cancel}` | loop في `shipmentRoutes.ts` → `ShipmentService.transitionStatus` | `shipments.write` |
| POST | `/daily-ledger/rows/upsert` | `dailyLedgerRoutes.ts` → `DailyLedgerService.upsertRow`/repository | `shipments.write` |
| POST/PATCH/DELETE | `/daily-ledger/dispatch-definitions[/:id]` | نفس الملف → dispatch repository | `shipments.write` |
| POST | `/daily-ledger/rows/:id/post` | `DailyLedgerShipmentPostingService.postRow` | `shipments.write` |
| POST | `/daily-ledger/rows/post-shipments` | `postPendingShipments` | `shipments.write` |
| POST | `/daily-ledger/client-logs` | `AuditService.log` | `shipments.write` |
| POST | `/daily-ledger/rows/delete` | daily ledger repository soft delete | `shipments.write` |
| POST | `/daily-ledger/sessions/cancel` | daily ledger repository session move/cancel | `shipments.write` |
| POST | `/daily-ledger/transfer/validate` | `DailyLedgerTransferService.validateTransfer` (قراءة/تحقق) | `shipments.write` |
| POST | `/daily-ledger/transfer/confirm` | `DailyLedgerTransferService.confirmTransfer` | `shipments.write` |
| POST | `/daily-ledger/print/record` | repository يسجل event ويحدث session | `shipments.read` |
| POST | `/daily-ledger/print/document` | repository inserts snapshot | `shipments.read` |
| DELETE | `/daily-ledger/print/documents/:id` | repository hard delete | `shipments.write` |
| POST | `/daily-ledger/dispatch-saves` | `DailyLedgerDispatchSaveRepository.create` | أي من dispatch-save-read أو post-shipments |
| POST | `/daily-ledger/dispatch-saves/:id/mark-printed` | repository update | أي من dispatch-save-read أو shipments.read |
| POST | `/agent-portal/shipments` | `agentPortalRoutes.ts` → ensure parties ثم `ShipmentService.create` | `agent_portal.view` |
| POST | `/agent-portal/shipments/:id/:action` | `ShipmentService.transitionStatus` | `agent_portal.status_action` |
| POST | `/agent-portal/transfers` | `TransfersService.create` | `agent_portal.view` |
| POST | `/agent-portal/transfers/:id/complete` | `TransfersService.complete` | `agent_portal.view` |
| POST/PUT/DELETE | `/manifests[/:id]` | `manifestRoutes.ts` → `ManifestService.create/update/remove` | `manifests.write` |
| POST | `/center-receipts` | `centerReceiptRoutes.ts` → `CenterReceiptService.create` | `deliveries.write` |
| POST/PUT/DELETE | `/deliveries[/:id]` | `deliveryRoutes.ts` → `DeliveryService.create/update/remove` | `deliveries.write` |
| POST/PUT/DELETE وأفعال التحصيل/الدفع/الإلغاء | `/transfers...` | `server/src/routes/transfers.ts` → `TransfersService` | صلاحيات transfers/finance المحددة في الملف |

مسار `GET /shipping-labels/print-plan/:shipmentId` للقراءة فقط؛ يبني خطة الطباعة ولا يكتب `shipment_labels` في هذا المسار.

### 6.2 إنشاء شحنة عادية: التسلسل الحرفي للعمليات

المصدر: `ShipmentService.create` و`ShipmentRepository.createWithClient`.

1. يتحقق route من schema ومن scope والترخيص وحد الرخصة، ويطبق idempotency middleware.
2. تحمل الخدمة أسماء المرسل والمستلم، تطبع الحالة إلى canonical (`UNKNOWN` يصبح `REGISTERED`)، وتحسب `baseAmountUsd`.
3. إذا لم يرد agent ووجد destination، تحاول `resolveAgentForDestination`; عند الغموض/الخطأ تبتلع الخطأ وتحتفظ بالوجهة بلا agent. **[حل التفافي قائم]**
4. إذا وجد agent، تقرأ نسبة العمولة وتثبت snapshot؛ عند فشل القراءة تثبت نسبة صفر.
5. إذا كانت الحالة `CONFIRMED`: `BEGIN`؛ INSERT في `shipments`؛ INSERT أولي في `shipment_status_history`؛ تنفيذ `postShipmentConfirmationFinancials` على نفس client (حركات أطراف/سندات وحالة مالية حسب المدخل)؛ `COMMIT`. أي خطأ → `ROLLBACK`.
6. إن لم تكن CONFIRMED: `ShipmentRepository.create` يفتح `BEGIN`؛ INSERT shipment؛ INSERT history؛ `COMMIT`.
7. بعد commit، إن وجدت inventory items: `InventoryService.reserveStock` في معاملة مستقلة يعدل `item_stock` وينشئ `shipment_inventory_movements`. إذا فشل، تنفذ الخدمة soft-delete للشحنة في عملية مستقلة ثم تعيد الخطأ. السجل الأصلي والتاريخ لا يرجعان ضمن rollback واحد. **[عدم ذرية مثبت]**
8. بعد ذلك، إذا كانت hawala/service fee موجبة، تحاول `syncShipmentLinkedTransfer` في مسار/معاملة مستقلة. الخطأ يسجل إلى console فقط ولا يفشل إنشاء الشحنة. **[أفضل جهد مثبت]**

المقطع الفعلي الذي يثبت الحدود:

```ts
if (needsPosting) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    created = await this.repository.createWithClient(client, payload);
    await this.financialPosting!.postShipmentConfirmationFinancials({
      client, shipmentId: created.id, scope, userContext: uc,
      financial: options?.financial ?? { paymentMode: 'UNPAID', payerPartyKind: payload.payerPartyKind ?? 'RECEIVER' },
      shipmentRow: created, effectiveDate: options?.effectiveDate ?? input.effectiveDate,
    });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally { client.release(); }
} else {
  created = await this.repository.create(payload);
}

if (this.inventoryService && effectiveCompanyId && input.inventoryItems?.length) {
  try {
    await this.inventoryService.reserveStock(effectiveCompanyId, created.id, input.inventoryItems, input.createdBy);
  } catch (inventoryError) {
    await this.repository.remove(created.id, { companyId: effectiveCompanyId }).catch(() => {});
    throw inventoryError;
  }
}
```

أسلوب الوصول: parameterized raw SQL عبر `pg`; لا يوجد Entity Framework في هذا المشروع.

### 6.3 تعديل وحذف الشحنة

`PUT /shipments/:id`:

1. SELECT scoped للشحنة؛ إن لم توجد يرجع null/404.
2. يمنع تعديل `CANCELLED` و`FINANCIALLY_CLOSED`، ويفحص انتقال الحالة إن وردت.
3. عند الانتقال إلى CANCELLED يستدعي تحرير المخزون قبل UPDATE وبمعاملة مستقلة؛ الفشل يحذر فقط ويستمر. **[أفضل جهد]**
4. يمنع تغيير branch/agent خارج scope الضيق إن كان موجوداً.
5. يعيد حساب base amount وcommission snapshot.
6. `ShipmentRepository.update` ينفذ معاملة: UPDATE لكل الحقول الواردة مع شرط `updated_at = expectedUpdatedAt` إن أرسل، ثم INSERT history عند تغير status، ثم COMMIT.
7. إن لم يتطابق optimistic token يعيد قراءة السجل ويصدر 409.
8. بعد commit، إذا أصبحت الحالة DELIVERED أو CONFIRMED، ينفذ `ensurePostedFromLifecycle` في معاملة أخرى.
9. بعد commit، يزامن الحوالة المرتبطة best-effort ويبتلع الخطأ بعد console error.

`DELETE /shipments/:id`: SELECT scoped ثم `UPDATE shipments SET deleted_at=now(), updated_at=now()`؛ لا يحذف التاريخ أو القيود التابعة ولا يعكسها، ولا توجد معاملة متعددة الخطوات لأنها عملية SQL واحدة.

### 6.4 تغيير الحالة والتأكيد المالي

الانتقالات القانونية هي النص الفعلي التالي من `server/src/domain/shipmentStatus.ts`:

```ts
export const SHIPMENT_TRANSITIONS = {
  DRAFT: ['REGISTERED', 'CANCELLED'],
  REGISTERED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'RETURN_REQUESTED', 'CANCELLED'],
  READY_FOR_PICKUP: ['HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'RETURN_REQUESTED', 'CANCELLED'],
  HANDED_TO_DRIVER: ['IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'],
  HANDED_TO_AGENT: ['AGENT_RECEIVED', 'RETURN_REQUESTED'],
  AGENT_RECEIVED: ['IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'],
  IN_TRANSIT: ['ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'],
  ARRIVED_AT_DESTINATION: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURN_REQUESTED'],
  DELIVERED: ['FINANCIALLY_CLOSED', 'RETURN_REQUESTED'],
  RETURN_REQUESTED: ['RETURNED'],
  RETURNED: ['FINANCIALLY_CLOSED'],
  CANCELLED: [], FINANCIALLY_CLOSED: [],
} as const;
```

`transitionStatus`:

1. SELECT scoped وnormalize للحالة الحالية والجديدة.
2. يفحص الجدول أعلاه والقيود الخاصة بالفعل.
3. repository: `BEGIN`؛ SELECT shipment `FOR UPDATE`؛ يعيد فحص الحالة بعد القفل؛ UPDATE status/updated_at؛ INSERT `shipment_status_history(previous_status,next_status,source,metadata)`؛ `COMMIT`.
4. بعد commit، إذا الهدف DELIVERED أو CONFIRMED، `ensurePostedFromLifecycle` بمعاملة منفصلة.

`confirmWithFinancials` يجمع القفل والترحيل المالي والحالة في معاملة واحدة:

```ts
const client = await pool.connect();
try {
  await client.query('begin');
  const locked = await this.repository.lockShipmentForUpdate(client, input.shipmentId, input.scope);
  // validate REGISTERED -> CONFIRMED
  await this.financialPosting.postShipmentConfirmationFinancials({ client, shipmentId: input.shipmentId, ... });
  const changed = await this.repository.transitionStatusCore(client, {
    shipmentId: input.shipmentId, nextStatus: 'CONFIRMED', ...
  });
  await client.query('commit');
  return changed.updated;
} catch (error) {
  await client.query('rollback');
  throw error;
} finally { client.release(); }
```

### 6.5 إدخال/تعديل سطر الدفتر

1. route يتحقق من الشركة والفرع المسموحين ومدخلات التاريخ/الخط/السائق/الإرسال.
2. تطبع القيم النصية والأرقام. إذا كان `collect_amount_usd > 0` و`prepaid_amount_usd > 0` معاً، يجعل التطبيق prepaid صفراً. **[قاعدة تحويل صامتة مثبتة]**
3. `BEGIN`.
4. يبحث عن سطر قائم بالـID أو receipt ضمن النطاق، ويتحقق تطبيقياً من duplicate receipt.
5. يتحقق من dispatch/fleet إن ورد dispatch_id.
6. إن كان السطر قائماً: UPDATE وقد ينقله إلى session أخرى؛ يستخدم expected timestamp فقط إن قدمه المستدعي.
7. إن كان جديداً: UPSERT/إنشاء `daily_ledger_sessions` ثم يحدد `row_no` من `max(row_no)+1` ثم INSERT/UPSERT row.
8. إذا كانت الجلسة مطبوعة، يحدث `reprint_required=true` وسبب الإعادة.
9. `COMMIT`; الخطأ → `ROLLBACK`.

لا يوجد قفل حول `max(row_no)+1`؛ الـUNIQUE الجزئي يمنع رقمين متساويين بعد السباق، لكن لا توجد إعادة محاولة داخلية. **[سلوك تزامن مثبت]**

### 6.6 ترحيل سطر الدفتر إلى شحنة

1. SELECT السطر والجلسة والتحقق من scope واكتمال receipt/destination/sender/receiver.
2. معاملة أولى: `BEGIN`؛ ensure sender؛ ensure receiver؛ ensure goods type؛ `COMMIT`.
3. خارج المعاملة: resolve agent للوجهة، resolve account customer، حساب المبالغ والمسؤول المالي.
4. SELECT shipment بنفس `lower(trim(shipment_no))` والشركة.
5. إذا وجدت شحنة: يتحقق أن سطر دفتر آخر لا يربطها؛ وإذا كانت UNPOSTED يفتح معاملة مالية ويترحلها ويحدث effective_date ثم COMMIT؛ بعدها يستدعي `markPosted` كعملية SQL مستقلة.
6. إذا لم توجد: يستدعي `ShipmentService.create` بحالة CONFIRMED؛ هذه تنشئ الشحنة والتاريخ والقيود في معاملتها؛ بعدها `markPosted` مستقل يضع `posted_shipment_id/posted_at` على السطر.
7. batch endpoint يكرر العملية لكل سطر ويجمع نجاح/فشل كل واحد؛ ليست هناك معاملة واحدة للدفعة.

المقطع الفعلي الذي يثبت انفصال ربط السطر:

```ts
const created = await this.shipmentService.create({
  shipmentNo: normalizeName(row.receipt_no),
  referenceNo: normalizeName(row.receipt_no),
  senderId, receiverId, branchId: row.branch_id, agentId,
  status: 'CONFIRMED', effectiveDate: row.ledger_date, /* amounts omitted here only */
}, { ...scope, branchId: row.branch_id, companyId: row.company_id },
   { financial, actorUserId: scope.userId, effectiveDate: row.ledger_date });

const posted = await this.ledgerRepo.markPosted(
  scope, { rowId: row.id, shipmentId: created.id, userId: scope.userId }, allowedBranchIds,
);
if (!posted) throw new HttpError(409, 'تعذر ربط الشحنة بالسطر');
```

إذا نجح إنشاء الشحنة وفشل `markPosted` تبقى الشحنة موجودة دون رابط الدفتر. **[عدم ذرية مثبت]**

### 6.7 نقل أسطر الدفتر بين الجلسات

`confirmTransfer` كله داخل معاملة واحدة:

1. `BEGIN`.
2. SELECT rows مع `FOR UPDATE`; يتحقق من عدم الحذف/التحميل، ومن الفروع والحالة المالية وشروط النقل.
3. يقرأ/ينشئ target session.
4. يتحقق من تكرار receipt في الجلسة الهدف.
5. يقرأ `max(row_no)` للهدف.
6. ينشئ `daily_ledger_row_transfers` برقم `TRF-${Date.now()}-${random}`.
7. لكل سطر: UPDATE session_id/row_no/original_session_id/last_transfer_id/status؛ INSERT في `daily_ledger_row_transfer_items`.
8. يعلّم جلسات المصدر والهدف `reprint_required` إذا كانت مطبوعة.
9. يبني summaries ثم `COMMIT`; أي خطأ → `ROLLBACK`.

```ts
await client.query('begin');
const rows = await this.loadRows(client, scope.companyId, input.rowIds, true); // true => FOR UPDATE
const targetSessionId = await this.findOrCreateTargetSession(client, targetInput);
const transferNo = `TRF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const transferRecord = await client.query(`insert into daily_ledger_row_transfers (...) values (...) returning id`, values);
for (const row of rows) {
  await client.query(`update daily_ledger_rows set session_id=$2, row_no=$3, ... where id=$1`, values);
  await client.query(`insert into daily_ledger_row_transfer_items (...) values (...)`, values);
}
await client.query('commit');
```

### 6.8 المنافيست والتسليم والاستلام المركزي

- إنشاء manifest: معاملة واحدة تنشئ `manifests` ثم `manifest_shipments` لكل shipment، ثم تحدث `shipments.status='manifested'` مباشرة، وتحدث ledger rows `loaded_manifest_id/loaded_at`. لا تمر عبر `ShipmentService.transitionStatus` ولا تضيف `shipment_status_history`. **[عدم اتساق مثبت]**
- تعديل manifest: معاملة تحذف روابط `manifest_shipments` ثم تعيد إدراج القائمة وتحدث الحقول؛ الأسطر/الشحنات المزالة لا يُمسح منها دائماً `loaded_manifest_id/loaded_at` قبل إضافة الحالية. **[سلوك متبقٍ مثبت]**
- حذف manifest: soft-delete للرأس؛ تعتمد تفاصيل الروابط على الخدمة ولا يحذف السجل مادياً.
- إنشاء delivery: يتحقق من shipment والنطاق وعدم وجود delivery فعال؛ معاملة تنشئ delivery وتغير حالة الشحنة عبر repository وتضيف history عند الحالات المقابلة.
- تعديل delivery: يقرأ ويحدث delivery؛ تغير الحالة إلى delivered/failed/returned يسبب تحديثات حالة/وقت وآثاراً مالية حسب الخدمة، داخل الحدود المسجلة في service/repository.
- حذف delivery: soft-delete.
- center receipt: يتحقق من shipment والنطاق وعدم وجود active receipt، ثم INSERT، ويحدث الحالة المرتبطة وفق الخدمة. يوجد unique active shipment كحاجز قاعدة بيانات.

### 6.9 التسجيل والطباعة والحذف في الدفتر

- `print/record`: معاملة تحدث session (`printed_at`, `last_printed_at`, `print_count`, reset reprint) وتدخل `daily_ledger_print_events`.
- `print/document`: INSERT واحد يحفظ totals و`rows_snapshot` JSON؛ لا يحفظ PDF binary.
- حذف print document: `DELETE` مادي scoped بالشركة.
- حذف rows: UPDATE جماعي يضع `deleted_at`; يمنع التطبيق حذف posted/loaded حسب المسار.
- cancel session: معاملة تقفل session/rows، تنقل/تعيد ترتيب الأسطر حسب المدخل ثم soft-deletes session.
- dispatch definitions: create/update ضمن استعلامات repository ومعاملات المسار، delete منطقي. `dispatch_no` يحسب تطبيقياً.
- dispatch save create/markPrinted: INSERT/UPDATE مفردان بلا معاملة متعددة؛ غير قابلين للعمل حياً لأن الجدول غير موجود حالياً.

## 7. قواعد الأعمال والتحقق والترخيص أثناء الحفظ

- الشحنة تتطلب shipment number، sender، receiver، branch، destination، currency، rate موجب، pieces موجب، وscope company.
- endpoint creation يمر عبر license limit guard وidempotency؛ delete وبعض endpoints الثانوية لا تمر كلها عبر idempotency.
- انتقالات الحالة محكومة بالخريطة في 6.4، مع حالات نهائية تمنع التعديل العام.
- branchId/agentId لا يمكن نقلهما خارج scope إذا كان scope نفسه ضيقاً.
- CONFIRMED/DELIVERED يطلقان الترحيل المالي؛ مكونات المبلغ تفصل أجرة الشحن، أمانة التحصيل، hawala، service fee، والعمولة، وتمنعها unique partial indexes من التكرار.
- دفاتر الشحن تتطلب branch/date/line، والسطر القابل للترحيل يتطلب receipt + destination + sender + receiver.
- duplicate receipt يفحص تطبيقياً ضمن السياق؛ لا يوجد قيد DB عالمي/سياقي عليه.
- collect وprepaid لا يبقيان موجبين معاً في upsert؛ prepaid يصفر.
- لا ينقل transfer ledger rows من فروع مختلفة في عملية واحدة، ولا ينقل loaded rows؛ الصفوف مقفلة أثناء التأكيد.
- manifest/delivery/center receipt تتحقق من scope والشحنة والكيانات المرجعية قبل الحفظ.
- الصلاحيات التفصيلية التي تمررها lifecycle actions تستخدم أيضاً في audit metadata، لكن route shipment lifecycle نفسه يطلب عملياً `shipments.write` فقط. وجود permission code تفصيلي لا يعني أنه فُرض كحارس منفصل في هذا route. **[عدم اتساق مثبت]**

## 8. التزامن، القفل، idempotency، cache وإعادة المحاولة

### 8.1 آليات الكتابة المتزامنة

| المسار | الآلية الحالية |
|---|---|
| تغير حالة shipment | pessimistic row lock `FOR UPDATE` + إعادة تحقق داخل المعاملة |
| confirm with financials | `FOR UPDATE` على shipment، كل الترحيل والحالة في معاملة واحدة |
| update shipment | optimistic اختياري: `WHERE updated_at = expectedUpdatedAt`; إن لم يرسل token يصبح last-write-wins |
| ledger row upsert | optimistic اختياري في بعض repository calls؛ غير مفروض دائماً |
| ledger transfer confirm | `FOR UPDATE` على جميع rows المختارة |
| financial posting | row locks وunique partial indexes لحماية idempotent components |
| delivery/active receipt | unique partial indexes تمنع أكثر من سجل فعال للشحنة |
| row number/dispatch number | `max()+1` تطبيقياً؛ unique constraint يرفض السباق ولا توجد retry داخلية |
| manifest status write | direct SQL؛ لا optimistic token ولا lifecycle lock مشترك |

### 8.2 Idempotency HTTP

middleware يحذف المفاتيح الأقدم من 24 ساعة، ثم يحاول INSERT بحالة `processing`. التعارض على المفتاح يعيد 409؛ لا يعيد response سابقاً مخزناً لأن الجدول لا يحتوي response body/status. بعد انتهاء الطلب يحدث status إلى completed/failed بصورة لاحقة. العميل يعيد محاولة خطأ الشبكة مرة واحدة بعد 800ms مع headers نفسها، ومنها مفتاح idempotency. المسارات غير المركب عليها middleware لا تستفيد من ذلك.

### 8.3 Cache

- يوجد `Map` in-memory في dashboard finance بمهلة افتراضية 15 ثانية (`DASHBOARD_CACHE_TTL_MS=15000`). لا تستخدم قوائم/تفاصيل shipment CRUD هذا cache، لكن مؤشرات dashboard المشتقة من بيانات الشحن قد تبقى حتى TTL أو invalidation.
- توجد caches لإعدادات/branding محلية لا تحمل سجل shipment نفسه.
- لم يوجد Redis client أو Redis server integration في مسار الشحن.

### 8.4 Offline/queue/retry الموجود فعلاً

- IndexedDB: قاعدة `abooerp_offline`، version 1، object store `daily_ledger_drafts`، key `clientRowId`، وفهارس للسياق والحالة و`serverRowId` و`updatedAt`، مع store لسجل مزامنة/تدقيق.
- autosave: الواجهة تحفظ draft بعد نحو 350ms. حالات النموذج تشمل `draft`, `pending_sync`, `synced` وتوجد أنواع `failed/conflict` في التعريفات؛ لم يظهر مسار مكتمل يضع/يعالج كل حالتي failed/conflict.
- الاستعادة: تفلتر rows التي أصبحت synced أو تحمل server ID/receipt/client ID مكافئاً لتجنب تكرار العرض.
- عند انقطاع الشبكة، أفعال server-only تتوقف وتبقى الصفوف pending؛ لا يوجد service worker background sync ولا عامل دائم يفرغ queue بعد عودة الشبكة.
- `runtime.offlineMode` و`autoRetry/preferLocalCache` إعدادات موجودة، لكن لم يوجد منها محرك عام لمزامنة shipment/status/sub-entities.
- لا يوجد queue server (RabbitMQ/Kafka/Bull) لمسار الشحن. الربط بالحوالة وبعض الآثار يستخدم best-effort call لا durable queue.

**حدود السلوك الحالي:** offline persistence يغطي draft rows في دفتر الشحن، لا جداول `shipments`, `shipment_status_history`, `deliveries`, `manifests`, أو القيود المالية.

## 9. الحجم ومعدل التغير والحقول الكبيرة

### 9.1 لقطة الحجم الزمني

- 133 شحنة حية، مدى `created_at` من 2026-06-06 إلى 2026-06-11 تقريباً.
- التوزيع حسب تاريخ الإنشاء الظاهر في اللقطة: 4 ثم 126 ثم 3 في الأيام التي ظهرت فيها البيانات.
- `effective_date`: 130 شحنة على تاريخ تشغيلي واحد تقريباً و3 على تاريخ لاحق.
- 172 سطر دفتر: 171 في يوم تشغيلي و1 في اليوم التالي؛ 38 محذوفة منطقياً، 131 مرتبطة بشحنات، 0 محملة في manifest، و0 منقولة بين جلسات.
- 260 حدث حالة: 130 حدث إنشاء/تأكيد و130 انتقالاً من CONFIRMED إلى HANDED_TO_DRIVER.
- حالة الشحنات: 130 `HANDED_TO_DRIVER` مع `financial_status=POSTED` و`payment_status=UNPAID`؛ 3 `DELIVERED` مع `financial_status=UNPOSTED` وpayment status null.

هذه البيانات تبدو إدخالاً/ترحيلاً دفعياً في فترة قصيرة، لذلك لا تثبت معدل تشغيل يومي أو شهري نموذجي. **[غير واضح]** لا توجد فترة تاريخية كافية في القاعدة الحالية لاستخراج متوسط إنتاج موثوق. الرقم الشهري المتاح للّقطة هو 133 شحنة في يونيو 2026، وليس forecast ولا متوسطاً.

### 9.2 أكثر الحقول تغيراً

- من بيانات الحالة: 130 شحنة تغيرت حالتها بعد الإنشاء، وجميعها تقريباً في المجموعة الكبيرة انتقلت إلى HANDED_TO_DRIVER.
- من `audit_logs`: ظهرت 290 عملية update ناجحة؛ metadata سجلت قائمة payload كاملة تشمل description/origin/freight/pieces/branch/prepaid/destination/fees/discount/currency/parties/status/amount/rate. `weight` ظهر في 216، `shipmentNo` في 105، و`agent` في 12.
- لا يمكن اعتبار ظهور الحقل في قائمة payload دليلاً أنه تغيرت قيمته فعلاً؛ audit يسجل الحقول المرسلة لا diff before/after. **[غير واضح]** لذلك الإثبات القوي للتكرار هو status/financial posting وledger updated_at، أما ترتيب بقية الحقول فلا يمكن حسمه من السجل الحالي.
- 168 من 172 سطر دفتر لها `updated_at` بعد `created_at`، و131 تغيرت إلى posted. حقول `loaded_*` وtransfer fields لم تتغير في اللقطة.
- `loaded_pieces_count` في الشحنات كلها صفر في اللقطة؛ شاشة القراءة قد تشتق قيمة أحدث من metadata في status history بدلاً من العمود نفسه. **[عدم اتساق مصدر قيمة مثبت]**

### 9.3 الحجم الفيزيائي التقريبي

من `pg_total_relation_size` في وقت الفحص: `audit_logs` نحو 800KB، `shipments` نحو 568KB، `party_financial_movements` نحو 480KB، `idempotency_keys` نحو 464KB، وجداول الدفتر مجتمعة صغيرة (أكبرها rows نحو 192KB). هذه أرقام اللقطة مع الفهارس وليست حدوداً ثابتة.

### 9.4 binary/attachments/documents

- لا يوجد `bytea`, large object, attachment table، أو document blob مرتبط بالشحنة في المخطط المفحوص.
- `daily_ledger_print_documents.rows_snapshot` JSONB قد يكبر مع عدد الصفوف، لكنه ليس PDF ولا صورة؛ عدد الصفوف الحالي صفر.
- `shipment_labels` يخزن IDs وحالة الطباعة فقط، لا المحتوى.
- PDF/الإيصالات تنشأ في الواجهة/Electron وقت الطباعة ولا توجد دلالة في مسار الشحن على رفعها إلى cloud storage أو حفظها على filesystem باسم مرتبط بصف shipment.
- `companies.logo_data_url` حقل text قد يحمل صورة base64 للشركة، لكنه ليس مرفقاً لكل شحنة.
- لم يوجد جدول مرفقات خاص بالشحن. **[سلوك مثبت]**

## 10. المستخدمون والصلاحيات ونطاق الفرع/المحافظة

### 10.1 الأدوار القادرة عملياً على الكتابة

حارس مسارات الشحنة العامة هو `shipments.write`. الأدوار التي تملكه حياً هي:

`admin`, `agent_user`, `branch_manager`, `branch_user`, `data_entry`, `general_manager`, `manager`, `operator`, `shipment_auditor`.

الأدوار `accountant`, `field_accountant`, `viewer`, `delivery_user` لا تملك `shipments.write`. مع ذلك، `delivery_user` يملك صلاحيات تفصيلية مثل `shipments.deliver` و`shipments.out_for_delivery`، بينما lifecycle route العام يطلب `shipments.write`; لذلك الصلاحية التفصيلية وحدها لا تكفي لذلك route. **[عدم اتساق مثبت بين منح الصلاحية والحارس]**

الكتابة في:

- manifest تتطلب `manifests.write`.
- delivery/center receipt تتطلب `deliveries.write`.
- agent portal create shipment يتطلب `agent_portal.view` فقط، وتغيير الحالة يتطلب `agent_portal.status_action`.
- daily ledger write routes العامة تتطلب `shipments.write` ثم قد تجري checks إضافية لصلاحيات backdate/delete/post/transfer/print داخل handler.

المستخدمون الأربعة في اللقطة: `admin` بدور admin، `الرقة` بدور agent_user، `عبدالرحمن` بدور data_entry، و`مالك` بدور accountant. كلهم يحملون branch_id؛ لا يحمل أي منهم agent_id حالياً، بما في ذلك مستخدم agent_user المسمى `الرقة`. **[عدم اتساق بيانات نطاق محتمل ومثبت في اللقطة]**

### 10.2 حقول التقسيم الجغرافي

| المستوى | الحقول |
|---|---|
| الشركة | `company_id` في shipment ومعظم الجداول التابعة |
| الفرع | `shipments.branch_id`; session/dispatch/manifest/delivery/receipt/voucher/cashbox branch_id |
| الوكيل | `shipments.agent_id`; agent_id في delivery/receipt/transfer/financial tables |
| المحافظة | `agents.governorate` نصي |
| المدينة/المنطقة | `agents.city/area`, `branches.city`, `shipments.origin_city/destination_city`, `daily_ledger_rows.destination` |
| مرجع المدن | `cities.id/code/name/region`, لكنه غير مربوط بـ origin/destination في shipment |

`destination_city` و`origin_city` نصان حران، والوكيل يحوي governorate/city/area نصية. الربط بين الوجهة والوكيل يتم تطبيقياً بواسطة `resolveAgentForDestination` والمطابقة النصية، لا FK.

### 10.3 آلية فرض النطاق

1. middleware المصادقة يحدد user/company/role/branch/agent والفروع المسموحة.
2. `parseDataScope` ينتج `companyId`, وأحياناً `branchId`/`agentId`.
3. repositories تضيف `company_id=$...` دائماً تقريباً، وتضيف branch/agent predicates حين يكون scope ضيقاً.
4. لا توجد PostgreSQL RLS؛ الاتصال نفسه يملك إمكانية قراءة كل الشركات، والعزل مسؤولية SQL التطبيق.
5. بعض الأدوار موجودة في مجموعة `companyWideRoles` في الكود، ومنها `branch_manager`, `data_entry`, `shipment_auditor`, `operator`, `manager`, `accountant`, `field_accountant`. لهذا قد لا يُضاف branch filter رغم الاسم أو branch_id المرتبط بالمستخدم. **[سلوك نطاق مثبت]**
6. daily ledger يضيف checks محلية على allowed branch IDs وتواريخ الماضي/المستقبل وبعض الأفعال، لذلك نطاقه ليس مطابقاً حرفياً لكل shipment endpoints.

## 11. حالات عدم الوضوح وعدم الاتساق والحلول الالتفافية الحالية

هذه قائمة توثيقية مجمعة، لا تتضمن إجراءً مقترحاً:

1. **Migration drift:** الترحيلات 001–110 مطبقة؛ 111 موجود في المستودع وغير مطبق، وجدوله غير موجود بينما routes مفعلة.
2. **Shipment number generation متعدد المصادر:** UI timestamp، receipt number، أو إدخال صريح؛ DB يفرض uniqueness فقط، ولا يولد الرقم.
3. **Global uniqueness:** `shipment_no`, `manifest_no`, `delivery_no` فريدة على مستوى الجدول، لا مركبة مع company.
4. **Non-atomic side effects:** inventory reservation، linked transfer sync، lifecycle financial ensure، وربط ledger row قد تقع بعد commit الشحنة.
5. **Best-effort swallowing:** فشل resolve agent/commission/linked transfer/release inventory قد يبتلع أو يسجل فقط بحسب المسار.
6. **Manifest bypass:** يكتب legacy status `manifested` مباشرة دون history أو lifecycle validation.
7. **Manifest removal residue:** إزالة شحنة من manifest update لا يثبت أنها تمسح loaded markers السابقة.
8. **Canonical + legacy:** CHECK يقبل مجموعتين من الحالات، والخدمات تطبعها، وبعض الخدمات ما زالت تكتب legacy مباشرة.
9. **Optimistic lock optional:** `expectedUpdatedAt` ليس إلزامياً؛ غيابه يسمح last-write-wins.
10. **App-only receipt uniqueness:** duplicate receipt بلا قيد DB؛ فحصه يعتمد على scope والنص المطبع.
11. **`max()+1` races:** row_no وdispatch_no يولدان تطبيقياً؛ التصادم يظهر كخطأ unique.
12. **Polymorphic/no-FK fields:** financial responsibility/reference/related entity وcollection cashbox وبعض label IDs بلا FK مباشر.
13. **Nullable company in center_receipts:** مختلف عن عزل الشركة المعتاد.
14. **Permission guard mismatch:** fine-grained shipment action permissions موجودة، لكن route العام يحرس بـ `shipments.write`; agent portal create يحرس بـ view.
15. **Company-wide roles:** أسماء مثل branch_manager/data_entry لا تعني بالضرورة branch-filter في `parseDataScope`.
16. **Agent user without agent:** البيانات الحالية تحتوي agent_user بلا agent_id.
17. **Audit does not store field diffs:** metadata قد تسجل أسماء payload لا القيم السابقة/اللاحقة، فلا تثبت تكرار تغير كل حقل.
18. **Idempotency is conflict-only:** duplicate يعيد 409 ولا يعيد النتيجة السابقة؛ لا يخزن response.
19. **Offline is ledger-draft-only:** الأنواع تشير إلى failed/conflict، لكن لا يوجد محرك مزامنة كامل أو queue drain مستمر.
20. **Print document deletion is hard delete:** بخلاف soft-delete في shipment/manifest/delivery/ledger.

## 12. ملحق الأدلة البرمجية وSQL

### 12.1 INSERT الشحنة والتاريخ

المصدر: `server/src/repositories/shipmentRepository.ts`, `createWithClient`.

```ts
const result = await client.query(
  `insert into shipments (
     shipment_no, reference_no, customer_id, sender_id, receiver_id,
     branch_id, agent_id, origin_city, destination_city, description,
     pieces_count, weight_kg, status, original_amount, original_currency,
     exchange_rate_to_usd, base_amount_usd, created_by, updated_by, company_id,
     freight_charge, transfer_fee, additional_charges, prepaid_amount, discount_amount,
     agent_commission_base_type, agent_commission_base_amount,
     agent_commission_percentage_snapshot, agent_commission_amount_snapshot,
     transfer_service_fee, hawala_amount, effective_date
   ) values (...) returning *`, values,
);
await client.query(
  `insert into shipment_status_history
     (shipment_id,status,previous_status,next_status,changed_by,source,metadata)
   values ($1,$2,null,$2,$3,'create',$4::jsonb)`,
  [result.rows[0].id, result.rows[0].status, input.createdBy ?? null, JSON.stringify({})],
);
```

### 12.2 تغيير الحالة المقفول

المصدر: نفس repository، `transitionStatusCore` و`transitionStatus`.

```ts
const locked = await client.query(
  `select * from shipments where id=$1 and deleted_at is null ... for update`, values,
);
if (!canTransitionShipmentStatus(current, next)) {
  throw new HttpError(400, `Invalid shipment status transition: ${current} -> ${next}`);
}
const updated = await client.query(
  `update shipments set status=$2, updated_by=$3, updated_at=now() where id=$1 returning *`,
  [input.shipmentId, input.nextStatus, input.changedBy ?? null],
);
await client.query(
  `insert into shipment_status_history
     (shipment_id,status,note,changed_by,previous_status,next_status,source,metadata)
   values($1,$2,$3,$4,$5,$2,$6,$7::jsonb)`, values,
);
```

### 12.3 سجل حفظ dispatch المستخدم حالياً في الكود

المصدر: `server/src/repositories/dailyLedgerDispatchSaveRepository.ts`, `create`.

```ts
const result = await pool.query(
  `insert into daily_ledger_dispatch_save_logs (
     company_id, branch_id, dispatch_id, dispatch_no, ledger_date, line_label, origin_label,
     driver_id, vehicle_id, driver_label, vehicle_label, trip_no, destination_label,
     save_mode, row_count, pieces_count, weight_kg,
     collect_total_usd, prepaid_total_usd, hawala_total_usd, transfer_fee_total_usd,
     posted_count, error_count, skipped_count, receipt_nos, row_ids, rows_snapshot,
     outcome, summary, saved_by, notes
   ) values (...) returning *`, values,
);
```

في قاعدة البيانات الحية، تنفيذ هذا النص يواجه غياب relation لأن migration 111 غير مطبق. لم يُنفذ INSERT أثناء هذا التدقيق.

### 12.4 خريطة ملفات المصدر الكاملة

| المجال | المصدر الدقيق |
|---|---|
| mounting | `server/src/app.ts:235-244` |
| shipment HTTP/validation/idempotency | `server/src/routes/shipmentRoutes.ts` |
| shipment orchestration/transactions | `server/src/services/shipmentService.ts` |
| shipment SQL/change tracking | `server/src/repositories/shipmentRepository.ts` |
| status normalization/transitions | `server/src/domain/shipmentStatus.ts` |
| financial posting | `server/src/services/shipmentFinancialPostingService.ts` |
| inventory reservation/release/deduct | `server/src/services/inventoryService.ts` وrepository التابع |
| daily ledger HTTP | `server/src/routes/dailyLedgerRoutes.ts` |
| ledger SQL | `server/src/repositories/dailyLedgerRepository.ts` |
| ledger → shipment | `server/src/services/dailyLedgerShipmentPostingService.ts` |
| ledger transfer | `server/src/services/dailyLedgerTransferService.ts` |
| dispatch save SQL | `server/src/repositories/dailyLedgerDispatchSaveRepository.ts` |
| agent portal | `server/src/routes/agentPortalRoutes.ts` |
| manifest | `server/src/routes/manifestRoutes.ts`, `server/src/services/manifestService.ts`, repository المقابل |
| delivery | `server/src/routes/deliveryRoutes.ts`, `server/src/services/deliveryService.ts`, repository المقابل |
| center receipt | `server/src/routes/centerReceiptRoutes.ts`, `server/src/services/centerReceiptService.ts`, repository المقابل |
| transfer | `server/src/routes/transfers.ts`, `server/src/services/transfersService.ts` |
| print plan | `server/src/routes/shippingPrintPlanRoutes.ts` |
| idempotency | `server/src/middleware/idempotency.ts` (أو الملف المسمى المطابق في middleware) |
| authorization/scope | `server/src/middleware/authorization.ts` وملفات request context/data scope |
| IndexedDB | `src/lib/offline/indexedDb.ts`, `src/lib/offline/dailyLedgerOfflineStore.ts`, والاستخدام في `src/pages/ShipmentQuickLedger.tsx` |
| schema | `server/src/db/migrations/001...111_*.sql`؛ المخطط الحي هو نتيجة 001–110 في وقت الفحص |

مصادر CREATE TABLE الأصلية للجداول الأساسية: `001_initial_foundation.sql` للشحنات/التاريخ/المنافيست/التسليم، `035_shipment_inventory_movements.sql` للمخزون، `037_shipment_labels.sql` للملصقات، `045_center_receipts.sql` للاستلام المركزي، `074_daily_shipment_ledger.sql` للجلسات والأسطر، `092_daily_ledger_row_transfers.sql` للنقل، `093_daily_ledger_print_tracking.sql` لأحداث الطباعة، `109_daily_ledger_print_documentation.sql` لمستندات الطباعة، `110_daily_ledger_dispatch_definitions.sql` لتعريفات الإرسال، و`111_daily_ledger_dispatch_save_logs.sql` للسجل غير المطبق. لأن ترحيلات لاحقة عدلت الأعمدة والقيود، فإن قاموس القسم 4 هو ناتج الكتالوج الحي المكافئ لـ `\d+` وليس نسخة قديمة من CREATE الأولي.

## 13. حدود الإثبات

- row counts والحالات والصلاحيات والمخطط هي حقائق اللقطة الحية في التاريخ أعلى الوثيقة.
- لم تُجر اختبارات كتابة متزامنة فعلية لأن القيد كان read-only؛ آليات التزامن موثقة من SQL الفعلي والقيود الحية.
- لم توجد بيانات manifests/deliveries/center receipts/labels/inventory movements حية، لذلك تسلسلها موثق من الكود والقيود لا من عينة صفوف تشغيلية.
- لا توجد بيانات كافية لحساب معدل يومي/شهري اعتيادي، ولا يوجد event stream كامل يقيس كل field-level change.
- لم تُقرأ أو تُعرض أي أسرار اتصال في هذه الوثيقة.

---

**نتيجة التدقيق:** تم توثيق المخطط الحي، كل الحقول الداخلة في النطاق، العلاقات والقيود والتوليد، مسارات الكتابة، ترتيب عمليات الحفظ وحدود المعاملات، التزامن والحفظ المحلي، حجم البيانات، الصلاحيات والنطاق الجغرافي، مع فصل الحقائق الحية عن السلوك المستنتج مباشرة من الكود ووسم نقاط عدم الاتساق وعدم الوضوح.
