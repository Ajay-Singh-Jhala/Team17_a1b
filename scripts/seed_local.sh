#!/usr/bin/env bash
set -Eeuo pipefail

# Safe local data seeding helper. It refuses to insert duplicate data.
# Run from the project root after the PostgreSQL schema has been created.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

DB_USER="${PGUSER:-${USER:-mahammad}}"
DATABASE_URL="${DATABASE_URL:-postgresql:///bitestream?host=/var/run/postgresql&user=${DB_USER}}"
MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017}"
MONGO_DATABASE="${MONGO_DATABASE:-bitestream}"

for command_name in psql python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command '$command_name' was not found." >&2
    exit 1
  fi
done

# Prefer host mongosh; otherwise use the existing MongoDB Docker container.
MONGO_CONTAINER="${MONGO_CONTAINER:-bitestream-mongodb}"
if command -v mongosh >/dev/null 2>&1; then
  MONGO_SHELL_MODE="host"
  mongo_shell() {
    mongosh "${MONGO_URI%/}/$MONGO_DATABASE" "$@"
  }
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fxq "$MONGO_CONTAINER"; then
  MONGO_SHELL_MODE="docker"
  mongo_shell() {
    docker exec -i "$MONGO_CONTAINER" mongosh "$MONGO_DATABASE" "$@"
  }
else
  echo "Error: mongosh is not installed on the host and the MongoDB container '$MONGO_CONTAINER' is not running." >&2
  echo "Start the existing container, or install mongosh, then rerun this script." >&2
  echo "To see running containers: docker ps" >&2
  exit 1
fi

if [[ "$MONGO_DATABASE" != "bitestream" ]]; then
  echo "Error: the inherited MongoDB setup scripts target the 'bitestream' database." >&2
  echo "Set MONGO_DATABASE=bitestream and retry." >&2
  exit 1
fi

echo "Checking PostgreSQL seed targets..."
POSTGRES_COUNTS="$(psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "
  SELECT concat_ws('|',
    (SELECT COUNT(*) FROM users),
    (SELECT COUNT(*) FROM restaurants),
    (SELECT COUNT(*) FROM orders),
    (SELECT COUNT(*) FROM wallet_audit_logs)
  );
")"

if [[ "$POSTGRES_COUNTS" != "0|0|0|0" ]]; then
  echo "Refusing to seed PostgreSQL because these tables are not empty." >&2
  echo "Counts (users|restaurants|orders|wallet_audit_logs): $POSTGRES_COUNTS" >&2
  echo "No seed data was inserted. Use an empty database or handle the existing data intentionally." >&2
  exit 1
fi

echo "Checking MongoDB seed targets..."
MONGO_COUNTS="$(mongo_shell --quiet --eval \
  'JSON.stringify([db.Menus.countDocuments({}), db.Reviews.countDocuments({}), db.DriverPings.countDocuments({})])' \
  | tr -d '[:space:]')"

if [[ "$MONGO_COUNTS" != "[0,0,0]" ]]; then
  echo "Refusing to seed MongoDB because one or more target collections are not empty." >&2
  echo "Counts (Menus, Reviews, DriverPings): $MONGO_COUNTS" >&2
  echo "No seed data was inserted. Use an empty database or handle the existing data intentionally." >&2
  exit 1
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r data_generation/requirements.txt

# Both seeders consume this shared reference dataset.
echo "Generating shared reference data..."
.venv/bin/python data_generation/generate_reference_data.py

# Add MongoDB validators and indexes before inserting the documents.
echo "Creating MongoDB collections and indexes..."
if [[ "$MONGO_SHELL_MODE" == "host" ]]; then
  mongo_shell --file mongo/01_collections_and_indexes.js
else
  cat mongo/01_collections_and_indexes.js | mongo_shell
fi

echo "Seeding PostgreSQL..."
DATABASE_URL="$DATABASE_URL" .venv/bin/python data_generation/postgres_seeder.py

echo "Seeding MongoDB..."
MONGO_URI="$MONGO_URI" MONGO_DATABASE="$MONGO_DATABASE" \
  .venv/bin/python data_generation/mongo_seeder.py

echo
echo "Seeding finished. Start the dashboard with:"
echo "  cd api && cp .env.example .env && npm install && npm test && npm start"
echo "Then open http://localhost:3001."
