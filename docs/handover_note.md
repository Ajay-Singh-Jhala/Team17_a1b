# BiteStream handover note — Assignment 1B

## Inherited system and what was inspected

BiteStream splits transactional data between PostgreSQL (`users`, `restaurants`, `orders`, `wallet_audit_logs`) and flexible/high-volume documents in MongoDB (`Menus`, `Reviews`, `DriverPings`). The inherited SQL includes `sp_execute_checkout`, wallet audit triggers, a partial unique index that limits each user to one active order, a restaurant-performance materialized view, and a window-function analytics query. MongoDB scripts define geospatial indexes and the `$geoNear` / `$facet` workflows.

The original README documents the intended setup and seeding order: generate `seed_reference.json`, seed PostgreSQL and MongoDB, and run the SQL/Mongo scripts. In the development environment, PostgreSQL and MongoDB were started locally, the reference-data generator ran, and the schema/procedure/view scripts were applied. The original PostgreSQL seeder exposed a repeatable failure: it randomly assigned multiple `PREPARING` / `DELIVERING` orders to a user even though `idx_active_user_order` forbids this. The seeder was changed to convert later active statuses for the same user to `DELIVERED`, preserving the requested order count while respecting the index. `data_generation/requirements.txt` was also corrected to install `psycopg` v3, which the seeder imports. The PostgreSQL seeder should still be run against the final local database to verify the full seed transaction in that environment.

## What changed for Assignment 1B

- Added a small Express API in `api/` to query PostgreSQL and MongoDB.
- Added a responsive, dependency-light browser UI in `web/` for browsing, checkout, audit, analytics, driver proximity, and review/menu insights.
- Checkout calls the inherited stored procedure and then reads the wallet balance and newest audit row. Status changes update the existing order row so the active-order constraint can be demonstrated.
- Browse endpoints are paginated (maximum 100 rows per request); MongoDB results are limited and geo queries use a five-kilometre radius.
- Added API endpoint documentation, these handover notes, design/wireframe notes, and basic input-validation tests.
- Cleaned a redundant `output.p_result || output.p_result` expression in the checkout handler so it reads the procedure result directly.
- Reformatted the API, browser JavaScript, MongoDB scripts, and validation code into readable multi-line sections. The dashboard CSS was redesigned with a modern responsive layout, updated spacing/typography, dark forest navigation, mint surfaces, and lime accents.
- Changed PostgreSQL connection setup to prefer explicit `PGHOST` / `PGDATABASE` / `PGUSER` settings and use a local Unix socket by default, preventing an accidental TCP/SCRAM attempt without a password.
- Added `scripts/seed_local.sh`, which checks the PostgreSQL tables and MongoDB collections before seeding and refuses to insert duplicate data when targets are already populated.

## Known limitations / advice to original authors

1. **Procedure transaction control:** `sp_execute_checkout` contains `COMMIT` / `ROLLBACK`. Test the API call against the exact PostgreSQL version and driver in the submission environment; PostgreSQL procedures with transaction control must be invoked outside an explicit transaction block. If the call is rejected, fix the procedure/API boundary rather than bypassing the procedure.
2. **Audit semantics:** the intended trigger definition should be treated as the source of truth. Keep README statements aligned with the actual trigger SQL. Audit evidence shown by the UI is the newest log row for the selected user, so verify it matches the checkout just performed if multiple concurrent demos are running.
3. **Materialized-view refresh:** PostgreSQL 18 may require `MAINTAIN` privileges. Grant the API role the needed permission or run the refresh as an authorized role. The UI records the last successful refresh during the current API process; the schema does not persist a refresh timestamp across restarts.
4. **Geospatial data:** `$geoNear` requires a `2dsphere` index on `DriverPings.location` and valid GeoJSON coordinates in `[longitude, latitude]` order. The map is a relative proximity plot, not a street-map basemap.
5. **Seeded-data scale:** the UI intentionally limits each browse request. For a large review collection, the `$facet` aggregation can be expensive; use an appropriate restaurant filter during a live demo.
6. **Submission items:** replace the README's repository URL / commit-hash placeholders with the real GitHub URL and final commit hash. Record a short demo video and add its link; no video or repository URL is fabricated by this handover.

## Suggested demo order

1. Browse a customer and inspect the wallet balance.
2. Place a valid order and show the balance delta plus the new audit record.
3. Try a too-large amount or a second active order and show the friendly failure.
4. Change the first order to `DELIVERED`, then place another order.
5. Open the audit trail, analytics and refresh action, driver map, and reviews/menu screen.

## Bug-fix pass (after v7)
| Bug | Fix |
|---|---|
| Driver map listed the same driver many times (≈500 pings per driver, `$geoNear` + `$limit` only) | `/api/map/drivers` now sorts by `created_at`, groups by `driverId` (latest in-radius ping), then sorts by distance |
| Moving-average chart: first displayed days averaged fewer than 7 days; chart empty if data was seeded more than a week ago | Query now has 6 warm-up days and anchors to the newest DELIVERED order date |
| Chart labels one day off when the server is not in UTC (SQL `date` became a JS `Date`) | `order_date` returned as text `YYYY-MM-DD` |
| Audit running total mis-ordered: rows written in one transaction shared one `created_at` (`NOW()`) | trigger writes `clock_timestamp()` (re-run `sql/03_triggers_and_audit.sql` on existing databases) |
| Seeder produced 91,680 audit rows (< 100k) | `NUM_WALLET_UPDATES` 100k → 150k |
| Materialized view empty after seeding | seeder refreshes it at the end |
| `02_indexes.sql` failed if run before `05` (indexes on a view that doesn't exist yet) | made order-independent (`IF NOT EXISTS` + existence check) |
| Amounts above `99999999.99` / `1e21` caused a 500 (numeric overflow / exponent notation in the CALL) | validation rejects them with a 400 (+ unit tests) |
| Unstable pagination (`ORDER BY created_at` / `name` with ties) | `id` added as tie-breaker |
| README had literal `\n` characters in the feature list | fixed |

The active-order behavior has been restored for Assignment 2: `idx_active_user_order` allows at most one PREPARING/DELIVERING order per user. The checkout procedure maps that index violation to `ACTIVE_ORDER_EXISTS`, and the API displays a friendly message. For an existing database, apply `sql/09_restore_active_order_rule.sql` as `postgres`. That migration keeps the newest active order per customer and marks any older active orders DELIVERED before rebuilding the index; review this documented normalization before running on non-demo data.
