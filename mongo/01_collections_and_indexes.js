// Select database
use("bitestream");
if (!db.getCollectionNames().includes("Menus")) {
  db.createCollection("Menus");
}
if (!db.getCollectionNames().includes("Reviews")) {
  db.createCollection("Reviews");
}
if (!db.getCollectionNames().includes("DriverPings")) {
  db.createCollection("DriverPings");
}
//Validators
db.runCommand({
  collMod: "Menus", validator: {
    $jsonSchema: {
      bsonType: "object", required: ["restaurantId", "restaurantName", "categories", "updatedAt" ], properties: {
        restaurantId: {
          bsonType: "string"
        }, restaurantName: {
          bsonType: "string"
        }, categories: {
          bsonType: "array", items: {
            bsonType: "object", required: ["categoryId", "name", "items" ], properties: {
              categoryId: {
                bsonType: "string"
              }, name: {
                bsonType: "string"
              }, items: {
                bsonType: "array", items: {
                  bsonType: "object", required: ["itemId", "name", "description", "price", "available", "customizationAddons" ], properties: {
                    itemId: {
                      bsonType: "string"
                    }, name: {
                      bsonType: "string"
                    }, description: {
                      bsonType: "string"
                    }, price: {
                      bsonType: "double"
                    }, available: {
                      bsonType: "bool"
                    }, customizationAddons: {
                      bsonType: "array", items: {
                        bsonType: "object", required: ["addonId", "name", "price" ], properties: {
                          addonId: {
                            bsonType: "string"
                          }, name: {
                            bsonType: "string"
                          }, price: {
                            bsonType: "double"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }, updatedAt: {
          bsonType: "date"
        }
      }
    }
  }, validationLevel: "moderate", validationAction: "error"
});
db.Menus.createIndex({
  restaurantId: 1
}, {
  unique: true, name: "idx_menus_restaurant_unique"
} );
db.runCommand({
  collMod: "Reviews", validator: {
    $jsonSchema: {
      bsonType: "object", required: ["restaurantId", "userId", "rating", "reviewText", "sentimentTags", "created_at" ], properties: {
        restaurantId: {
          bsonType: "string"
        }, userId: {
          bsonType: "string"
        }, rating: {
          bsonType: "int", minimum: 1, maximum: 5
        }, reviewText: {
          bsonType: "string"
        }, sentimentTags: {
          bsonType: "array", items: {
            bsonType: "string"
          }
        }, created_at: {
          bsonType: "date"
        }
      }
    }
  }, validationLevel: "moderate", validationAction: "error"
});
db.Reviews.createIndex({
  restaurantId: 1, rating: 1
}, {
  name: "idx_reviews_restaurant_rating"
} );
db.Reviews.createIndex({
  sentimentTags: 1
}, {
  name: "idx_reviews_tags"
} );
db.runCommand({
  collMod: "DriverPings", validator: {
    $jsonSchema: {
      bsonType: "object", required: ["driverId", "location", "active", "created_at" ], properties: {
        driverId: {
          bsonType: "string"
        }, location: {
          bsonType: "object", required: ["type", "coordinates" ], properties: {
            type: {
              bsonType: "string", enum: ["Point"]
            }, coordinates: {
              bsonType: "array", minItems: 2, maxItems: 2, items: {
                bsonType: "double"
              }
            }
          }
        }, active: {
          bsonType: "bool"
        }, created_at: {
          bsonType: "date"
        }
      }
    }
  }, validationLevel: "moderate", validationAction: "error"
});
//Driver Ping Main Index
db.DriverPings.createIndex({
  location: "2dsphere"
}, {
  name: "idx_driverpings_location_2dsphere"
} );
db.DriverPings.createIndex({
  created_at: 1
}, {
  name: "idx_driverpings_created_at_ttl", expireAfterSeconds: 7200
} );
