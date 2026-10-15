use("bitestream");
// Input supplied by the application layer
const restaurantLatitude = 13.0827;
const restaurantLongitude = 80.2707;
const result = db.DriverPings.aggregate([{
  $geoNear: {
    near: {
      type: "Point", coordinates: [restaurantLongitude, restaurantLatitude ]
    }, key: "location", distanceField: "distanceFromRestaurant", maxDistance: 5000, spherical: true, query: {
      active: true
    }
  }
}, {
  $limit: 1
}, {
  $project: {
    _id: 0, driverId: 1, location: 1, active: 1, distanceFromRestaurant: 1
  }
} ]).toArray();
printjson(result);
