-- Assignment 2 requires the inherited partial unique index to block a
-- second active order for the same customer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_user_order
    ON orders (user_id)
    WHERE status IN ('PREPARING', 'DELIVERING');
-- check indexes
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'orders';

-- Needed by REFRESH MATERIALIZED VIEW CONCURRENTLY. Safe in any script order:
-- if the view does not exist yet, re-run this file after 05_materialized_views.sql.
DO $$
BEGIN
    IF to_regclass('public.mv_restaurant_performance') IS NULL THEN
        RAISE NOTICE 'mv_restaurant_performance not found - run 05_materialized_views.sql, then re-run 02_indexes.sql';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_restaurant_perf_id
            ON mv_restaurant_performance (restaurant_id);
        CREATE INDEX IF NOT EXISTS idx_mv_restaurant_perf_revenue
            ON mv_restaurant_performance (total_revenue DESC);
    END IF;
END $$;
