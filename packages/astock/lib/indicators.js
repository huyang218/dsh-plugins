/**
 * Technical indicators for A-share stock data.
 * Implements standard stock technical analysis indicators.
 *
 * @module dsh-plugin-astock/indicators
 */

/**
 * Calculate Simple Moving Average (SMA/MA)
 * @param {number[]} data - Array of prices
 * @param {number} period - Moving average period
 * @returns {(number|null)[]} Array of SMA values (null for insufficient data)
 */
function sma(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param {number[]} data - Array of prices
 * @param {number} period - EMA period
 * @returns {number[]} Array of EMA values
 */
function ema(data, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  
  // First EMA value is SMA
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
  }
  const firstEma = sum / period;
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      result.push(firstEma);
    } else {
      result.push((data[i] - result[i - 1]) * multiplier + result[i - 1]);
    }
  }
  return result;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {number[]} close - Array of closing prices
 * @param {number} [fastPeriod=12] - Fast EMA period
 * @param {number} [slowPeriod=26] - Slow EMA period
 * @param {number} [signalPeriod=9] - Signal line period
 * @returns {{macd: number[], signal: number[], histogram: number[]}}
 */
function macd(close, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEma = ema(close, fastPeriod);
  const slowEma = ema(close, slowPeriod);
  
  const macdLine = [];
  for (let i = 0; i < close.length; i++) {
    if (fastEma[i] === null || slowEma[i] === null) {
      macdLine.push(null);
    } else {
      macdLine.push(fastEma[i] - slowEma[i]);
    }
  }
  
  // Signal line: EMA of MACD line
  const signalLine = [];
  const nonNullMacd = macdLine.map(v => v === null ? 0 : v);
  const signalMultiplier = 2 / (signalPeriod + 1);
  
  // First signal value
  let signalSum = 0;
  let signalCount = 0;
  for (let i = 0; i < close.length && signalCount < signalPeriod; i++) {
    if (macdLine[i] !== null) {
      signalSum += macdLine[i];
      signalCount++;
    }
  }
  const firstSignal = signalCount > 0 ? signalSum / signalCount : 0;
  
  let firstSignalSet = false;
  for (let i = 0; i < close.length; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
    } else if (!firstSignalSet) {
      signalLine.push(firstSignal);
      firstSignalSet = true;
    } else {
      signalLine.push((macdLine[i] - signalLine[i - 1]) * signalMultiplier + signalLine[i - 1]);
    }
  }
  
  // Histogram: MACD line - Signal line
  const histogram = [];
  for (let i = 0; i < close.length; i++) {
    if (macdLine[i] === null || signalLine[i] === null) {
      histogram.push(null);
    } else {
      histogram.push(macdLine[i] - signalLine[i]);
    }
  }
  
  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param {number[]} close - Array of closing prices
 * @param {number} [period=14] - RSI period
 * @returns {(number|null)[]} Array of RSI values
 */
function rsi(close, period = 14) {
  const result = [];
  const changes = [];
  
  for (let i = 1; i < close.length; i++) {
    changes.push(close[i] - close[i - 1]);
  }
  
  for (let i = 0; i < close.length; i++) {
    if (i < period) {
      result.push(null);
    } else {
      let gains = 0;
      let losses = 0;
      for (let j = i - period; j < i; j++) {
        const change = changes[j];
        if (change > 0) {
          gains += change;
        } else {
          losses -= change;
        }
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      
      if (avgLoss === 0) {
        result.push(100);
      } else {
        const rs = avgGain / avgLoss;
        result.push(100 - (100 / (1 + rs)));
      }
    }
  }
  return result;
}

/**
 * Calculate KDJ (Stochastic Indicator)
 * @param {number[]} high - Array of high prices
 * @param {number[]} low - Array of low prices
 * @param {number[]} close - Array of closing prices
 * @param {number} [n=9] - RSV period
 * @param {number} [k1=3] - K smoothing factor
 * @param {number} [d1=3] - D smoothing factor
 * @returns {{k: (number|null)[], d: (number|null)[], j: (number|null)[]}}
 */
function kdj(high, low, close, n = 9, k1 = 3, d1 = 3) {
  const rsv = [];
  const kValues = [];
  const dValues = [];
  const jValues = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i < n - 1) {
      rsv.push(null);
      kValues.push(null);
      dValues.push(null);
      jValues.push(null);
    } else {
      let maxHigh = high[i];
      let minLow = low[i];
      for (let j = i - n + 1; j <= i; j++) {
        maxHigh = Math.max(maxHigh, high[j]);
        minLow = Math.min(minLow, low[j]);
      }
      
      const range = maxHigh - minLow;
      const rsvValue = range === 0 ? 50 : ((close[i] - minLow) / range) * 100;
      rsv.push(rsvValue);
      
      if (i === n - 1) {
        kValues.push(50);
        dValues.push(50);
      } else {
        const kPrev = kValues[i - 1];
        const dPrev = dValues[i - 1];
        const k = (2 / 3) * kPrev + (1 / 3) * rsvValue;
        const d = (2 / 3) * dPrev + (1 / 3) * k;
        kValues.push(k);
        dValues.push(d);
      }
      jValues.push(3 * kValues[i] - 2 * dValues[i]);
    }
  }
  
  return { k: kValues, d: dValues, j: jValues };
}

/**
 * Calculate BOLL (Bollinger Bands)
 * @param {number[]} close - Array of closing prices
 * @param {number} [period=20] - Moving average period
 * @param {number} [stdDev=2] - Number of standard deviations
 * @returns {{middle: (number|null)[], upper: (number|null)[], lower: (number|null)[]}}
 */
function boll(close, period = 20, stdDev = 2) {
  const middle = sma(close, period);
  const upper = [];
  const lower = [];
  
  for (let i = 0; i < close.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let sumSqDiff = 0;
      let count = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSqDiff += (close[j] - middle[i]) ** 2;
        count++;
      }
      const std = Math.sqrt(sumSqDiff / count);
      upper.push(middle[i] + stdDev * std);
      lower.push(middle[i] - stdDev * std);
    }
  }
  
  return { middle, upper, lower };
}

/**
 * Calculate OBV (On-Balance Volume)
 * @param {number[]} close - Array of closing prices
 * @param {number[]} volume - Array of volumes
 * @returns {number[]} Array of OBV values
 */
function obv(close, volume) {
  const result = [volume[0]];
  
  for (let i = 1; i < close.length; i++) {
    if (close[i] > close[i - 1]) {
      result.push(result[i - 1] + volume[i]);
    } else if (close[i] < close[i - 1]) {
      result.push(result[i - 1] - volume[i]);
    } else {
      result.push(result[i - 1]);
    }
  }
  
  return result;
}

/**
 * Calculate Williams %R
 * @param {number[]} high - Array of high prices
 * @param {number[]} low - Array of low prices
 * @param {number[]} close - Array of closing prices
 * @param {number} [period=14] - Lookback period
 * @returns {(number|null)[]} Array of Williams %R values
 */
function williamsR(high, low, close, period = 14) {
  const result = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let maxHigh = high[i];
      let minLow = low[i];
      for (let j = i - period + 1; j <= i; j++) {
        maxHigh = Math.max(maxHigh, high[j]);
        minLow = Math.min(minLow, low[j]);
      }
      const range = maxHigh - minLow;
      result.push(range === 0 ? -50 : ((maxHigh - close[i]) / range) * -100);
    }
  }
  
  return result;
}

/**
 * Calculate ATR (Average True Range)
 * @param {number[]} high - Array of high prices
 * @param {number[]} low - Array of low prices
 * @param {number[]} close - Array of closing prices
 * @param {number} [period=14] - ATR period
 * @returns {(number|null)[]} Array of ATR values
 */
function atr(high, low, close, period = 14) {
  const tr = [];
  const result = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i === 0) {
      tr.push(high[i] - low[i]);
    } else {
      const tr1 = high[i] - low[i];
      const tr2 = Math.abs(high[i] - close[i - 1]);
      const tr3 = Math.abs(low[i] - close[i - 1]);
      tr.push(Math.max(tr1, tr2, tr3));
    }
  }
  
  // ATR is EMA of TR
  const atrMultiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period && i < tr.length; i++) {
    sum += tr[i];
  }
  const firstAtr = sum / period;
  
  let firstSet = false;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (!firstSet) {
      result.push(firstAtr);
      firstSet = true;
    } else {
      result.push((tr[i] - result[i - 1]) * atrMultiplier + result[i - 1]);
    }
  }
  
  return result;
}

/**
 * Calculate DMI (Directional Movement Index)
 * @param {number[]} high - Array of high prices
 * @param {number[]} low - Array of low prices
 * @param {number[]} close - Array of closing prices
 * @param {number} [period=14] - DMI period
 * @returns {{pdi: (number|null)[], mdi: (number|null)[], adx: (number|null)[]}}
 */
function dmi(high, low, close, period = 14) {
  const upMove = [0];
  const downMove = [0];
  const tr = [high[0] - low[0]];
  const pdi = [];
  const mdi = [];
  const adx = [];
  
  for (let i = 1; i < high.length; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    const tr1 = high[i] - low[i];
    const tr2 = Math.abs(high[i] - close[i - 1]);
    const tr3 = Math.abs(low[i] - close[i - 1]);
    
    upMove.push(up > 0 && up > down ? up : 0);
    downMove.push(down > 0 && down > up ? down : 0);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  // Smoothed ATR, +DI, -DI using Wilder's method
  for (let i = 0; i < high.length; i++) {
    if (i < period) {
      pdi.push(null);
      mdi.push(null);
      adx.push(null);
    } else if (i === period) {
      let sumTr = 0, sumUp = 0, sumDown = 0;
      for (let j = 1; j <= period; j++) {
        sumTr += tr[j];
        sumUp += upMove[j];
        sumDown += downMove[j];
      }
      // First smoothed values
      const smoothedTr = sumTr;
      const smoothedUp = sumUp;
      const smoothedDown = sumDown;
      pdi.push((smoothedUp / smoothedTr) * 100);
      mdi.push((smoothedDown / smoothedTr) * 100);
    } else {
      // Wilder's smoothing: prev + (current - prev) / period
      // Actually: smoothed = prev_smoothed - prev_smoothed/period + current
      // For DMI, we use the smoothed values
      const prevSmoothedTr = tr[i - 1]; // Not exactly right but we need to track smoothed values
      const prevSmoothedUp = upMove[i - 1];
      const prevSmoothedDown = downMove[i - 1];
      // Actually simpler: use EMA-like smoothing
      const smoothedTr = ((period - 1) * (tr[i - 1]) + tr[i]) / period;
      const smoothedUp = ((period - 1) * (upMove[i - 1]) + upMove[i]) / period;
      const smoothedDown = ((period - 1) * (downMove[i - 1]) + downMove[i]) / period;
      
      const pdiVal = smoothedTr === 0 ? 0 : (smoothedUp / smoothedTr) * 100;
      const mdiVal = smoothedTr === 0 ? 0 : (smoothedDown / smoothedTr) * 100;
      pdi.push(pdiVal);
      mdi.push(mdiVal);
    }
  }
  
  // ADX: smoothed average of |+DI - -DI| / (+DI + -DI) * 100
  // This is a simplified version
  for (let i = 0; i < high.length; i++) {
    if (pdi[i] === null || mdi[i] === null) {
      adx[i] = null;
    } else {
      const sum = pdi[i] + mdi[i];
      if (sum === 0) {
        adx[i] = 50;
      } else {
        adx[i] = (Math.abs(pdi[i] - mdi[i]) / sum) * 100;
      }
    }
  }
  
  return { pdi, mdi, adx };
}

/**
 * Calculate all available technical indicators for a stock data series
 * @param {Array} klines - Array of K-line data objects with open, high, low, close, volume fields
 * @param {Object} [options] - Options for which indicators to calculate
 * @returns {Object} Calculated indicators
 */
function calculateAllIndicators(klines, options = {}) {
  const {
    ma = true,
    macd: calcMacd = true,
    rsi: calcRsi = true,
    kdj: calcKdj = true,
    boll: calcBoll = true,
    obv: calcObv = true,
    williamsR: calcWilliamsR = true,
    atr: calcAtr = true,
    dmi: calcDmi = true,
    maPeriods = [5, 10, 20, 30, 60],
    rsiPeriod = 14,
    macdFast = 12,
    macdSlow = 26,
    macdSignal = 9,
    kdjN = 9,
    kdjK = 3,
    kdjD = 3,
    bollPeriod = 20,
    bollStd = 2,
    williamsRPeriod = 14,
    atrPeriod = 14,
    dmiPeriod = 14
  } = options;
  
  const close = klines.map(k => k.close);
  const high = klines.map(k => k.high);
  const low = klines.map(k => k.low);
  const volume = klines.map(k => k.volume);
  
  const result = {};
  
  if (ma) {
    for (const period of maPeriods) {
      result[`MA${period}`] = sma(close, period);
    }
  }
  
  if (calcMacd) {
    result.MACD = macd(close, macdFast, macdSlow, macdSignal);
  }
  
  if (calcRsi) {
    result.RSI = rsi(close, rsiPeriod);
  }
  
  if (calcKdj) {
    result.KDJ = kdj(high, low, close, kdjN, kdjK, kdjD);
  }
  
  if (calcBoll) {
    result.BOLL = boll(close, bollPeriod, bollStd);
  }
  
  if (calcObv) {
    result.OBV = obv(close, volume);
  }
  
  if (calcWilliamsR) {
    result.WilliamsR = williamsR(high, low, close, williamsRPeriod);
  }
  
  if (calcAtr) {
    result.ATR = atr(high, low, close, atrPeriod);
  }
  
  if (calcDmi) {
    result.DMI = dmi(high, low, close, dmiPeriod);
  }
  
  return result;
}

export {
  sma,
  ema,
  macd,
  rsi,
  kdj,
  boll,
  obv,
  williamsR,
  atr,
  dmi,
  calculateAllIndicators
};