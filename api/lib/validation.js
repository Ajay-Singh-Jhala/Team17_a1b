function isUuid(value) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(String(value || ''));
}
function parsePageArgs(query = {}) {
  return {
    page: Math.max(1, parseInt(query.page || '1', 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20)),
    q: String(query.q || '').trim(),
  };
}
function isValidCheckout({
  userId, restaurantId, amount
}) {
  // wallet/order amounts are DECIMAL(10,2): anything above this overflows the
  // column (and toFixed() switches to exponent notation above 1e21).
  const MAX_AMOUNT = 99999999.99;
  return (
    isUuid(userId) && isUuid(restaurantId) &&
    Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= MAX_AMOUNT
  );
}
module.exports = {
  isUuid, parsePageArgs, isValidCheckout
};
