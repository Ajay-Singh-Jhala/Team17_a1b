-- Assignment 2 migration: restore the required one-active-order-per-user rule.
-- Run as the PostgreSQL owner/superuser because the existing procedure/index may
-- be owned by postgres:
--   sudo -u postgres psql -d bitestream -v ON_ERROR_STOP=1 -f sql/09_restore_active_order_rule.sql
-- If a customer has multiple active orders from earlier testing, keep the newest
-- active order and mark older active orders DELIVERED before creating the index.

BEGIN;

WITH ranked_active_orders AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id
               ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM orders
    WHERE status IN ('PREPARING', 'DELIVERING')
)
UPDATE orders AS o
SET status = 'DELIVERED'
FROM ranked_active_orders AS r
WHERE o.id = r.id
  AND r.rn > 1;

DROP INDEX IF EXISTS public.idx_active_user_order;
CREATE UNIQUE INDEX idx_active_user_order
    ON public.orders (user_id)
    WHERE status IN ('PREPARING', 'DELIVERING');

CREATE OR REPLACE PROCEDURE public.sp_execute_checkout(
    p_user_id UUID,
    p_restaurant_id UUID,
    p_total_amount DECIMAL(10,2),
    INOUT p_order_id UUID DEFAULT NULL,
    INOUT p_result TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_constraint TEXT;
    v_message TEXT;
BEGIN
    p_order_id := NULL;
    p_result := NULL;

    -- Required by the inherited procedure contract: the CALL must be issued
    -- outside an explicit transaction block.
    COMMIT;
    SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

    BEGIN
        IF p_total_amount IS NULL OR p_total_amount <= 0 THEN
            RAISE EXCEPTION 'Order amount must be positive, got %', p_total_amount
                USING ERRCODE = 'invalid_parameter_value';
        END IF;

        UPDATE public.users
           SET wallet_balance = wallet_balance - p_total_amount
         WHERE id = p_user_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'User % does not exist', p_user_id
                USING ERRCODE = 'no_data_found';
        END IF;

        INSERT INTO public.orders (user_id, restaurant_id, total_amount, status)
        VALUES (p_user_id, p_restaurant_id, p_total_amount, 'PREPARING')
        RETURNING id INTO p_order_id;

        p_result := 'SUCCESS';
    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            p_order_id := NULL;
            p_result := CASE
                WHEN v_constraint IN ('chk_users_wallet_balance', 'chk_wallet_audit_balance')
                    THEN 'INSUFFICIENT_FUNDS'
                ELSE 'CHECK_VIOLATION: ' || COALESCE(v_constraint, 'unknown')
            END;
        WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            p_order_id := NULL;
            p_result := CASE
                WHEN v_constraint = 'idx_active_user_order' THEN 'ACTIVE_ORDER_EXISTS'
                ELSE 'UNIQUE_CONSTRAINT_VIOLATION'
            END;
        WHEN foreign_key_violation THEN
            p_order_id := NULL;
            p_result := 'INVALID_REFERENCE';
        WHEN no_data_found OR invalid_parameter_value THEN
            GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
            p_order_id := NULL;
            p_result := 'INVALID_REQUEST: ' || v_message;
    END;

    IF p_result = 'SUCCESS' THEN
        COMMIT;
    ELSE
        ROLLBACK;
    END IF;
END;
$$;

COMMIT;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'orders'
  AND indexname = 'idx_active_user_order';
