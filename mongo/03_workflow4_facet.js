use("bitestream");
const restaurantId = "346c9f49-ef62-42a6-a7d9-75d42837527d";
const result = db.Reviews.aggregate([{
  $match: {
    restaurantId: restaurantId
  }
}, {
  $facet: {
    // 1. Rating distribution
    ratingDistribution: [{
      $group: {
        _id: "$rating", count: {
          $sum: 1
        }
      }
    }, {
      $sort: {
        _id: 1
      }
    }, {
      $project: {
        _id: 0, rating: "$_id", count: 1
      }
    } ], // 2. Most frequent sentiment tags
    frequentTags: [{
      $unwind: "$sentimentTags"
    }, {
      $group: {
        _id: "$sentimentTags", count: {
          $sum: 1
        }
      }
    }, {
      $sort: {
        count: -1
      }
    }, {
      $limit: 10
    }, {
      $project: {
        _id: 0, tag: "$_id", count: 1
      }
    } ], // 3. Overall average rating
    overallAverageRating: [{
      $group: {
        _id: null, averageRating: {
          $avg: "$rating"
        }, reviewCount: {
          $sum: 1
        }
      }
    }, {
      $project: {
        _id: 0, averageRating: {
          $round: ["$averageRating", 2]
        }, reviewCount: 1
      }
    } ]
  }
} ]).toArray();
printjson(result);
