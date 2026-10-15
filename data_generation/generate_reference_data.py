import json
import random
import uuid
from pathlib import Path

NUM_USERS = 20_000
NUM_RESTAURANTS = 100
NUM_DRIVERS = 1_000

# Chennai approximate center
CENTER_LAT = 13.0827
CENTER_LON = 80.2707

# Roughly +/- 9 km box around the centre.
SPREAD_DEG = 0.08

# Share of drivers marked available, for the Workflow 3 $geoNear filter.
ACTIVE_DRIVER_RATIO = 0.60

SEED = 42

OUTPUT_FILE = Path(__file__).parent / "seed_reference.json"

# Single seeded generator shared by every helper below. Module-level
# random.* would be reproducible too, but any imported library that
# touches it would silently shift the sequence.
rng = random.Random(SEED)


def generate_uuid():
    """
    uuid.uuid4() reads os.urandom and ignores the seed, so it cannot be
    reproduced. Drawing the 128 bits from the seeded generator keeps the
    ids stable across runs while still producing a well-formed v4 UUID.
    """
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def random_point():
    return (
        round(CENTER_LAT + rng.uniform(-SPREAD_DEG, SPREAD_DEG), 6),
        round(CENTER_LON + rng.uniform(-SPREAD_DEG, SPREAD_DEG), 6),
    )


def main():

    users = []
    restaurants = []
    drivers = []

    # Shared users
    for i in range(NUM_USERS):
        users.append({
            "id": generate_uuid(),
            "name": f"User {i + 1}"
        })

    # Shared restaurants
    for i in range(NUM_RESTAURANTS):
        latitude, longitude = random_point()
        restaurants.append({
            "id": generate_uuid(),
            "name": f"BiteStream Restaurant {i + 1}",
            "latitude": latitude,
            "longitude": longitude
        })

    # Shared drivers. home_latitude / home_longitude give the Mongo
    # seeder a base to scatter DriverPings around, so $geoNear returns
    # clustered results instead of uniform noise. is_active is what
    # Workflow 3 filters on when looking for the nearest *active* driver.
    for i in range(NUM_DRIVERS):
        latitude, longitude = random_point()
        drivers.append({
            "id": generate_uuid(),
            "name": f"Driver {i + 1}",
            "home_latitude": latitude,
            "home_longitude": longitude,
            "is_active": rng.random() < ACTIVE_DRIVER_RATIO
        })

    all_ids = (
        [u["id"] for u in users]
        + [r["id"] for r in restaurants]
        + [d["id"] for d in drivers]
    )
    assert len(all_ids) == len(set(all_ids)), "UUID collision in reference data"

    reference_data = {
        # Lets the seeders detect that this file was regenerated with
        # different parameters after the database was already loaded.
        "meta": {
            "seed": SEED,
            "num_users": NUM_USERS,
            "num_restaurants": NUM_RESTAURANTS,
            "num_drivers": NUM_DRIVERS,
            "center": {"latitude": CENTER_LAT, "longitude": CENTER_LON}
        },
        "users": users,
        "restaurants": restaurants,
        "drivers": drivers
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(
            reference_data,
            f,
            indent=2
        )

    print(f"Reference data written to: {OUTPUT_FILE}")
    print(f"Users: {len(users)}")
    print(f"Restaurants: {len(restaurants)}")
    print(f"Drivers: {len(drivers)} "
          f"({sum(d['is_active'] for d in drivers)} active)")


if __name__ == "__main__":
    main()