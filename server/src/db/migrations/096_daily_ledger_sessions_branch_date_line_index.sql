-- فهرس آمن لاستعلامات الدفتر: branch + ledger_date + line_label (شاشة/طباعة/تصدير)
create index if not exists idx_daily_ledger_sessions_branch_date_line
  on daily_ledger_sessions(branch_id, ledger_date, line_label)
  where deleted_at is null;
