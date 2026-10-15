WITH daily_revenue AS (
    -- Collapse orders to one row per restaurant per day.
    SELECT
        o.restaurant_id,
        o.created_at::DATE                  AS order_date,
        SUM(o.total_amount)                 AS daily_revenue,
        COUNT(*)                            AS daily_orders
    FROM orders o
    WHERE o.status = 'DELIVERED'
    GROUP BY o.restaurant_id, o.created_at::DATE
),

date_spine AS (
    -- Every (restaurant, day) pair in the active window, so days with
    -- zero sales still occupy a slot in the moving average.
    SELECT r.id AS restaurant_id, d.order_date
    FROM restaurants r
    CROSS JOIN generate_series(
        (SELECT MIN(order_date) FROM daily_revenue),
        (SELECT MAX(order_date) FROM daily_revenue),
        INTERVAL '1 day'
    ) AS d(order_date)
),

filled AS (
    SELECT
        s.restaurant_id,
        s.order_date::DATE                          AS order_date,
        COALESCE(dr.daily_revenue, 0.00)            AS daily_revenue,
        COALESCE(dr.daily_orders, 0)                AS daily_orders
    FROM date_spine s
    LEFT JOIN daily_revenue dr
           ON dr.restaurant_id = s.restaurant_id
          AND dr.order_date    = s.order_date::DATE
),

moving AS (
    SELECT
        f.restaurant_id,
        f.order_date,
        f.daily_revenue,
        f.daily_orders,

        -- 7-day trailing window: today plus the 6 preceding days.
        ROUND(AVG(f.daily_revenue) OVER w7, 2)      AS moving_avg_7d,
        SUM(f.daily_revenue)       OVER w7          AS rolling_sum_7d,

        -- Running total since the restaurant's first day.
        SUM(f.daily_revenue) OVER (
            PARTITION BY f.restaurant_id
            ORDER BY f.order_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                           AS cumulative_revenue,

        -- Day-over-day delta.
        f.daily_revenue - LAG(f.daily_revenue) OVER (
            PARTITION BY f.restaurant_id ORDER BY f.order_date
        )                                           AS delta_vs_prev_day

    FROM filled f
    WINDOW w7 AS (
        PARTITION BY f.restaurant_id
        ORDER BY f.order_date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    )
),

lifetime AS (
    -- One row per restaurant; DENSE_RANK over the whole set.
    SELECT
        restaurant_id,
        SUM(daily_revenue)  AS lifetime_revenue,
        SUM(daily_orders)   AS lifetime_orders,
        DENSE_RANK() OVER (ORDER BY SUM(daily_revenue) DESC) AS revenue_rank,
        DENSE_RANK() OVER (ORDER BY SUM(daily_orders)  DESC) AS volume_rank
    FROM filled
    GROUP BY restaurant_id
)

SELECT
    r.name                  AS restaurant,
    m.order_date,
    m.daily_revenue,
    m.moving_avg_7d,
    m.cumulative_revenue,
    m.delta_vs_prev_day,
    l.lifetime_revenue,
    l.revenue_rank
FROM moving m
JOIN lifetime  l ON l.restaurant_id = m.restaurant_id
JOIN restaurants r ON r.id = m.restaurant_id
WHERE l.revenue_rank <= 10                    -- top venues only
ORDER BY l.revenue_rank, m.order_date;