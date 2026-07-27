-- فهرس لتسريع التحقق من تكرار رقم الإيصال في الدفتر اليومي
create index if not exists idx_daily_ledger_rows_receipt_no_norm
  on daily_ledger_rows (lower(trim(receipt_no)))
  where deleted_at is null and coalesce(trim(receipt_no), '') <> '';
