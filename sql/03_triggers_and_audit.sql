
CREATE OR REPLACE FUNCTION audit_wallet_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_delta DECIMAL(10,2);
BEGIN
    v_delta := NEW.wallet_balance - OLD.wallet_balance;

    -- created_at uses clock_timestamp(): the column default NOW() is the
    -- transaction start, so rows written in one transaction (e.g. the seeder)
    -- shared one timestamp and the audit running total could not be ordered.
    INSERT INTO wallet_audit_logs
           (user_id, amount_changed, action_type, balance_after, created_at)
    VALUES (
        NEW.id,
        ABS(v_delta),
        CASE WHEN v_delta < 0 THEN 'DEBIT' ELSE 'CREDIT' END,
        NEW.wallet_balance,
        clock_timestamp()
    );

    RETURN NULL;   -- AFTER trigger; return value is ignored
END;
$$;

CREATE OR REPLACE TRIGGER trg_users_wallet_audit
AFTER UPDATE OF wallet_balance ON users
FOR EACH ROW
WHEN (OLD.wallet_balance IS DISTINCT FROM NEW.wallet_balance)
EXECUTE FUNCTION audit_wallet_balance();

-- make audit wallet logs immutable
CREATE OR REPLACE FUNCTION block_audit_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'wallet_audit_logs is append-only; % rejected', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER trg_audit_no_update
BEFORE UPDATE OR DELETE ON wallet_audit_logs
FOR EACH ROW
EXECUTE FUNCTION block_audit_update();
