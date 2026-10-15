# BiteStream — Assignment 2

BiteStream is a web interface for the inherited Assignment 1 PostgreSQL and MongoDB backend.


## 1. What is included?

- **Browse:** search and paginate users, restaurants and orders.
- **Checkout:** place an order through the PostgreSQL checkout procedure and show the wallet change.
- **Wallet Audit Trail:** search a customer, filter by dates and view wallet audit records.
- **Analytics:** seven-day revenue moving average, `DENSE_RANK()` leaderboard and materialized-view summary.
- **Driver Proximity:** find recent driver pings within 5 km using MongoDB `$geoNear`.
- **Reviews & Menus:** show review statistics using MongoDB `$facet` and display menu catalog data.

## 2. Requirements

Install or have available:

- Node.js and npm
- PostgreSQL
- MongoDB (the project can use the `bitestream-mongodb` Docker container)
- Python 3 and `venv` (needed only for seeding or refreshing sample driver pings)

## 3. Run the existing project

These steps are for a machine where the BiteStream database has already been created and seeded.

### Step 1 — Start the databases

```bash
sudo systemctl start postgresql
sudo docker start bitestream-mongodb
```

If MongoDB is installed directly instead of Docker, start that MongoDB service instead.

### Step 2 — Configure the API

```bash
cd ./api
cp .env.example .env
```

Open `api/.env` and make sure `PGDATABASE`, `PGUSER`, `MONGO_URI` and `MONGO_DATABASE` match your local databases. The default PostgreSQL settings use the local Unix socket and database `bitestream`.

### Step 3 — Install and start the API

```bash
npm install
npm start
```

Keep this terminal open. The API also serves the frontend.

### Step 4 — Open the website

Open this address in your browser:

http://localhost:3001

## 4. Important database change in this project

The Assignment 1 backend was inherited from another teams. We kept its PostgreSQL and MongoDB workflow scripts and added the API and browser interface for Assignment 2.

The Assignment 2 version also restores the required rule that a customer can have only one active order (`PREPARING` or `DELIVERING`) at a time. This is enforced by the partial unique index `idx_active_user_order`.

If you are using an **existing database**, apply the migration once from the project root:

```bash
sudo -u postgres psql -d bitestream -v ON_ERROR_STOP=1 -f sql/09_restore_active_order_rule.sql
```

This migration needs PostgreSQL administrator/owner permissions. It keeps the newest active order for each customer and changes any additional active orders to `DELIVERED` so the index can be created. Review this effect before running it on data you need to preserve.

After the migration, restart the API. During the demo, checkout should reject a second active order with a clear message. Once the first order is marked `DELIVERED`, the customer can place another order if their wallet has enough funds.

The API also checks for an existing active order before calling the checkout procedure, so the frontend can show the friendly message even if the database migration has not yet been applied. The partial unique index is still required to protect against simultaneous requests.

The active-order check treats status values case-insensitively and ignores surrounding whitespace. If checkout still rejects a customer whose last order is `DELIVERED`, check **all** orders for that customer's UUID: another order for the same customer may still be `PREPARING` or `DELIVERING`. Use the diagnostic query below (replace the placeholder UUID):

```sql
SELECT id, user_id, status, created_at
FROM public.orders
WHERE user_id = 'REPLACE-WITH-CUSTOMER-UUID'::uuid
ORDER BY created_at DESC;
```

Only `PREPARING` and `DELIVERING` block another checkout; `DELIVERED` orders do not. Apply migration `09_restore_active_order_rule.sql` as shown above and restart the API from this project folder.


To verify the rule in PostgreSQL, run:

```bash
psql -d bitestream -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_active_user_order';"
psql -d bitestream -c "SELECT id, user_id, status, created_at FROM orders WHERE status IN ('PREPARING', 'DELIVERING') ORDER BY created_at DESC LIMIT 20;"
```

After replacing the project files, stop the old API (`Ctrl+C`), start the API from this extracted v11 folder, and refresh the browser with `Ctrl+Shift+R`. If the old API process or a different project folder is still running, the change will not be used.

Do **not** run `sql/07_allow_multiple_active_orders.sql` or `sql/08_fix_active_order_checkout.sql`; those are deprecated compatibility files and do not apply the fix.

## 5. Backend changes made for Assignment 2

Compared with the inherited Assignment 1 files, this project adds or updates the following:

- **New API layer (`api/server.js`):** connects the browser to PostgreSQL and MongoDB and exposes endpoints for browsing, checkout, audit records, analytics, driver proximity, reviews and menus.
- **Input validation (`api/lib/validation.js`):** validates UUIDs, pagination values and checkout input.
- **Checkout integration:** calls the inherited PostgreSQL stored procedure and returns a readable success/failure result to the frontend.
- **Active-order rule (`sql/09_restore_active_order_rule.sql`):** restores the partial unique index and updates the procedure to report `ACTIVE_ORDER_EXISTS` for that specific conflict.
- **Driver location support:** includes a driver-ping refresh script for local demo data.
- **Frontend integration:** serves the pages from the API and uses the endpoints above; it does not load all users or orders into the browser at once.

The original schema, seeders, MongoDB workflows, triggers, materialized view and analytics SQL remain in the project. Changes to the inherited database should be recorded here when more are made.

## 6. Refresh driver pings (only if the map has no nearby drivers)

From the project root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r data_generation/requirements.txt
.venv/bin/python data_generation/refresh_driver_pings.py
```

Make sure the script's MongoDB connection matches `api/.env`. Refresh the browser after the script completes.

## 7. Tests

From the `api` directory:

```bash
npm test
```

Check the API/database connection by opening:

http://localhost:3001/api/health

## 8. Fresh database setup

Only use this section if you are setting up an **empty database for the first time**. Do not re-run seeders on a database that already contains data.

1. Create the `bitestream` PostgreSQL database and make sure your local PostgreSQL user can connect.
2. From the project root, run the SQL files in this order:

```bash
psql -d bitestream -f sql/01_schema_ddl.sql
psql -d bitestream -f sql/03_triggers_and_audit.sql
psql -d bitestream -f sql/04_stored_procedures.sql
psql -d bitestream -f sql/05_materialized_views.sql
psql -d bitestream -f sql/02_indexes.sql
psql -d bitestream -f sql/06_window_analytics.sql
```

3. Start MongoDB and make sure `mongosh` can connect to it.
4. Install Python dependencies and generate the shared reference data:

```bash
python3 -m venv .venv
.venv/bin/pip install -r data_generation/requirements.txt
.venv/bin/python data_generation/generate_reference_data.py
```

5. Create MongoDB collections and indexes:

```bash
mongosh bitestream --file mongo/01_collections_and_indexes.js
```

6. Seed PostgreSQL and MongoDB using the same generated reference data:

```bash
.venv/bin/python data_generation/postgres_seeder.py
.venv/bin/python data_generation/mongo_seeder.py
```

7. Apply the Assignment 2 active-order migration:

```bash
sudo -u postgres psql -d bitestream -v ON_ERROR_STOP=1 -f sql/09_restore_active_order_rule.sql
```

8. Follow Steps 2–4 in **Run the existing project** to configure and start the web app.


## Submission Information

- **GitHub repository:** :-https://github.com/Ajay-Singh-Jhala/Team17_a1b.git
- **Final commit hash:** ## Commit Hashes

| Contributor | Work | Commit Hash |
|---|---|---|
| dudekulamahammad | Documentation, SQL, README | [16d3b3a](https://github.com/Ajay-Singh-Jhala/Team17_a1b/commit/16d3b3a20c862af64fa7fc32c93797c76663279a) |
| dudekulamahammad | Seed updates | [150cc00](https://github.com/Ajay-Singh-Jhala/Team17_a1b/commit/150cc005a40d2ba259dae960377ff524ada91337) |
| Ajay-Singh-Jhala | MongoDB, data generation, API, web | [3e17ef3](https://github.com/Ajay-Singh-Jhala/Team17_a1b/commit/3e17ef35df0e374960cfb7f6ec9a36fb12ed9cb9) |

- **Demo video:**:https://drive.google.com/file/d/192U-3PwXlJ0JdOkp4xgOP_F0NWVKt0Lg/view?usp=drive_link

## Screenshots

Screenshots are stored in `docs/screenshots/`.

![screenshort/Screenshot From 2026-10-15 18-11-14.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-14.png)

![screenshort/Screenshot From 2026-10-15 18-11-17.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-17.png)

![screenshort/Screenshot From 2026-10-15 18-11-20.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-20.png)

![screenshort/Screenshot From 2026-10-15 18-11-24.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-24.png)

![screenshort/Screenshot From 2026-10-15 18-11-31.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-31.png)

![screenshort/Screenshot From 2026-10-15 18-11-35.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-35.png)

![screenshort/Screenshot From 2026-10-15 18-11-44.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-44.png)

![screenshort/Screenshot From 2026-10-15 18-11-53.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-53.png)

![screenshort/Screenshot From 2026-10-15 18-11-10.png](docs/screenshots/screenshort/Screenshot From 2026-10-15 18-11-10.png)

## Team Members
*Name* : Dudekula Mahammad  Roll_NO:2026202016
*Name* : Ajay singh jhala   Roll_NO:2026201030
*Name* : Pragyan Parida     Roll_No:
