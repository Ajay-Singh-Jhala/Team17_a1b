require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
const {
  isUuid,
  parsePageArgs,
  isValidCheckout,
} = require('./lib/validation');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

/**
 * Build the PostgreSQL pool from explicit local settings when available.
 * A Unix socket is the default because local PostgreSQL commonly uses peer
 * authentication. This avoids an accidental TCP/SCRAM connection with no
 * password when DATABASE_URL is not configured.
 */
function createPostgresPool() {
  const hasExplicitPgConfig = Boolean(
    process.env.PGHOST ||
    process.env.PGDATABASE ||
    process.env.PGUSER ||
    process.env.PGPASSWORD ||
    process.env.PGPORT
  );

  if (hasExplicitPgConfig) {
    const config = {
      host: process.env.PGHOST || '/var/run/postgresql',
      database: process.env.PGDATABASE || 'bitestream',
      user: process.env.PGUSER || process.env.USER || 'postgres',
    };

    if (process.env.PGPASSWORD) {
      config.password = process.env.PGPASSWORD;
    }

    if (process.env.PGPORT) {
      config.port = Number(process.env.PGPORT);
    }

    return new Pool(config);
  }

  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }

  return new Pool({
    host: '/var/run/postgresql',
    database: 'bitestream',
    user: process.env.USER || 'postgres',
  });
}

const pool = createPostgresPool();
const mongoClient = new MongoClient(
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'
);

let mongoDb;
let lastRefreshedAt = null;

// Forward rejected async route handlers to Express error middleware.
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Health and browse endpoints
// ---------------------------------------------------------------------------
app.get('/api/health', asyncRoute(async (_req, res) => {
  const postgresResult = await pool.query(
    'SELECT current_database() AS database, NOW() AS server_time'
  );

  let mongoStatus = 'connected';

  try {
    await mongoDb.command({ ping: 1 });
  } catch (_error) {
    mongoStatus = 'disconnected';
  }

  res.json({
    ok: mongoStatus === 'connected',
    postgres: postgresResult.rows[0],
    mongo: mongoStatus,
  });
}));

app.get('/api/browse/:entity', asyncRoute(async (req, res) => {
  const { page, limit, q } = parsePageArgs(req.query);
  const offset = (page - 1) * limit;
  const entity = req.params.entity;

  // Only these predefined table expressions can be used in the SQL query.
  const browseConfigs = {
    users: {
      table: 'users',
      search: '(name ILIKE $1 OR id::text ILIKE $1)',
      select: 'id, name, wallet_balance, wallet_balance AS balance',
      orderBy: 'name, id',
    },
    restaurants: {
      table: 'restaurants',
      search: 'name ILIKE $1',
      select: 'id, name, latitude, longitude',
      orderBy: 'name, id',
    },
    orders: {
      table: `orders o
        JOIN users u ON u.id = o.user_id
        JOIN restaurants r ON r.id = o.restaurant_id`,
      search: '(u.name ILIKE $1 OR r.name ILIKE $1 OR o.status ILIKE $1)',
      select: `o.id, o.user_id, u.name AS user_name,
        o.restaurant_id, r.name AS restaurant_name,
        o.total_amount, o.status, o.created_at`,
      orderBy: 'o.created_at DESC, o.id',
    },
  };

  const config = browseConfigs[entity];
  if (!config) {
    return res.status(404).json({ error: 'Unknown browse entity.' });
  }

  const values = [];
  let whereClause = '';

  if (q) {
    values.push(`%${q}%`);
    whereClause = ` WHERE ${config.search}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM ${config.table}${whereClause}`,
    values
  );

  values.push(limit, offset);

  const dataResult = await pool.query(
    `SELECT ${config.select}
     FROM ${config.table}${whereClause}
     ORDER BY ${config.orderBy}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  const total = countResult.rows[0].total;
  res.json({
    data: dataResult.rows,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}));

app.get('/api/users/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  const result = await pool.query(
    'SELECT id, name, wallet_balance FROM users WHERE id = $1',
    [req.params.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json(result.rows[0]);
}));

app.get('/api/restaurants/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid restaurant ID.' });
  }

  const result = await pool.query(
    'SELECT * FROM restaurants WHERE id = $1',
    [req.params.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Restaurant not found.' });
  }

  res.json(result.rows[0]);
}));

app.get('/api/orders/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid order ID.' });
  }

  const result = await pool.query(
    `SELECT o.*, u.name AS user_name, r.name AS restaurant_name
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN restaurants r ON r.id = o.restaurant_id
     WHERE o.id = $1`,
    [req.params.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  res.json(result.rows[0]);
}));

// ---------------------------------------------------------------------------
// Checkout and wallet audit
// ---------------------------------------------------------------------------
app.post('/api/checkout', asyncRoute(async (req, res) => {
  const { userId, restaurantId } = req.body;
  let amount = Number(req.body.amount);
  let purchasedItems = [];

  // When menu items are supplied, calculate the total from MongoDB's current
  // catalog rather than trusting a total submitted by the browser.
  if (Array.isArray(req.body.items)) {
    if (req.body.items.length === 0 || req.body.items.length > 50) {
      return res.status(400).json({ error: 'Add between 1 and 50 menu item types before checkout.' });
    }
    if (!isUuid(restaurantId)) {
      return res.status(400).json({ error: 'Choose a valid restaurant.' });
    }

    const menu = await mongoDb.collection('Menus').findOne({ restaurantId });
    if (!menu) {
      return res.status(404).json({ error: 'The selected restaurant has no menu available.' });
    }

    const catalog = new Map(
      (menu.categories || []).flatMap(category => category.items || [])
        .map(item => [String(item.itemId), item])
    );
    let calculatedTotal = 0;
    for (const requested of req.body.items) {
      const itemId = String(requested.itemId || '');
      const quantity = Number(requested.quantity);
      const menuItem = catalog.get(itemId);
      if (!menuItem || menuItem.available === false) {
        return res.status(400).json({ error: `Menu item '${itemId || 'unknown'}' is not available at this restaurant.` });
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.status(400).json({ error: `Quantity for '${menuItem.name}' must be between 1 and 99.` });
      }
      calculatedTotal += Number(menuItem.price) * quantity;
      purchasedItems.push({ itemId, name: menuItem.name, unitPrice: Number(menuItem.price), quantity });
    }
    amount = Math.round((calculatedTotal + Number.EPSILON) * 100) / 100;
  }

  if (!isValidCheckout({ userId, restaurantId, amount })) {
    return res.status(400).json({
      error: 'Choose a valid user and restaurant, and add menu items with a total greater than zero.',
    });
  }

  const beforeResult = await pool.query(
    'SELECT wallet_balance FROM users WHERE id = $1',
    [userId]
  );

  if (!beforeResult.rowCount) {
    return res.status(404).json({
      error: 'The selected user does not exist.',
    });
  }

  const balanceBefore = Number(beforeResult.rows[0].wallet_balance);

  // Friendly early check for the assignment's one-active-order rule.
  // The partial unique index remains the database-level protection against
  // concurrent checkouts; this check makes the common case clear to the UI.
  const activeOrderResult = await pool.query(
    `SELECT id, status, created_at
     FROM orders
     WHERE user_id = $1
       AND UPPER(BTRIM(status)) IN ('PREPARING', 'DELIVERING')
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId]
  );

  if (activeOrderResult.rowCount > 0) {
    return res.status(409).json({
      success: false,
      result: 'ACTIVE_ORDER_EXISTS',
      error: 'This customer already has an active order. Mark that order DELIVERED before placing another order.',
      activeOrder: activeOrderResult.rows[0],
      balanceBefore,
      balanceAfter: balanceBefore,
    });
  }

  try {
    // The inherited procedure manages its own transaction. PostgreSQL
    // requires this CALL to run at the top level, outside an explicit BEGIN.
    // UUIDs and amount are validated before the numeric literals are built.
    const callSql = `CALL sp_execute_checkout(
      '${userId}'::uuid,
      '${restaurantId}'::uuid,
      ${amount.toFixed(2)}::numeric,
      NULL::uuid,
      NULL::text
    )`;
    const callResult = await pool.query(callSql);
    const output = callResult.rows[0] || {};
    const procedureResult = output.p_result;

    if (procedureResult && procedureResult !== 'SUCCESS') {
      const messages = {
        INSUFFICIENT_FUNDS:
          'Not enough wallet balance. Reduce the order amount or choose a user with more funds.',
        ACTIVE_ORDER_EXISTS:
          'This customer already has an active order. Mark that order DELIVERED before placing another order.',
        UNIQUE_CONSTRAINT_VIOLATION:
          'A database uniqueness rule rejected this order. Check whether the customer already has an active order.',
        INVALID_REFERENCE:
          'The selected user or restaurant reference is invalid.',
      };

      return res.status(409).json({
        success: false,
        result: procedureResult,
        error: messages[procedureResult] || String(procedureResult),
        balanceBefore,
        balanceAfter: balanceBefore,
      });
    }

    const balanceResult = await pool.query(
      'SELECT wallet_balance FROM users WHERE id = $1',
      [userId]
    );
    const auditResult = await pool.query(
      `SELECT id, user_id, amount_changed, action_type, balance_after, created_at
       FROM wallet_audit_logs
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId]
    );
    const orderResult = output.p_order_id
      ? await pool.query('SELECT * FROM orders WHERE id = $1', [output.p_order_id])
      : await pool.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );

    return res.json({
      success: true,
      result: procedureResult || 'SUCCESS',
      balanceBefore,
      balanceAfter: Number(balanceResult.rows[0].wallet_balance),
      order: orderResult.rows[0] || null,
      items: purchasedItems,
      audit: auditResult.rows[0] || null,
    });
  } catch (error) {
    const message = error.message || 'Checkout failed.';

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        result: 'UNIQUE_CONSTRAINT_VIOLATION',
        error: 'This customer already has an active order. Mark the existing order DELIVERED before placing another order.',
        balanceBefore,
        balanceAfter: balanceBefore,
      });
    }

    if (error.code === '23514') {
      return res.status(409).json({
        success: false,
        result: 'INSUFFICIENT_FUNDS',
        error: 'Not enough wallet balance, or the amount is invalid.',
        balanceBefore,
        balanceAfter: balanceBefore,
      });
    }

    return res.status(500).json({
      error: `Checkout failed: ${message}`,
      hint: 'Confirm the stored procedure exists and the API database role can execute it.',
    });
  }
}));

app.get('/api/audit', asyncRoute(async (req, res) => {
  const { userId, from, to } = req.query;

  if (!isUuid(userId)) {
    return res.status(400).json({ error: 'Choose a valid user.' });
  }
  if (from && Number.isNaN(Date.parse(`${from}T00:00:00Z`))) {
    return res.status(400).json({ error: 'The audit start date is invalid.' });
  }
  if (to && Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return res.status(400).json({ error: 'The audit end date is invalid.' });
  }
  if (from && to && from > to) {
    return res.status(400).json({ error: 'Start date must be on or before the end date.' });
  }

  // Compute the running balance over the user's complete history first;
  // apply the date filter afterwards so a date range does not reset it.
  const result = await pool.query(
    `WITH audit_history AS (
       SELECT id, user_id, amount_changed, action_type, balance_after, created_at,
         SUM(
           CASE WHEN action_type = 'CREDIT' THEN amount_changed
                ELSE -amount_changed END
         ) OVER (
           PARTITION BY user_id
           ORDER BY created_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS running_change
       FROM wallet_audit_logs
       WHERE user_id = $1
     )
     SELECT *
     FROM audit_history
     WHERE ($2::date IS NULL OR created_at >= $2::date)
       AND ($3::date IS NULL OR created_at < ($3::date + INTERVAL '1 day'))
     ORDER BY created_at DESC, id DESC
     LIMIT 1000`,
    [userId, from || null, to || null]
  );

  res.json({ data: result.rows });
}));

app.patch('/api/orders/:id/status', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid order ID.' });
  }

  const status = String(req.body.status || '').trim().toUpperCase();
  const allowedStatuses = ['PREPARING', 'DELIVERING', 'DELIVERED'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Status must be PREPARING, DELIVERING, or DELIVERED.',
    });
  }

  try {
    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'This customer already has an active order. Mark the other order DELIVERED before making this order active.',
      });
    }

    throw error;
  }
}));

// ---------------------------------------------------------------------------
// Analytics: moving average, DENSE_RANK and materialized view
// ---------------------------------------------------------------------------
app.get('/api/analytics/moving-average', asyncRoute(async (_req, res) => {
  const movingAverageResult = await pool.query(`
    WITH bounds AS (
      -- Anchor to the newest delivered order so a database seeded a few days
      -- ago still shows data; fall back to today when there are none.
      SELECT COALESCE(
               (SELECT MAX(created_at)::date FROM orders WHERE status = 'DELIVERED'),
               CURRENT_DATE
             ) AS last_day
    ), daily AS (
      SELECT o.restaurant_id, o.created_at::date AS order_date,
             SUM(o.total_amount) AS revenue, COUNT(*) AS orders
      FROM orders o, bounds b
      WHERE o.status = 'DELIVERED'
        AND o.created_at >= b.last_day - INTERVAL '12 days'
      GROUP BY o.restaurant_id, o.created_at::date
    ), spine AS (
      -- 6 warm-up days before the 7 displayed days, so the first displayed
      -- day's 7-day average really covers 7 days.
      SELECT r.id AS restaurant_id, d::date AS order_date
      FROM restaurants r
      CROSS JOIN bounds b
      CROSS JOIN generate_series(
        b.last_day - INTERVAL '12 days',
        b.last_day,
        INTERVAL '1 day'
      ) d
    ), filled AS (
      SELECT s.restaurant_id, s.order_date,
             COALESCE(d.revenue, 0)::numeric AS revenue,
             COALESCE(d.orders, 0)::int AS orders
      FROM spine s
      LEFT JOIN daily d USING (restaurant_id, order_date)
    ), moving AS (
      SELECT *, ROUND(
        AVG(revenue) OVER (
          PARTITION BY restaurant_id
          ORDER BY order_date
          ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ), 2
      ) AS moving_avg
      FROM filled
    )
    -- order_date is returned as text (YYYY-MM-DD): a JS Date for a SQL date
    -- shifts by the server's UTC offset and the chart showed the wrong day.
    SELECT r.name AS restaurant, m.order_date::text AS order_date,
           m.revenue AS daily_revenue, m.moving_avg
    FROM moving m
    JOIN restaurants r ON r.id = m.restaurant_id
    CROSS JOIN bounds b
    WHERE m.order_date > b.last_day - INTERVAL '7 days'
    ORDER BY r.name, m.order_date
  `);

  const rankedResult = await pool.query(`
    SELECT r.id, r.name,
           COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'DELIVERED'), 0)::numeric(12, 2) AS revenue,
           COUNT(o.id) FILTER (WHERE o.status = 'DELIVERED')::int AS completed_orders,
           DENSE_RANK() OVER (
             ORDER BY COALESCE(
               SUM(o.total_amount) FILTER (WHERE o.status = 'DELIVERED'), 0
             ) DESC
           ) AS revenue_rank
    FROM restaurants r
    LEFT JOIN orders o ON o.restaurant_id = r.id
    GROUP BY r.id, r.name
    ORDER BY revenue_rank, r.name
    LIMIT 20
  `);

  const summaryResult = await pool.query(`
    SELECT COUNT(*)::int AS restaurant_count,
           COALESCE(SUM(total_revenue), 0)::numeric(12, 2) AS total_revenue,
           COALESCE(SUM(completed_orders), 0)::int AS completed_orders,
           MAX(last_completed_at) AS last_completed_at
    FROM mv_restaurant_performance
  `);

  res.json({
    movingAverage: movingAverageResult.rows,
    ranked: rankedResult.rows,
    summary: summaryResult.rows[0],
    lastRefreshed: lastRefreshedAt,
  });
}));

app.post('/api/analytics/refresh', asyncRoute(async (_req, res) => {
  const result = await pool.query(
    'SELECT * FROM refresh_restaurant_performance(TRUE)'
  );

  lastRefreshedAt = result.rows[0].refreshed_at;
  res.json({
    ...result.rows[0],
    message: 'Restaurant performance materialized view refreshed.',
  });
}));

// ---------------------------------------------------------------------------
// MongoDB: driver proximity and review/menu insights
// ---------------------------------------------------------------------------
app.get('/api/map/drivers', asyncRoute(async (req, res) => {
  const latitude = Number(req.query.lat ?? 13.0827);
  const longitude = Number(req.query.lon ?? 80.2707);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return res.status(400).json({
      error: 'Origin must have valid latitude and longitude.',
    });
  }

  const drivers = await mongoDb.collection('DriverPings').aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        key: 'location',
        distanceField: 'distanceMeters',
        maxDistance: 5000,
        spherical: true,
        query: { active: true },
      },
    },
    // DriverPings holds hundreds of pings per driver; keep each driver's
    // newest in-radius ping so a driver is listed once, then sort by distance.
    { $sort: { created_at: -1 } },
    { $group: { _id: '$driverId', ping: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$ping' } },
    { $sort: { distanceMeters: 1 } },
    { $limit: 100 },
    {
      $project: {
        _id: 0,
        driverId: 1,
        location: 1,
        active: 1,
        created_at: 1,
        distanceMeters: 1,
      },
    },
  ]).toArray();

  res.json({
    origin: { lat: latitude, lon: longitude },
    radiusMeters: 5000,
    data: drivers,
    updatedAt: new Date().toISOString(),
  });
}));

app.get('/api/menus', asyncRoute(async (req, res) => {
  const restaurantId = String(req.query.restaurantId || '').trim();
  if (!isUuid(restaurantId)) {
    return res.status(400).json({ error: 'Choose a valid restaurant to load its menu.' });
  }

  const menu = await mongoDb.collection('Menus').findOne(
    { restaurantId },
    { projection: { _id: 0, restaurantId: 1, restaurantName: 1, categories: 1, updatedAt: 1 } }
  );

  if (!menu) {
    return res.status(404).json({ error: 'No menu is available for this restaurant yet.' });
  }

  res.json({ data: menu });
}));

app.get('/api/reviews', asyncRoute(async (req, res) => {
  const restaurantId = String(req.query.restaurantId || '');
  const match = restaurantId ? { restaurantId } : {};

  const aggregation = await mongoDb.collection('Reviews').aggregate([
    { $match: match },
    {
      $facet: {
        ratingDistribution: [
          { $group: { _id: '$rating', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, rating: '$_id', count: 1 } },
        ],
        frequentTags: [
          { $unwind: '$sentimentTags' },
          { $group: { _id: '$sentimentTags', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, tag: '$_id', count: 1 } },
        ],
        overallAverageRating: [
          {
            $group: {
              _id: null,
              averageRating: { $avg: '$rating' },
              reviewCount: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              averageRating: { $round: ['$averageRating', 2] },
              reviewCount: 1,
            },
          },
        ],
      },
    },
  ]).toArray();

  const menuResults = await mongoDb.collection('Menus')
    .find(restaurantId ? { restaurantId } : {})
    .project({
      _id: 0,
      restaurantId: 1,
      restaurantName: 1,
      categories: 1,
      updatedAt: 1,
    })
    .limit(1)
    .toArray();

  const insights = aggregation[0] || {
    ratingDistribution: [],
    frequentTags: [],
    overallAverageRating: [],
  };

  res.json({
    ...insights,
    menu: menuResults[0] || null,
  });
}));

app.get('/api/restaurants-lite', asyncRoute(async (_req, res) => {
  const result = await pool.query(
    'SELECT id, name, latitude, longitude FROM restaurants ORDER BY name LIMIT 300'
  );

  res.json({ data: result.rows });
}));

// Serve frontend assets before the API fallback route.
app.use(express.static(path.join(__dirname, '..', 'web'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: 'The request failed. Check the API terminal for details.',
    detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
});

const port = Number(process.env.PORT || 3001);

async function startServer() {
  mongoDb = mongoClient.db(process.env.MONGO_DATABASE || 'bitestream');

  mongoClient.connect()
    .then(() => console.log('MongoDB connected.'))
    .catch((error) => {
      console.error('MongoDB unavailable; web UI will still start:', error.message);
    });

  app.listen(port, () => {
    console.log(`BiteStream API + web running at http://localhost:${port}`);
  });
}

startServer();
