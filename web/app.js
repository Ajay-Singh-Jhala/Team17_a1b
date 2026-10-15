const $ = id => document.getElementById(id);
const state = {
  screen: 'browse', entity: 'users', page: 1, limit: 20, total: 0, pages: 1, users: [], restaurants: [], analytics: null, mapTimer: null, mapData: [], menu: null, cart: new Map(), browseRequest: 0, checkoutSearchRequest: 0, checkoutSearchTimer: null, auditSearchRequest: 0, auditSearchTimer: null, leafletMap: null, leafletLayers: null, mapOrigin: null
};
const titles = {
  browse: 'Browse data', checkout: 'Place an order', audit: 'Wallet audit trail', analytics: 'Restaurant analytics', map: 'Driver proximity', reviews: 'Reviews & menus'
};
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
const shortId = id => String(id || '').length > 17 ? `${String(id).slice(0, 8)}…${String(id).slice(-5)}` : String(id || '—');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}
[c]));
const dateFmt = v => v ? new Date(v).toLocaleString([], {
  dateStyle: 'medium', timeStyle: 'short'
}) : '—';
async function api(url, options = {}) {
  const { headers: optionHeaders = {}, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...optionHeaders,
    },
  });
  let body;
  try {
    body = await response.json();
  }
  catch (_) {
    body = {};
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function notify(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.style.background = isError ? '#8d3f35' : '#173b2d';
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}
function showAlert(message, isError = false) {
  $('alert').textContent = message;
  $('alert').classList.toggle('error', isError);
  $('alert').classList.remove('hidden');
}
function clearAlert() {
  $('alert').classList.add('hidden');
}
function loadingRow(colspan, text = 'Loading…') {
  return `<tr><td colspan="${colspan}" class="loading-cell">${esc(text)}</td></tr>`;
}
function setScreen(screen, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(titles, screen)) screen = 'browse';
  state.screen = screen;
  clearAlert();

  document.querySelectorAll('.screen').forEach(section => {
    section.classList.toggle('active', section.id === `screen-${screen}`);
  });
  document.querySelectorAll('.nav-item').forEach(button => {
    button.classList.toggle('active', button.dataset.screen === screen);
    button.setAttribute('aria-current', button.dataset.screen === screen ? 'page' : 'false');
  });
  $('pageTitle').textContent = titles[screen];

  if (state.mapTimer) {
    clearInterval(state.mapTimer);
    state.mapTimer = null;
  }

  if (screen === 'browse') loadBrowse();
  else if (screen === 'checkout') loadCheckoutOptions();
  else if (screen === 'audit') loadAudit();
  else if (screen === 'analytics') loadAnalytics();
  else if (screen === 'map') {
    loadMap();
    state.mapTimer = setInterval(() => loadMap(true), 10000);
    setTimeout(() => state.leafletMap?.invalidateSize(), 100);
  }
  else if (screen === 'reviews') loadReviews();

  if (options.updateHash !== false && location.hash !== `#${screen}`) {
    location.hash = screen;
  }
}

// Event delegation keeps navigation reliable even when the layout is resized.
document.addEventListener('click', event => {
  const navButton = event.target.closest('[data-screen]');
  if (navButton) {
    event.preventDefault();
    setScreen(navButton.dataset.screen);
    return;
  }

  const gotoButton = event.target.closest('[data-goto]');
  if (gotoButton) {
    event.preventDefault();
    if (gotoButton.dataset.goto === 'browse') {
      state.entity = 'orders';
      updateEntityButtons();
    }
    setScreen(gotoButton.dataset.goto);
  }
});

window.addEventListener('hashchange', () => {
  const requestedScreen = location.hash.slice(1);
  if (requestedScreen !== state.screen) setScreen(requestedScreen, { updateHash: false });
});

$('entityTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-entity]');
  if (!b) return;
  state.entity = b.dataset.entity;
  state.page = 1;
  updateEntityButtons();
  loadBrowse();
});
function updateEntityButtons() {
  document.querySelectorAll('#entityTabs button').forEach(b => b.classList.toggle('selected', b.dataset.entity === state.entity));
}
$('searchBtn').addEventListener('click', () => {
  state.page = 1;
  loadBrowse();
});
$('browseSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.page = 1;
    loadBrowse();
  }
});
let searchTimer;
$('browseSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    loadBrowse();
  }, 250);
});
$('prevPage').addEventListener('click', () => {
  if (state.page > 1) {
    state.page--;
    loadBrowse();
  }
});
$('nextPage').addEventListener('click', () => {
  if (state.page < state.pages) {
    state.page++;
    loadBrowse();
  }
});
$('closeDetail').addEventListener('click', () => $('recordDetail').classList.add('hidden'));
async function init() {
  const hash = location.hash.replace('#', '');
  try {
    const health = await api('/api/health');
    $('healthText').textContent = health.ok ? 'PostgreSQL + MongoDB online' : 'Check database connection';
    await loadSharedOptions();
  }
  catch (e) {
    $('healthText').textContent = 'API/database unavailable';
    showAlert(`${e.message}. Start PostgreSQL and MongoDB, then run the API server.`, true);
  }
  setScreen(Object.prototype.hasOwnProperty.call(titles, hash) ? hash : 'browse');
}
async function loadSharedOptions() {
  const [usersResult, restaurantsResult] = await Promise.all([
    api('/api/browse/users?limit=100'),
    api('/api/restaurants-lite'),
  ]);

  state.users = usersResult.data || [];
  state.restaurants = restaurantsResult.data || [];

  const userOptions = state.users.map(user =>
    `<option value="${esc(user.id)}" data-balance="${esc(user.wallet_balance)}" data-name="${esc(user.name)}">${esc(user.name)} · ${esc(user.id)} · ${money(user.wallet_balance)}</option>`
  ).join('');

  ['checkoutUser', 'auditUser'].forEach(id => {
    const select = $(id);
    if (select) {
      select.innerHTML = userOptions || '<option value="">No users found</option>';
    }
  });

  const restaurantOptions = state.restaurants.map(restaurant =>
    `<option value="${esc(restaurant.id)}">${esc(restaurant.name)}</option>`
  ).join('');

  $('checkoutRestaurant').innerHTML = restaurantOptions;
  $('reviewRestaurant').innerHTML = `<option value="">All restaurants</option>${restaurantOptions}`;

  if (state.users.length) {
    $('checkoutUser').value = state.users[0].id;
    $('auditUser').value = state.users[0].id;
  }

  updateWalletPreview();
  if (state.screen === 'checkout') {
    await loadCheckoutMenu(false);
  }
}

async function searchCheckoutUsers(query, preferredId = '') {
  const requestId = ++state.checkoutSearchRequest;
  const normalizedQuery = String(query || '').trim();
  const url = `/api/browse/users?limit=100&q=${encodeURIComponent(normalizedQuery)}`;

  try {
    const result = await api(url);
    if (requestId !== state.checkoutSearchRequest) return;

    const users = result.data || [];
    const select = $('checkoutUser');
    const currentId = preferredId || select.value;

    select.innerHTML = users.length
      ? users.map(user =>
          `<option value="${esc(user.id)}" data-balance="${esc(user.wallet_balance)}" data-name="${esc(user.name)}">${esc(user.name)} · ${esc(user.id)} · ${money(user.wallet_balance)}</option>`
        ).join('')
      : '<option value="">No matching customers</option>';

    if (currentId && users.some(user => user.id === currentId)) {
      select.value = currentId;
    } else if (users.length) {
      select.value = users[0].id;
    }

    updateWalletPreview();
  } catch (error) {
    notify(`Customer search failed: ${error.message}`, true);
  }
}

async function searchAuditUsers(query) {
  const requestId = ++state.auditSearchRequest;
  const normalizedQuery = String(query || '').trim();
  const url = `/api/browse/users?limit=100&q=${encodeURIComponent(normalizedQuery)}`;

  try {
    const result = await api(url);
    if (requestId !== state.auditSearchRequest) return;

    const users = result.data || [];
    const select = $('auditUser');
    const previousId = select.value;

    select.innerHTML = users.length
      ? users.map(user =>
          `<option value="${esc(user.id)}">${esc(user.name)} · ${esc(user.id)}</option>`
        ).join('')
      : '<option value="">No matching customers</option>';

    if (previousId && users.some(user => user.id === previousId)) {
      select.value = previousId;
    } else if (users.length) {
      select.value = users[0].id;
    }

    await loadAudit();
    if (!users.length) {
      $('auditBody').innerHTML = loadingRow(6, 'No customer matched that name or ID.');
    }
  } catch (error) {
    notify(`Customer search failed: ${error.message}`, true);
  }
}

$('checkoutUser').addEventListener('change', updateWalletPreview);
$('checkoutUserSearch').addEventListener('input', () => {
  clearTimeout(state.checkoutSearchTimer);
  state.checkoutSearchTimer = setTimeout(() => {
    searchCheckoutUsers($('checkoutUserSearch').value);
  }, 250);
});

$('auditSearchBtn').addEventListener('click', () => {
  searchAuditUsers($('auditUserSearch').value);
});
$('auditUserSearch').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchAuditUsers($('auditUserSearch').value);
  }
});
$('auditUserSearch').addEventListener('input', () => {
  clearTimeout(state.auditSearchTimer);
  state.auditSearchTimer = setTimeout(() => {
    if ($('auditUserSearch').value.trim()) {
      searchAuditUsers($('auditUserSearch').value);
    }
  }, 350);
});
$('auditUser').addEventListener('change', loadAudit);
$('checkoutRestaurant').addEventListener('change', () => loadCheckoutMenu(true));

function getCartTotal() {
  return [...state.cart.values()].reduce((sum, line) => sum + line.item.price * line.quantity, 0);
}

function renderCheckoutMenu() {
  const menu = state.menu;
  if (!menu) {
    $('checkoutMenu').innerHTML = '<div class="empty-state"><b>Menu unavailable</b><p>Choose another restaurant or check MongoDB.</p></div>';
    return;
  }

  const categories = (menu.categories || []).map(category => {
    const items = (category.items || []).map(item => {
      const quantity = state.cart.get(item.itemId)?.quantity || 0;
      const available = item.available !== false;
      return `
        <div class="checkout-item ${available ? '' : 'unavailable'}">
          <div class="checkout-item-info">
            <b>${esc(item.name)}</b>
            <small>${esc(item.description || '')}${available ? '' : ' · Not available right now'}</small>
          </div>
          <div class="checkout-item-actions">
            <strong>${money(item.price)}</strong>
            <button type="button" data-menu-item="${esc(item.itemId)}" aria-label="${quantity ? 'Add another' : 'Add'} ${esc(item.name)}" ${available ? '' : 'disabled'}>${quantity ? `+ ${quantity}` : 'Add +'}</button>
          </div>
        </div>
      `;
    }).join('');
    return `<div class="checkout-category"><h4>${esc(category.name)}</h4>${items || '<p class="muted">No items in this category.</p>'}</div>`;
  }).join('');

  $('checkoutMenu').innerHTML = `<div class="menu-restaurant">${esc(menu.restaurantName || 'Restaurant menu')}</div>${categories || '<p class="muted">No menu categories available.</p>'}`;
}

function renderCheckoutCart() {
  const entries = [...state.cart.values()];
  const count = entries.reduce((sum, line) => sum + line.quantity, 0);
  const total = getCartTotal();
  $('menuItemCount').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('checkoutAmount').value = total > 0 ? total.toFixed(2) : '';
  $('checkoutSubmit').disabled = count === 0;

  if (!entries.length) {
    $('checkoutCart').innerHTML = '<div class="cart-empty">Your order is empty. Add an item from the menu.</div>';
    return;
  }

  const lines = entries.map(({ item, quantity }) => `
    <div class="cart-line">
      <div class="cart-line-name"><b>${esc(item.name)}</b><small>${money(item.price)} each</small></div>
      <div class="qty-control">
        <button type="button" data-cart-action="minus" data-cart-id="${esc(item.itemId)}" aria-label="Remove one ${esc(item.name)}">−</button>
        <span>${quantity}</span>
        <button type="button" data-cart-action="plus" data-cart-id="${esc(item.itemId)}" aria-label="Add one ${esc(item.name)}">+</button>
      </div>
      <div class="cart-line-total">${money(item.price * quantity)}</div>
    </div>
  `).join('');

  $('checkoutCart').innerHTML = `${lines}<div class="cart-total"><span>Order total</span><strong>${money(total)}</strong></div>`;
}

async function loadCheckoutMenu(clearCart = false) {
  const restaurantId = $('checkoutRestaurant').value;
  if (clearCart) state.cart.clear();
  state.menu = null;
  renderCheckoutCart();
  if (!restaurantId) {
    renderCheckoutMenu();
    return;
  }

  $('checkoutMenu').innerHTML = '<div class="loading-cell">Loading menu and prices…</div>';
  try {
    const response = await api(`/api/menus?restaurantId=${encodeURIComponent(restaurantId)}`);
    // Ignore a slow response if the user has already selected a different restaurant.
    if ($('checkoutRestaurant').value !== restaurantId) return;
    state.menu = response.data;
    renderCheckoutMenu();
  } catch (error) {
    state.menu = null;
    $('checkoutMenu').innerHTML = `<div class="empty-state"><b>Could not load menu</b><p>${esc(error.message)}</p></div>`;
    notify(error.message, true);
  }
}

$('checkoutMenu').addEventListener('click', event => {
  const button = event.target.closest('[data-menu-item]');
  if (!button || !state.menu) return;
  const itemId = button.dataset.menuItem;
  const item = (state.menu.categories || []).flatMap(category => category.items || []).find(entry => entry.itemId === itemId);
  if (!item || item.available === false) return;
  const existing = state.cart.get(itemId);
  state.cart.set(itemId, { item, quantity: (existing?.quantity || 0) + 1 });
  renderCheckoutMenu();
  renderCheckoutCart();
});

$('checkoutCart').addEventListener('click', event => {
  const button = event.target.closest('[data-cart-action]');
  if (!button) return;
  const id = button.dataset.cartId;
  const line = state.cart.get(id);
  if (!line) return;
  if (button.dataset.cartAction === 'minus' && line.quantity <= 1) state.cart.delete(id);
  else if (button.dataset.cartAction === 'minus') state.cart.set(id, { ...line, quantity: line.quantity - 1 });
  else state.cart.set(id, { ...line, quantity: line.quantity + 1 });
  renderCheckoutMenu();
  renderCheckoutCart();
});
function updateWalletPreview() {
  const select = $('checkoutUser');
  const option = select?.selectedOptions?.[0];
  const balance = option?.dataset?.balance;
  $('walletPreview').textContent = balance !== undefined && option.value
    ? money(balance)
    : 'Choose a customer';
}
async function loadBrowse() {
  const requestId = ++state.browseRequest;
  $('browseHead').innerHTML = ''; 
  $('browseBody').innerHTML = loadingRow(7);
  const q = encodeURIComponent($('browseSearch').value.trim());
  try {
    const result = await api(`/api/browse/${state.entity}?page=${state.page}&limit=${state.limit}&q=${q}`);
    if (requestId !== state.browseRequest) return;
    state.total = result.total;
    state.pages = result.pages;
    $('browseCount').textContent = result.total.toLocaleString();
    $('tableMeta').textContent = `${result.total.toLocaleString()} total records`;
    $('pageInfo').textContent = `Page ${result.page} of ${result.pages} · ${result.total.toLocaleString()} records`;
    $('prevPage').disabled = state.page <= 1;
    $('nextPage').disabled = state.page >= state.pages;
    const configs = {
      users: {
        title: 'Users',
        sub: 'Customer wallets and account details',
        cols: ['Customer', 'Wallet balance', 'User ID', 'Details'],
      },
      restaurants: {
        title: 'Restaurants',
        sub: 'Restaurant catalog and location',
        cols: ['Restaurant', 'Latitude', 'Longitude', 'Restaurant ID', 'Details'],
      },
      orders: {
        title: 'Orders',
        sub: 'Orders and lifecycle status controls',
        cols: ['Customer', 'Restaurant', 'Amount', 'Status', 'Created', 'Order ID', 'Update status'],
      },
    };
    const c = configs[state.entity];
    $('tableTitle').textContent = c.title;
    $('tableSubtitle').textContent = c.sub;
    $('browseHead').innerHTML = `<tr>${c.cols.map(x => `<th>${x.toUpperCase()}</th>`).join('')}</tr>`;
    if (!result.data.length) {
      $('browseBody').innerHTML = loadingRow(c.cols.length, 'No matching records. Try another search or clear the filter.');
      return;
    }
    $('browseBody').innerHTML = result.data.map(row => {
      if (state.entity === 'users') {
        return `
          <tr>
            <td>${esc(row.name)}</td>
            <td class="money">${money(row.wallet_balance)}</td>
            <td class="id-cell">${esc(row.id)}</td>
            <td><button class="detail-link" data-detail="users" data-id="${esc(row.id)}">View details ↗</button></td>
          </tr>
        `;
      }

      if (state.entity === 'restaurants') {
        return `
          <tr>
            <td>${esc(row.name)}</td>
            <td>${Number(row.latitude).toFixed(4)}</td>
            <td>${Number(row.longitude).toFixed(4)}</td>
            <td class="id-cell">${esc(row.id)}</td>
            <td><button class="detail-link" data-detail="restaurants" data-id="${esc(row.id)}">View details ↗</button></td>
          </tr>
        `;
      }

      return `
        <tr>
          <td>${esc(row.user_name)}</td>
          <td>${esc(row.restaurant_name)}</td>
          <td class="money">${money(row.total_amount)}</td>
          <td><span class="status-pill status-${esc(row.status)}">${esc(row.status)}</span></td>
          <td>${dateFmt(row.created_at)}</td>
          <td class="id-cell">${esc(row.id)}</td>
          <td>
            <div class="row-actions">
              <select aria-label="Change order status" data-status-id="${esc(row.id)}">
                <option ${row.status === 'PREPARING' ? 'selected' : ''}>PREPARING</option>
                <option ${row.status === 'DELIVERING' ? 'selected' : ''}>DELIVERING</option>
                <option ${row.status === 'DELIVERED' ? 'selected' : ''}>DELIVERED</option>
              </select>
              <button class="detail-link" data-detail="orders" data-id="${esc(row.id)}">↗</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  catch (e) {
    if (requestId !== state.browseRequest) return;
    $('browseBody').innerHTML = loadingRow(7, e.message);
    showAlert(e.message, true);
  }
}
$('browseBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-detail]');
  if (!b) return;
  try {
    const row = await api(`/${'api'}/${b.dataset.detail}/${b.dataset.id}`);
    $('detailContent').textContent = JSON.stringify(row, null, 2);
    $('recordDetail').classList.remove('hidden');
    $('recordDetail').scrollIntoView({
      behavior: 'smooth', block: 'nearest'
    });
  }
  catch (err) {
    notify(err.message, true);
  }
});
$('browseBody').addEventListener('change', async e => {
  const select = e.target.closest('[data-status-id]');
  if (!select) return;
  const id = select.dataset.statusId;
  try {
    await api(`/api/orders/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({
        status: select.value
      })
    });
    notify(`Order status updated to ${select.value}.`);
    loadBrowse();
  }
  catch (err) {
    notify(err.message, true);
    loadBrowse();
  }
});
async function loadCheckoutOptions() {
  if (!state.users.length || !state.restaurants.length) await loadSharedOptions();
  updateWalletPreview();
  if (!state.menu || state.menu.restaurantId !== $('checkoutRestaurant').value) await loadCheckoutMenu(false);
}
$('checkoutForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearAlert();
  const button = $('checkoutSubmit');
  button.disabled = true;
  button.textContent = 'Processing checkout…';
  const userId = $('checkoutUser').value, restaurantId = $('checkoutRestaurant').value, amount = Number($('checkoutAmount').value);
  if (!state.cart.size || amount <= 0) {
    notify('Choose at least one available menu item before placing an order.', true);
    button.disabled = state.cart.size === 0;
    button.innerHTML = 'Place order <span>→</span>';
    return;
  }
  try {
    const r = await api('/api/checkout', {
      method: 'POST', body: JSON.stringify({
        userId,
        restaurantId,
        amount,
        items: [...state.cart.values()].map(line => ({
          itemId: line.item.itemId,
          quantity: line.quantity,
        })),
      })
    });
    const html = `
      <div class="result-box">
        <h3>✓ Checkout successful</h3>
        <p>The stored procedure returned success. The wallet trigger created an audit record.</p>
        <div class="balance-pair">
          <div><small>Balance before</small><b>${money(r.balanceBefore)}</b></div>
          <div><small>Balance after</small><b>${money(r.balanceAfter)}</b></div>
        </div>
        <div class="audit-proof">
          <b>Items:</b> ${esc((r.items || []).map(item => `${item.name} × ${item.quantity}`).join(', ') || 'Menu order')}<br>
          <b>Order total:</b> ${money(r.order?.total_amount ?? amount)}<br>
          <b>Order:</b> ${esc(r.order?.id || 'Created')}<br>
          <b>Status:</b> ${esc(r.order?.status || 'PREPARING')}<br>
          <b>Trigger audit:</b> ${esc(r.audit?.action_type || 'Recorded')} ${money(r.audit?.amount_changed)}<br>
          <b>Audit time:</b> ${esc(dateFmt(r.audit?.created_at))}<br>
          <b>Audit ID:</b> ${esc(r.audit?.id || '—')}
        </div>
      </div>
    `;
    $('checkoutResult').className = '';
    $('checkoutResult').innerHTML = html;
    notify('Order placed and audit evidence retrieved.');
    state.cart.clear();
    renderCheckoutCart();
    renderCheckoutMenu();
    await loadSharedOptions();
    $('checkoutUserSearch').value = userId;
    await searchCheckoutUsers(userId, userId);
    $('checkoutUser').value = userId;
    updateWalletPreview();
  }
  catch (err) {
    const msg = err.message;
    $('checkoutResult').className = '';
    $('checkoutResult').innerHTML = `
      <div class="result-box fail">
        <h3>Checkout could not complete</h3>
        <p>${esc(msg)}</p>
        <div class="audit-proof">
          No successful order was reported. If this was an active-order or insufficient-funds rejection,
          the database constraint/procedure prevented the checkout.
        </div>
      </div>
    `;
    notify('Checkout failed. See the transaction result.', true);
  }
  finally {
    button.disabled = state.cart.size === 0;
    button.innerHTML = 'Place order <span>→</span>';
  }
});
$('auditApply').addEventListener('click', loadAudit);
async function loadAudit() {
  const userId = $('auditUser').value;
  if (!userId) {
    $('auditBody').innerHTML = loadingRow(6, 'Choose a customer first.');
    return;
  }
  $('auditBody').innerHTML = loadingRow(6);
  try {
    const p = new URLSearchParams({
      userId
    });
    if ($('auditFrom').value) p.set('from', $('auditFrom').value);
    if ($('auditTo').value) p.set('to', $('auditTo').value);
    const r = await api(`/api/audit?${p}`);
    $('auditCount').textContent = `${r.data.length} entries`;
    $('auditBody').innerHTML = r.data.length
      ? r.data.map((entry) => `
        <tr>
          <td>${dateFmt(entry.created_at)}</td>
          <td>
            <span class="status-pill ${entry.action_type === 'DEBIT' ? 'status-PREPARING' : 'status-DELIVERED'}">
              ${esc(entry.action_type)}
            </span>
          </td>
          <td class="audit-amount ${entry.action_type === 'DEBIT' ? 'debit' : 'credit'}">
            ${entry.action_type === 'DEBIT' ? '−' : '+'}${money(entry.amount_changed)}
          </td>
          <td class="money">${money(entry.balance_after)}</td>
          <td>${money(entry.running_change)}</td>
          <td class="id-cell">${esc(entry.id)}</td>
        </tr>
      `).join('')
      : loadingRow(6, 'No audit entries match this customer/date range. Checkout a user to create a trigger audit entry.');
  }
  catch (e) {
    $('auditBody').innerHTML = loadingRow(6, e.message);
  }
}
$('refreshMv').addEventListener('click', async () => {
  const btn = $('refreshMv');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  $('refreshStatus').textContent = 'Refresh in progress';
  try {
    const r = await api('/api/analytics/refresh', {
      method: 'POST', body: '{}'
    });
    $('refreshStatus').textContent = `Refreshed at ${dateFmt(r.refreshed_at)} · ${r.duration_ms} ms · ${r.mode}`;
    $('mvRefreshed').textContent = dateFmt(r.refreshed_at);
    notify('Materialized view refreshed.');
    await loadAnalytics();
  }
  catch (e) {
    $('refreshStatus').textContent = e.message;
    notify(e.message, true);
  }
  finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh materialized view';
  }
});
async function loadAnalytics() {
  $('movingChart').innerHTML = '<div class="loading-cell">Loading analytics…</div>';
  $('rankBody').innerHTML = loadingRow(4);
  try {
    const r = await api('/api/analytics/moving-average');
    state.analytics = r;
    $('mvRevenue').textContent = money(r.summary.total_revenue);
    $('mvOrders').textContent = Number(r.summary.completed_orders || 0).toLocaleString();
    $('mvRestaurants').textContent = Number(r.summary.restaurant_count || 0).toLocaleString();
    if (r.lastRefreshed) $('mvRefreshed').textContent = dateFmt(r.lastRefreshed);
    $('rankBody').innerHTML = r.ranked.length
      ? r.ranked.map((restaurant) => `
        <tr>
          <td><span class="rank-num">#${restaurant.revenue_rank}</span></td>
          <td>${esc(restaurant.name)}</td>
          <td class="money">${money(restaurant.revenue)}</td>
          <td>${Number(restaurant.completed_orders || 0).toLocaleString()}</td>
        </tr>
      `).join('')
      : loadingRow(4, 'No restaurant data yet. Run the PostgreSQL seeder first.');
    const names = [...new Set(r.movingAverage.map(x => x.restaurant))];
    $('analyticsRestaurant').innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    $('analyticsRestaurant').onchange = () => renderMovingChart();
    renderMovingChart();
  }
  catch (e) {
    $('movingChart').innerHTML = `<div class="empty-state"><b>Analytics unavailable</b><p>${esc(e.message)}</p></div>`;
    $('rankBody').innerHTML = loadingRow(4, e.message);
  }
}
function renderMovingChart() {
  const data = state.analytics?.movingAverage || [];
  const names = [...new Set(data.map(x => x.restaurant))];
  const selected = $('analyticsRestaurant').value || names[0];
  const rows = data
    .filter((row) => row.restaurant === selected)
    .sort((a, b) => new Date(a.order_date) - new Date(b.order_date));
  if (!rows.length || rows.every(x => Number(x.moving_avg) === 0)) {
    $('movingChart').innerHTML = `
      <div class="empty-state">
        <b>No delivered-order revenue in the last seven days</b>
        <p>The chart is connected to the PostgreSQL window query. It will show bars once delivered orders exist in the selected period.</p>
      </div>
    `;
    return;
  }
  const maxAverage = Math.max(1, ...rows.map((row) => Number(row.moving_avg || 0)));
  const bars = rows.map((row) => {
    const value = Number(row.moving_avg || 0);
    const height = Math.max(2, (value / maxAverage) * 82);
    const label = new Date(row.order_date).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

    return `
      <div class="chart-group">
        <div class="chart-bar" data-value="${money(value)}" style="height:${height}%"></div>
        <span class="chart-label">${label}</span>
      </div>
    `;
  }).join('');

  $('movingChart').innerHTML = `
    <div class="chart-bars">${bars}</div>
    <div class="muted" style="margin-top:25px">
      Showing the 7-day moving average for <b>${esc(selected)}</b>.
      Revenue bars are scaled to this restaurant's highest value in the selected period.
    </div>
  `;
}
$('mapApply').addEventListener('click', () => loadMap());

function renderFallbackMap(latitude, longitude, drivers) {
  const canvas = $('mapCanvas');
  canvas.className = 'map-canvas';
  canvas.innerHTML = '<div class="map-grid"></div><div class="map-origin"><span>YOU</span></div>';
  const ring = document.createElement('div');
  ring.className = 'radius-ring';
  canvas.appendChild(ring);

  drivers.slice(0, 100).forEach((driver, index) => {
    const [driverLon, driverLat] = driver.location.coordinates;
    const northMeters = (driverLat - latitude) * 111000;
    const eastMeters = (driverLon - longitude) * 111000 * Math.cos(latitude * Math.PI / 180);
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'driver-pin';
    pin.style.left = `${Math.max(8, Math.min(92, 50 + eastMeters / 5000 * 42))}%`;
    pin.style.top = `${Math.max(8, Math.min(92, 50 - northMeters / 5000 * 42))}%`;
    pin.title = `Driver ${shortId(driver.driverId)} · ${(driver.distanceMeters / 1000).toFixed(2)} km`;
    pin.setAttribute('aria-label', pin.title);
    canvas.appendChild(pin);
  });
  if (!drivers.length) {
    const message = document.createElement('div');
    message.className = 'map-placeholder';
    message.textContent = 'No active driver pings within 5 km of this origin.';
    canvas.appendChild(message);
  }
}

function ensureLeafletMap(latitude, longitude) {
  if (!window.L) return false;
  const canvas = $('mapCanvas');
  if (!state.leafletMap) {
    canvas.innerHTML = '';
    state.leafletMap = L.map(canvas, { scrollWheelZoom: true }).setView([latitude, longitude], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(state.leafletMap);
    state.leafletLayers = L.layerGroup().addTo(state.leafletMap);
    state.leafletMap.on('click', event => {
      $('originLat').value = event.latlng.lat.toFixed(5);
      $('originLon').value = event.latlng.lng.toFixed(5);
      loadMap();
    });
  }
  canvas.classList.add('leaflet-container');
  const originKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  if (state.mapOrigin !== originKey) {
    state.leafletMap.setView([latitude, longitude], 13);
    state.mapOrigin = originKey;
  }
  setTimeout(() => state.leafletMap?.invalidateSize(), 60);
  return true;
}

async function loadMap(silent = false) {
  const latitude = Number($('originLat').value);
  const longitude = Number($('originLon').value);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    notify('Enter a valid latitude (−90 to 90) and longitude (−180 to 180).', true);
    return;
  }
  if (!silent) $('driverList').innerHTML = '<div class="loading-cell">Searching within 5 km…</div>';

  try {
    const result = await api(`/api/map/drivers?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);
    state.mapData = result.data || [];
    $('mapCount').textContent = `${state.mapData.length} nearby`;
    $('mapUpdated').textContent = new Date(result.updatedAt || Date.now()).toLocaleTimeString();

    if (ensureLeafletMap(latitude, longitude)) {
      state.leafletLayers.clearLayers();
      L.circle([latitude, longitude], {
        radius: result.radiusMeters || 5000,
        color: '#176b52',
        weight: 1,
        dashArray: '5 5',
        fillColor: '#c9f36a',
        fillOpacity: 0.08,
      }).addTo(state.leafletLayers).bindPopup('Search radius: 5 km');
      L.circleMarker([latitude, longitude], {
        radius: 7, color: '#fff', weight: 3, fillColor: '#176b52', fillOpacity: 1,
      }).addTo(state.leafletLayers).bindPopup('<b>Search origin</b>');
      state.mapData.forEach((driver, index) => {
        const [driverLongitude, driverLatitude] = driver.location.coordinates;
        L.circleMarker([driverLatitude, driverLongitude], {
          radius: 5, color: '#fff', weight: 1.5, fillColor: '#83bd42', fillOpacity: 0.95,
        }).addTo(state.leafletLayers).bindPopup(
          `<b>Active driver ${index + 1}</b><br>${esc(shortId(driver.driverId))}<br>${(driver.distanceMeters / 1000).toFixed(2)} km from origin`
        );
      });
    } else {
      renderFallbackMap(latitude, longitude, state.mapData);
    }

    $('driverList').innerHTML = state.mapData.length
      ? state.mapData.slice(0, 50).map((driver, index) => {
        const [driverLongitude, driverLatitude] = driver.location.coordinates;
        const distance = driver.distanceMeters < 1000
          ? `${Math.round(driver.distanceMeters)} m`
          : `${(driver.distanceMeters / 1000).toFixed(2)} km`;
        return `
          <div class="driver-row">
            <div class="driver-icon">⌖</div>
            <div class="driver-meta"><b>Driver ${index + 1} · ${esc(shortId(driver.driverId))}</b><small>${driverLatitude.toFixed(4)}, ${driverLongitude.toFixed(4)} · active</small></div>
            <span class="distance">${distance}</span>
          </div>
        `;
      }).join('')
      : '<div class="empty-state"><b>No nearby active drivers</b><p>No active driver ping was found within 5 km. Driver pings expire after two hours. If this keeps happening, refresh them with: .venv/bin/python data_generation/refresh_driver_pings.py</p></div>';
  } catch (error) {
    $('driverList').innerHTML = `<div class="empty-state"><b>Map query unavailable</b><p>${esc(error.message)}<br>Confirm MongoDB is connected and DriverPings has a 2dsphere index.</p></div>`;
    if (!silent) notify(error.message, true);
  }
}

$('reviewsApply').addEventListener('click', loadReviews);
async function loadReviews() {
  $('ratingChart').innerHTML = '<div class="loading-cell">Loading…</div>';
  $('tagList').innerHTML = '<div class="loading-cell">Loading…</div>';
  $('menuContent').innerHTML = '<div class="loading-cell">Loading menu…</div>';
  try {
    const id = $('reviewRestaurant').value;
    const r = await api(`/api/reviews${id ? `?restaurantId=${encodeURIComponent(id)}` : ''}`);
    const avg = r.overallAverageRating?.[0];
    $('avgRating').textContent = avg ? Number(avg.averageRating).toFixed(2) : '—';
    $('reviewTotal').textContent = avg ? `${Number(avg.reviewCount).toLocaleString()} reviews in selection` : 'No reviews found';
    const ratings = r.ratingDistribution || [], max = Math.max(1,...ratings.map(x => x.count));
    $('ratingChart').innerHTML = ratings.length
      ? [1, 2, 3, 4, 5].map((star) => {
        const row = ratings.find((rating) => Number(rating.rating) === star);
        const count = Number(row?.count || 0);
        const width = (count / max) * 100;

        return `
          <div class="rating-row">
            <b>${star} ★</b>
            <div class="rating-track"><div class="rating-fill" style="width:${width}%"></div></div>
            <span>${count.toLocaleString()}</span>
          </div>
        `;
      }).join('')
      : '<div class="empty-state"><p>No reviews for this selection.</p></div>';
    const tags = r.frequentTags || [], tagMax = Math.max(1,...tags.map(x => x.count));
    $('tagList').innerHTML = tags.length
      ? tags.map((tag) => {
        const width = (tag.count / tagMax) * 100;
        return `
          <div class="tag-row">
            <span class="tag-name">${esc(tag.tag)}</span>
            <div class="tag-track"><i style="width:${width}%"></i></div>
            <b>${Number(tag.count).toLocaleString()}</b>
          </div>
        `;
      }).join('')
      : '<div class="empty-state"><p>No sentiment tags found.</p></div>';
    if (!r.menu) $('menuContent').innerHTML = '<div class="empty-state"><b>No menu document found</b><p>Run the MongoDB seeder to populate the Menus collection.</p></div>';
    else {
      const categories = (r.menu.categories || []).map((category) => {
        const items = (category.items || []).slice(0, 5).map((item) => `
          <div class="menu-item">
            <div>
              <b>${esc(item.name)}</b>
              <small>${esc(item.description || '')}${item.available === false ? ' · Unavailable' : ''}</small>
            </div>
            <span class="menu-price">${money(item.price)}</span>
          </div>
        `).join('');

        return `
          <div class="menu-category">
            <h3>${esc(category.name)}</h3>
            ${items}
          </div>
        `;
      }).join('');

      $('menuContent').innerHTML = `
        <div class="menu-restaurant">${esc(r.menu.restaurantName || 'Restaurant menu')}</div>
        ${categories}
      `;
    }
  }
  catch (e) {
    $('ratingChart').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    $('tagList').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    $('menuContent').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
  }
}
init();
