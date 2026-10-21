alter table goods_shipping_prices add column if not exists weight_kg numeric(12, 2);

update goods_shipping_prices
set weight_kg = weight_from_kg
where weight_from_kg is not null and weight_kg is null;

alter table goods_shipping_prices drop constraint if exists goods_shipping_prices_weight_range_check;
alter table goods_shipping_prices
  drop column if exists weight_from_kg,
  drop column if exists weight_to_kg;
