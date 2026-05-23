# PostgreSQL Backend Runbook

هذا الدليل يوضح طريقة تشغيل باكند المشروع مع PostgreSQL في بيئة التطوير والإنتاج، مع ترتيب الأوامر الصحيح.

## 1) المتطلبات

- PostgreSQL متاح (محلي أو خادم).
- Node.js و npm مثبتان.
- إعداد ملف بيئة للباكند (`server/.env` أو `.env` في جذر المشروع).

> ملاحظة: يمكن تحديد ملف env مخصص عبر المتغير `SERVER_ENV_FILE`.

## 2) إنشاء قاعدة البيانات (إن لزم)

إذا كانت قاعدة `PGDATABASE` غير مُنشأة بعد (ومتوفّر الاتصال بقاعدة `postgres`):

```bash
npm run server:db:ensure
```

يستعمل `PGHOST` و`PGPORT` و`PGUSER` و`PGPASSWORD` و`PGDATABASE` من البيئة.

## 3) إعداد البيئة

انسخ `server/.env.example` إلى `server/.env` وعدل القيم:

- `NODE_ENV` (`development` أو `production`)
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `PGSSL_ENABLED` (`true/false`)
- `PGSSL_REJECT_UNAUTHORIZED` (`true/false`)
- `AUTH_JWT_SECRET` (قيمة طويلة وعشوائية)

## 4) تشغيل التطوير (Development)

من جذر المشروع:

```bash
npm run server:migrate
npm run server:seed
npm run server:dev
```

النتيجة المتوقعة:
- تطبيق المايغريشن مرة واحدة لكل ملف.
- إدخال بيانات تجريبية (بما فيها مستخدم `admin`).
- تشغيل السيرفر على المنفذ المحدد في `SERVER_PORT`.

## 5) تشغيل الإنتاج (Production)

من جذر المشروع:

```bash
npm run server:build
npm run server:prod:migrate
npm run server:prod:start
```

### ملاحظات إنتاج مهمة

- `server:prod:migrate` يستخدم قفلًا (`pg_advisory_lock`) لتجنب تعارض migration عند تعدد عمليات النشر.
- seeding في الإنتاج **مغلق افتراضيًا**.  
  إذا كان هناك سبب استثنائي للتشغيل:

```bash
ALLOW_DB_SEED=true npm run server:prod:seed
```

## 6) التحقق السريع

- فحص TypeScript للباكند:

```bash
npm run server:check
```

- اختبار الاتصال يظهر في السجلات عند التشغيل:
  - `[DB] PostgreSQL connection established ...`

## 7) ممارسات أمان موصى بها

- لا تضع كلمات مرور فعلية داخل `.env.example`.
- فعّل `PGSSL_ENABLED=true` في الإنتاج.
- استخدم `PGSSL_REJECT_UNAUTHORIZED=true` مع شهادة موثوقة.
- استخدم قيمة قوية جدًا لـ `AUTH_JWT_SECRET`.
- لا تشغّل `seed` في الإنتاج إلا لحالة مدروسة ومؤقتة.
- في الإنتاج **يجب** تعيين `AUTH_JWT_SECRET` إلى قيمة عشوائية طويلة؛ السيرفر يرفض التشغيل إذا بقي القيمة الافتراضية للتطوير.
- **كاش حزمة الداشبورد المالي**: الاستجابة المجمّعة تُخزَّن مؤقتًا داخل العملية (in-process) لأداء أفضل، بينما تُسجّل **العدادات وعمليات reset** في جداول PostgreSQL. بعد إعادة التشغيل تُبنى الاستجابة من جديد لكن العدادات/السجلات تبقى.

## 8) تسلسل أوامر موصى به لأول تشغيل

1. `npm run server:db:ensure` (إن لزم)
2. `npm run server:migrate`
3. `npm run server:seed` (تطوير فقط)
4. `npm run server:dev` أو مسار الإنتاج أعلاه
