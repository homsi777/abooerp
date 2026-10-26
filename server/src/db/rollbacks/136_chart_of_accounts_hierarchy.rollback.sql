-- Manual rollback for 136_chart_of_accounts_hierarchy.sql. Does NOT remove
-- the 5 seeded group accounts (1000/1400/2000/4000/5000) or revert the
-- re-parenting of the original 14 accounts under them — a real deployment
-- may already have live children under those groups by the time this is
-- considered, and silently detaching them would orphan data. Drop those by
-- hand, deliberately, only if truly needed.
drop trigger if exists trg_journal_entry_lines_postable on journal_entry_lines;
drop function if exists fn_journal_entry_lines_postable_check();
alter table chart_of_accounts drop constraint if exists chk_control_is_postable;
alter table chart_of_accounts drop column if exists is_postable;
