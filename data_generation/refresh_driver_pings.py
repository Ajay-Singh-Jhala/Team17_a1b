"""Refresh only the demo DriverPings collection for the proximity map.

The assignment's TTL index expires driver pings after two hours. This helper
recreates the 500,000 sample pings with fresh timestamps without touching the
Menus or Reviews collections.

Run from the project root:
    python3 data_generation/refresh_driver_pings.py
"""

from pymongo import MongoClient

from generate_reference_data import main as generate_reference_data
from mongo_seeder import (
    DATABASE_NAME,
    MONGO_URI,
    PINGS_COLLECTION,
    REFERENCE_FILE,
    generate_driver_pings,
    insert_in_batches,
    load_reference_data,
    verify_data,
)


def main():
    if not REFERENCE_FILE.exists():
        print("Reference data is missing; generating it first...")
        generate_reference_data()

    reference_data = load_reference_data()
    client = MongoClient(MONGO_URI)
    database = client[DATABASE_NAME]
    pings = database[PINGS_COLLECTION]

    print(f"Refreshing {DATABASE_NAME}.{PINGS_COLLECTION}...")
    print("Only DriverPings will be cleared; Menus and Reviews are unchanged.")
    pings.delete_many({})

    pings.create_index(
        [("location", "2dsphere")],
        name="idx_driverpings_location_2dsphere",
    )
    pings.create_index(
        [("created_at", 1)],
        expireAfterSeconds=7200,
        name="idx_driverpings_created_at_ttl",
    )

    total = insert_in_batches(
        pings,
        generate_driver_pings(reference_data),
        label=PINGS_COLLECTION,
    )
    print(f"Fresh driver pings inserted: {total:,}")
    verify_data(database)
    client.close()
    print("Driver proximity data refreshed. Reopen Driver Proximity in the app.")


if __name__ == "__main__":
    main()
