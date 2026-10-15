-- Diagnose active orders for a customer.
-- Replace the UUID below with the customer's users.id from the database.
-- This query is read-only and does not modify any data.
SELECT id AS order_id, user_id, status, created_at
FROM public.orders
WHERE user_id = 'REPLACE-WITH-CUSTOMER-UUID'::uuid
ORDER BY created_at DESC;
