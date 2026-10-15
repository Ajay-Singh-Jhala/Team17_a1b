# Assignment 1B test plan

## Automated tests

Run from `api/`:

```bash
npm test
```

The included Node.js built-in test suite covers UUID validation, bounded pagination/search normalization, and invalid checkout payloads. These tests do not need database access.

## Database-backed smoke tests (run after seeding)

| Test | Steps | Expected result |
|---|---|---|
| Health | Open the app and inspect the sidebar status | PostgreSQL and MongoDB are reported online |
| Browse pagination | Browse Users, search for a name, move to next page | At most 100 rows per API request; total/page count updates; empty results have a message |
| Successful checkout | Pick a user with sufficient balance and sufficient wallet balance; submit a valid amount | Procedure reports success; balance decreases by amount; new order appears; audit row reports `DEBIT` and the new balance |
| Insufficient funds | Submit an amount larger than the selected user's balance | Friendly failure message; no successful order; balance remains unchanged |
| Active-order constraint | Place an order, then try a second checkout for the same user while the first is PREPARING/DELIVERING | Second checkout is rejected with a friendly ACTIVE_ORDER_EXISTS message; wallet balance is unchanged |
| Status transition | Mark the existing order DELIVERED, then place another order for the same user | New checkout succeeds if the wallet has sufficient funds |
| Audit filter | Select the same user in Audit and choose a date range containing the checkout | The new debit entry appears; the view is read-only |
| Analytics refresh | Open Analytics and press Refresh materialized view | Summary and refresh timing update; API role must have refresh permission |
| GeoNear | Open Driver map, change origin, wait 10 seconds | Only active pings within 5 km are returned, sorted by distance; display updates without full-page reload |
| Facet + catalog | Open Reviews & menus, choose a restaurant | Rating distribution, frequent tags, average rating and a menu document appear |

**Verification status:** automated validation tests and JavaScript syntax checks were run while preparing this package. The database-backed smoke tests above are the required final checks against the team's own seeded PostgreSQL/MongoDB instance; they have not been claimed as executed by the package author.
