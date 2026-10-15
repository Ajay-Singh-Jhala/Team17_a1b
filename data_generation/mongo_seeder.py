import json
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pymongo import MongoClient


MONGO_URI = os.getenv(
    "MONGO_URI",
    "mongodb://localhost:27017"
)

DATABASE_NAME = os.getenv(
    "MONGO_DATABASE",
    "bitestream"
)

REFERENCE_FILE = (
    Path(__file__).parent / "seed_reference.json"
)

# Collection names. Keep these identical to the ones used in
# 01_collections_and_indexes.js — an index built on "DriverPings" does
# nothing for a collection named "driverpings".
MENUS_COLLECTION = "Menus"
REVIEWS_COLLECTION = "Reviews"
PINGS_COLLECTION = "DriverPings"

# The TTL index field. Must match 01_collections_and_indexes.js exactly:
#   db.DriverPings.createIndex({ created_at: 1 }, { expireAfterSeconds: 7200 })
# A TTL index on created_at will never expire a document that stores
# created_at instead, and Mongo gives no warning about the mismatch.
PING_TIME_FIELD = "created_at"

NUM_REVIEWS = 100_000
NUM_DRIVER_PINGS = 500_000
BATCH_SIZE = 5_000

# Pings are written between 0 and this many minutes in the past. The TTL
# index expires them at 120 minutes, so a small window buys demo runway:
# at 20, the oldest ping survives ~100 more minutes after seeding.
# Setting this near 110 means documents start disappearing within
# minutes of the seeder finishing.
PING_AGE_MINUTES = 20

# Jitter around a driver's home base, in degrees. 0.01 deg is roughly
# 1.1 km at Chennai's latitude.
PING_JITTER_DEG = 0.01

SEED = 42

rng = random.Random(SEED)


POSITIVE_TAGS = [
    "positive",
    "food-quality",
    "taste",
    "fast-delivery",
    "well-packaged",
    "value-for-money"
]

NEGATIVE_TAGS = [
    "negative",
    "late-delivery",
    "cold-food",
    "overpriced",
    "rude-service",
    "wrong-order"
]

NEUTRAL_TAGS = [
    "portion-size",
    "packaging",
    "service"
]


def load_reference_data():

    with open(
        REFERENCE_FILE,
        "r",
        encoding="utf-8"
    ) as f:
        return json.load(f)


def generate_menus(restaurants):

    menus = []

    for restaurant in restaurants:

        categories = []

        for category_number in range(3):

            items = []

            for item_number in range(8):

                addons = [
                    {
                        "addonId": "ADD001",
                        "name": "Extra Cheese",
                        "price": 40.00
                    },
                    {
                        "addonId": "ADD002",
                        "name": "Extra Sauce",
                        "price": 20.00
                    }
                ]

                items.append({
                    "itemId": (
                        f"ITEM-{category_number + 1}-"
                        f"{item_number + 1}"
                    ),
                    "name": (
                        f"Item {category_number + 1}-"
                        f"{item_number + 1}"
                    ),
                    "description": (
                        "Freshly prepared food item"
                    ),
                    "price": round(
                        rng.uniform(100, 600),
                        2
                    ),
                    "available": (
                        rng.random() < 0.9
                    ),
                    "customizationAddons": addons
                })

            categories.append({
                "categoryId": f"CAT{category_number + 1:03d}",
                "name": f"Category {category_number + 1}",
                "items": items
            })

        menus.append({
            "restaurantId": restaurant["id"],
            "restaurantName": restaurant["name"],
            "categories": categories,
            "updatedAt": datetime.now(timezone.utc)
        })

    return menus


def tags_for_rating(rating):
    """
    Tags are drawn to match the rating so that the $facet output is
    coherent: a 5-star review tagged 'rude-service' makes the tag
    frequency breakdown meaningless as evidence.
    """
    if rating >= 4:
        pool = POSITIVE_TAGS + NEUTRAL_TAGS
    elif rating <= 2:
        pool = NEGATIVE_TAGS + NEUTRAL_TAGS
    else:
        pool = NEUTRAL_TAGS + rng.sample(POSITIVE_TAGS, 2) \
            + rng.sample(NEGATIVE_TAGS, 2)

    return rng.sample(pool, rng.randint(1, 3))


def generate_reviews(reference_data):
    """
    Yielded rather than returned as a list: 100k review dicts held in
    memory at once is avoidable, and the batch inserter streams anyway.
    """
    restaurants = reference_data["restaurants"]
    users = reference_data["users"]

    now = datetime.now(timezone.utc)

    for _ in range(NUM_REVIEWS):

        restaurant = rng.choice(restaurants)
        user = rng.choice(users)

        # Skewed toward positive, as real review distributions are.
        rating = rng.choices(
            [1, 2, 3, 4, 5],
            weights=[8, 10, 17, 30, 35]
        )[0]

        yield {
            "restaurantId": restaurant["id"],
            "userId": user["id"],
            "rating": rating,
            "reviewText": (
                f"Sample review with rating {rating}"
            ),
            "sentimentTags": tags_for_rating(rating),
            "created_at": (
                now
                - timedelta(
                    days=rng.randint(0, 90),
                    minutes=rng.randint(0, 1439)
                )
            )
        }


def generate_driver_pings(reference_data):
    """
    Each ping is jittered around its own driver's home base, not around
    a randomly chosen restaurant. Anchoring to restaurants meant one
    driver emitted pings from opposite ends of the city, so 'nearest
    active driver' had no stable answer.

    The active flag comes from the driver record rather than being
    re-rolled per ping, for the same reason: a driver cannot be online
    and offline at the same moment.
    """
    drivers = reference_data["drivers"]

    now = datetime.now(timezone.utc)

    for _ in range(NUM_DRIVER_PINGS):

        driver = rng.choice(drivers)

        latitude = (
            driver["home_latitude"]
            + rng.uniform(-PING_JITTER_DEG, PING_JITTER_DEG)
        )

        longitude = (
            driver["home_longitude"]
            + rng.uniform(-PING_JITTER_DEG, PING_JITTER_DEG)
        )

        yield {
            "driverId": driver["id"],

            # GeoJSON order is [longitude, latitude] — the reverse of
            # how coordinates are usually spoken.
            "location": {
                "type": "Point",
                "coordinates": [
                    round(longitude, 6),
                    round(latitude, 6)
                ]
            },

            "active": driver["is_active"],

            PING_TIME_FIELD: (
                now
                - timedelta(
                    seconds=rng.randint(0, PING_AGE_MINUTES * 60)
                )
            )
        }


def insert_in_batches(collection, documents, label=None):

    label = label or collection.name

    batch = []
    total = 0

    for document in documents:

        batch.append(document)

        if len(batch) >= BATCH_SIZE:

            collection.insert_many(
                batch,
                ordered=False
            )

            total += len(batch)

            print(
                f"{label}: "
                f"{total:,} inserted"
            )

            batch.clear()

    if batch:

        collection.insert_many(
            batch,
            ordered=False
        )

        total += len(batch)

    return total


def verify_data(db):

    pings = db[PINGS_COLLECTION]

    print()
    print("MongoDB verification")
    print("------------------------")
    print(f"Menus:       {db[MENUS_COLLECTION].count_documents({}):,}")
    print(f"Reviews:     {db[REVIEWS_COLLECTION].count_documents({}):,}")
    print(f"DriverPings: {pings.count_documents({}):,}")

    active = pings.count_documents({"active": True})
    print(f"  active:    {active:,}")

    distinct_drivers = len(pings.distinct("driverId"))
    print(f"  drivers:   {distinct_drivers:,}")

    oldest = pings.find_one(sort=[(PING_TIME_FIELD, 1)])
    if oldest:
        age = datetime.now(timezone.utc) - oldest[PING_TIME_FIELD].replace(
            tzinfo=timezone.utc
        )
        remaining = 7200 - age.total_seconds()
        print(
            f"  oldest ping expires in ~{remaining / 60:.0f} min "
            f"(TTL 7200s)"
        )

    indexes = list(pings.list_indexes())
    has_2dsphere = any(
        "2dsphere" in str(ix.get("key", {})) for ix in indexes
    )
    has_ttl = any("expireAfterSeconds" in ix for ix in indexes)
    print(f"  2dsphere index present: {has_2dsphere}")
    print(f"  TTL index present:      {has_ttl}")


def main():

    reference_data = load_reference_data()

    client = MongoClient(MONGO_URI)

    db = client[DATABASE_NAME]

    print("Starting MongoDB seeding...")

    menus = generate_menus(
        reference_data["restaurants"]
    )

    if menus:
        db[MENUS_COLLECTION].insert_many(
            menus,
            ordered=False
        )

    print(f"Menus inserted: {len(menus):,}")

    total_reviews = insert_in_batches(
        db[REVIEWS_COLLECTION],
        generate_reviews(reference_data),
        label=REVIEWS_COLLECTION
    )

    print(f"Reviews inserted: {total_reviews:,}")

    total_pings = insert_in_batches(
        db[PINGS_COLLECTION],
        generate_driver_pings(reference_data),
        label=PINGS_COLLECTION
    )

    print(f"DriverPings inserted: {total_pings:,}")

    verify_data(db)

    client.close()

    print("\nMongoDB seeding completed.")


if __name__ == "__main__":
    main()
