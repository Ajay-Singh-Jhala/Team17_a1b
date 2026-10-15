-- Deprecated: this migration disabled an Assignment 2 requirement.
-- Do not run it. Restore the required partial unique index and checkout behavior with:
--   sudo -u postgres psql -d bitestream -v ON_ERROR_STOP=1 -f sql/09_restore_active_order_rule.sql
SELECT 'Deprecated migration; use sql/09_restore_active_order_rule.sql' AS notice;
