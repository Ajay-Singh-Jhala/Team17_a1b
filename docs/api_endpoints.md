# BiteStream API sketch

Base URL while running locally: `http://localhost:3001/api`. JSON is returned by all endpoints. Errors use `{ "error": "human-readable explanation" }`.

| Method | Endpoint | Inputs | Output / purpose |
|---|---|---|---|
| GET | `/health` | none | PostgreSQL/MongoDB connection status |
| GET | `/browse/users?page=1&limit=20&q=` | page, limit (max 100), search text | Paginated user rows and total count |
| GET | `/browse/restaurants?page=1&limit=20&q=` | page, limit, search text | Paginated restaurant rows |
| GET | `/browse/orders?page=1&limit=20&q=` | page, limit, search text | Paginated orders with customer and restaurant names |
| GET | `/users/:id` | UUID | User detail and wallet balance |
| GET | `/restaurants/:id` | UUID | Restaurant detail |
| GET | `/orders/:id` | UUID | Order detail |
| POST | `/checkout` | `{ userId, restaurantId, items: [{ itemId, quantity }] }` | Revalidates item availability and prices against MongoDB, calculates the total server-side, then calls `sp_execute_checkout`; returns balance before/after, order, purchased items and audit evidence. Legacy amount-only requests remain accepted for API compatibility. |
| GET | `/audit?userId=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD` | user ID and optional dates | Read-only audit rows, latest first, with running change |
| PATCH | `/orders/:id/status` | `{ "status": "PREPARING\|DELIVERING\|DELIVERED" }` | Updates status; partial unique index prevents a second PREPARING/DELIVERING order for the same user |
| GET | `/analytics/moving-average` | none | Seven-day moving average series, `DENSE_RANK` leaderboard, materialized-view summary |
| POST | `/analytics/refresh` | `{}` | Calls `refresh_restaurant_performance(TRUE)` and returns refresh timing/mode |
| GET | `/map/drivers?lat=13.0827&lon=80.2707` | origin latitude/longitude | Active pings within 5 km, sorted by MongoDB `$geoNear` distance |
| GET | `/reviews?restaurantId=UUID` | optional restaurant ID | MongoDB `$facet` rating counts, top sentiment tags, average/count, and one menu document |
| GET | `/menus?restaurantId=UUID` | restaurant ID | Returns the selected restaurant menu, categories, item prices and availability for checkout |
| GET | `/restaurants-lite` | none | Small restaurant option list for forms |

## Implementation notes

- PostgreSQL queries use parameters for user input. Browse requests have a bounded page size.
- The API connects to MongoDB at startup and exposes a health endpoint for database status.
- The browser polls the driver endpoint every 10 seconds while the map screen is open. Leaflet/OpenStreetMap is used when available, with a local relative-position fallback.
- The last successful materialized-view refresh time is held in API memory for the current server process because the inherited schema does not persist this timestamp.
