-- procedure sp_execute_checkout
CREATE OR REPLACE PROCEDURE sp_execute_checkout(
    p_user_id        UUID,
    p_restaurant_id  UUID,
    p_total_amount   DECIMAL(10,2),
    INOUT p_order_id UUID  DEFAULT NULL,
    INOUT p_result   TEXT  DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_constraint TEXT;
    v_message    TEXT;
BEGIN
    p_order_id := NULL;
    p_result   := NULL;

    COMMIT;                                            -- close the implicit txn
    SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;   -- now legal as stmt #1

    BEGIN
        IF p_total_amount IS NULL OR p_total_amount <= 0 THEN
            RAISE EXCEPTION 'Order amount must be positive, got %', p_total_amount
                USING ERRCODE = 'invalid_parameter_value';
        END IF;

        UPDATE users
           SET wallet_balance = wallet_balance - p_total_amount
         WHERE id = p_user_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'User % does not exist', p_user_id
                USING ERRCODE = 'no_data_found';
        END IF;

        INSERT INTO orders (user_id, restaurant_id, total_amount, status)
        VALUES (p_user_id, p_restaurant_id, p_total_amount, 'PREPARING')
        RETURNING id INTO p_order_id;

        p_result := 'SUCCESS';

    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            p_order_id := NULL;
            p_result := CASE v_constraint
                WHEN 'chk_users_wallet_balance' THEN 'INSUFFICIENT_FUNDS'
                WHEN 'chk_wallet_audit_balance' THEN 'INSUFFICIENT_FUNDS'
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
            p_result   := 'INVALID_REFERENCE';

        WHEN no_data_found OR invalid_parameter_value THEN
            GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
            p_order_id := NULL;
            p_result   := 'INVALID_REQUEST: ' || v_message;
    END;

    IF p_result = 'SUCCESS' THEN
        COMMIT;
    ELSE
        ROLLBACK;
    END IF;
END;
$$;
