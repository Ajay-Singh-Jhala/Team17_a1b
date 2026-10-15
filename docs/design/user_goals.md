# BiteStream users and design goals

## Main demo users

### Customer (represented by a selectable demo customer)
- Browse restaurants, users, and orders without loading the full database at once.
- Choose a restaurant and menu items, inspect wallet balance, and place an order.
- See clear checkout success/failure results and the trigger-generated wallet audit row.
- Search for a customer and inspect their read-only wallet audit trail with date filters.

### Restaurant / operations manager
- Review order records and move an order through `PREPARING`, `DELIVERING`, and `DELIVERED`.
- Demonstrate that the partial unique index prevents a customer from having a second active order until the first is delivered.
- Inspect seven-day moving-average revenue, the `DENSE_RANK()` leaderboard, and materialized-view summary/refresh time.
- Find nearby active driver pings and inspect restaurant review analytics and menu catalog data.

## Design choices

- A consistent dark blue-gray navigation/header, light neutral surfaces, and restrained blue accents keep the operations dashboard readable.
- Reusable cards, tables, forms, badges, and status messages make the six workflows feel like one application.
- Search and pagination are server-backed; large collections are never loaded entirely into the browser.
- Every workflow should show a loading state, a useful empty state, and a readable error state.
- The selectable customer is a demo actor selector, not authentication. This is intentional because the assignment says real login is not required.
- The interface is designed for laptop use and adapts to narrow screens with stacked panels and horizontally scrollable tables.

See `wireframes.md` for the screen-level sketches and `wireframes.png` for the visual overview.
