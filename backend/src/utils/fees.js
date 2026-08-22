const FEE_RATE = Number(process.env.PLATFORM_FEE_RATE ?? 0.10);

/**
 * Computes the buyer-facing breakdown for an order.
 * subtotal = pricePerSheet * quantity
 * platformFee = subtotal * FEE_RATE (always 10% unless overridden via env)
 * total = subtotal + platformFee
 */
function computeOrderTotals(pricePerSheet, quantity) {
  const subtotal = round2(Number(pricePerSheet) * Number(quantity));
  const platformFee = round2(subtotal * FEE_RATE);
  const total = round2(subtotal + platformFee);
  return { subtotal, platformFee, total, feeRate: FEE_RATE };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { computeOrderTotals, FEE_RATE };
