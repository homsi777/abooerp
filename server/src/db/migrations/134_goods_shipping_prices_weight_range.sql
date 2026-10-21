-- 134_goods_shipping_prices_weight_range.sql
-- طلب الإدارة: بدل وزن منفرد، تسعير حسب نطاق وزن (من-إلى) — مثال: من 1 كغ
-- إلى 50 كغ = 5$. تستبدل weight_kg تماماً؛ عدد الطرود (parcel_count) يبقى
-- كما هو كخيار بديل مستقل لا علاقة له بهذا التغيير.

alter table goods_shipping_prices
  add column if not exists weight_from_kg numeric(12, 2),
  add column if not exists weight_to_kg numeric(12, 2);

alter table goods_shipping_prices drop constraint if exists goods_shipping_prices_weight_range_check;
alter table goods_shipping_prices
  add constraint goods_shipping_prices_weight_range_check
  check (
    (weight_from_kg is null and weight_to_kg is null)
    or (weight_from_kg is not null and weight_to_kg is not null and weight_to_kg >= weight_from_kg)
  );

-- ترحيل القيم القديمة: وزن منفرد سابق يصبح نطاقاً من نفس القيمة إلى نفسها.
update goods_shipping_prices
set weight_from_kg = weight_kg, weight_to_kg = weight_kg
where weight_kg is not null and weight_from_kg is null;

alter table goods_shipping_prices drop column if exists weight_kg;
