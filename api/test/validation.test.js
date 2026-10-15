const test = require('node:test');
const assert = require('node:assert/strict');
const { isUuid, parsePageArgs, isValidCheckout } = require('../lib/validation');
test('accepts UUIDs and rejects malformed IDs', () => {
  assert.equal(isUuid('346c9f49-ef62-42a6-a7d9-75d42837527d'), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);
});
test('pagination is bounded and safe', () => {
  assert.deepEqual(parsePageArgs({
    page: '-5', limit: '10000', q: '  cafe  '
  }), {
    page: 1, limit: 100, q: 'cafe'
  });
  assert.deepEqual(parsePageArgs({}), {
    page: 1, limit: 20, q: ''
  });
});
test('checkout validation rejects invalid references and nonpositive amounts', () => {
  const base = {
    userId: '346c9f49-ef62-42a6-a7d9-75d42837527d', restaurantId: '346c9f49-ef62-42a6-a7d9-75d42837527d', amount: 20
  };
  assert.equal(isValidCheckout(base), true);
  assert.equal(isValidCheckout({
    ...base, amount: 0
  }), false);
  assert.equal(isValidCheckout({
    ...base, amount: 'NaN'
  }), false);
  assert.equal(isValidCheckout({
    ...base, userId: 'bad-id'
  }), false);
  assert.equal(isValidCheckout({
    ...base, amount: 100000000
  }), false);
  assert.equal(isValidCheckout({
    ...base, amount: 1e21
  }), false);
});
