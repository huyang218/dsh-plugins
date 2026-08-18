/**
 * Portfolio arithmetic: pure functions over stored entries and fetched quotes.
 *
 * Everything here is deliberately clock-free and network-free, because these
 * are the numbers a person will act on and they have to be checkable by
 * passing values in.
 *
 * @module dsh-plugin-aportfolio/valuation
 */

/**
 * Value one position against its current price.
 *
 * A missing price yields a row WITHOUT market value or P/L rather than a row
 * with zeros: a position whose quote failed is unknown, not worthless, and a
 * zero here would quietly drag the portfolio total down.
 * @param {Object} entry - `{ code, shares, cost, note }`
 * @param {Object} [quote] - `{ name, price, changePct }`
 * @returns {Object} The valued row
 */
function valuePosition(entry, quote) {
  const row = { code: entry.code, shares: entry.shares };
  if (entry.cost !== undefined) row.cost = entry.cost;
  if (entry.note) row.note = entry.note;
  if (quote?.name) row.name = quote.name;
  if (quote?.changePct !== undefined) row.changePct = quote.changePct;
  if (quote?.price === undefined) return row;

  row.price = quote.price;
  row.marketValue = quote.price * entry.shares;
  if (entry.cost !== undefined && entry.cost > 0) {
    row.costValue = entry.cost * entry.shares;
    row.profit = row.marketValue - row.costValue;
    row.profitPct = (quote.price / entry.cost - 1) * 100;
  }
  return row;
}

/**
 * Totals across valued positions, plus each row's weight.
 *
 * Rows whose price is unknown are counted separately instead of being folded
 * in at zero — a total that silently omits a third of the book is worse than
 * one that says so.
 * @param {Array<Object>} rows - Valued positions
 * @returns {Object} `{ rows, marketValue, costValue, profit, profitPct, unpriced }`
 */
function summarize(rows) {
  const priced = rows.filter(row => row.marketValue !== undefined);
  const marketValue = priced.reduce((sum, row) => sum + row.marketValue, 0);
  const withCost = priced.filter(row => row.costValue !== undefined);
  const costValue = withCost.reduce((sum, row) => sum + row.costValue, 0);

  const weighted = rows.map(row => (row.marketValue === undefined || marketValue <= 0
    ? row
    : { ...row, weightPct: (row.marketValue / marketValue) * 100 }));

  const summary = {
    rows: weighted,
    marketValue,
    unpriced: rows.length - priced.length,
  };
  if (withCost.length > 0) {
    const pricedCost = withCost.reduce((sum, row) => sum + row.marketValue, 0);
    summary.costValue = costValue;
    summary.profit = pricedCost - costValue;
    if (costValue > 0) summary.profitPct = (pricedCost / costValue - 1) * 100;
  }
  return summary;
}

/**
 * Which watchlist entries have reached a price target.
 *
 * A target is a standing instruction from the user, so a hit is reported even
 * when the move is small; the point is that the level was crossed.
 * @param {Object} entry - `{ code, targetBuy, targetSell }`
 * @param {Object} [quote] - `{ price }`
 * @returns {string|undefined} 'buy' | 'sell' | undefined
 */
function targetHit(entry, quote) {
  if (quote?.price === undefined) return undefined;
  if (entry.targetBuy !== undefined && quote.price <= entry.targetBuy) return 'buy';
  if (entry.targetSell !== undefined && quote.price >= entry.targetSell) return 'sell';
  return undefined;
}

/** Money in 元, shortened the way a Chinese statement reads. */
function money(value) {
  const abs = Math.abs(value);
  if (abs >= 1e8) return (value / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (value / 1e4).toFixed(2) + '万';
  return value.toFixed(2);
}

export { valuePosition, summarize, targetHit, money };
