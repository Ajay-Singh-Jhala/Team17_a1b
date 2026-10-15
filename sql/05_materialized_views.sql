-- materialized view for restaurants
CREATE MATERIALIZED VIEW MV_RESTAURANT_PERFORMANCE AS
SELECT
	R.ID AS RESTAURANT_ID,
	R.NAME AS RESTAURANT_NAME,
	R.LATITUDE,
	R.LONGITUDE,
	COUNT(O.ID) AS COMPLETED_ORDERS,
	COALESCE(SUM(O.TOTAL_AMOUNT), 0.00)::DECIMAL(12, 2) AS TOTAL_REVENUE,
	COALESCE(AVG(O.TOTAL_AMOUNT), 0.00)::DECIMAL(10, 2) AS AVG_ORDER_VALUE,
	MAX(O.CREATED_AT) AS LAST_COMPLETED_AT
FROM
	RESTAURANTS R
	LEFT JOIN ORDERS O ON O.RESTAURANT_ID = R.ID
	AND O.STATUS = 'DELIVERED'
GROUP BY
	R.ID,
	R.NAME,
	R.LATITUDE,
	R.LONGITUDE
WITH
	DATA;

-- CONCURRENTLY is illegal on a never-populated view, so fall back.
CREATE OR REPLACE FUNCTION refresh_restaurant_performance(
    p_concurrent BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (refreshed_at TIMESTAMPTZ, duration_ms NUMERIC, mode TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_start   TIMESTAMPTZ := clock_timestamp();
    v_is_pop  BOOLEAN;
BEGIN
    SELECT ispopulated INTO v_is_pop
      FROM pg_matviews
     WHERE matviewname = 'mv_restaurant_performance';

    IF p_concurrent AND COALESCE(v_is_pop, FALSE) THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_restaurant_performance;
        mode := 'CONCURRENT';
    ELSE
        REFRESH MATERIALIZED VIEW mv_restaurant_performance;
        mode := 'BLOCKING';
    END IF;

    refreshed_at := clock_timestamp();
    duration_ms  := ROUND(EXTRACT(EPOCH FROM (refreshed_at - v_start)) * 1000, 2);
    RETURN NEXT;
END;
$$;

-- first time
REFRESH MATERIALIZED VIEW MV_RESTAURANT_PERFORMANCE; 

-- use concurrently from second time;