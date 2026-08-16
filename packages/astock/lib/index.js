/**
 * DSH Plugin: A-share (Chinese stock market) data plugin
 *
 * Provides tools for fetching A-share stock K-line data and calculating
 * standard technical indicators.
 *
 * Tools:
 * - astock_data: Fetch stock K-line data (daily, weekly, monthly, hourly, etc.)
 * - astock_indicators: Calculate technical indicators on stock data
 * - astock_quote: Fetch real-time stock quote
 * - astock_search: Search for stocks by keyword
 *
 * @module dsh-plugin-astock
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { fetchKline, fetchQuote, searchStocks, PERIOD_NAMES, normalizeCode } from './data.js';
import { calculateAllIndicators, sma, ema, macd, rsi, kdj, boll, obv, williamsR, atr, dmi } from './indicators.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'dsh-plugin-astock';

/** Services required by this plugin. */
const inject = ['tools', 'systemPrompt'];

/** Indicator option descriptions */
const INDICATOR_OPTIONS = {
  ma: { type: 'boolean', default: true, description: 'Calculate moving averages (MA5, MA10, MA20, MA30, MA60)' },
  maPeriods: { type: 'array', default: [5, 10, 20, 30, 60], description: 'Custom MA periods (e.g., [5,10,20,30,60])' },
  macd: { type: 'boolean', default: true, description: 'Calculate MACD (fast=12, slow=26, signal=9)' },
  macdFast: { type: 'number', default: 12, description: 'MACD fast EMA period' },
  macdSlow: { type: 'number', default: 26, description: 'MACD slow EMA period' },
  macdSignal: { type: 'number', default: 9, description: 'MACD signal line period' },
  rsi: { type: 'boolean', default: true, description: 'Calculate RSI (period=14)' },
  rsiPeriod: { type: 'number', default: 14, description: 'RSI period' },
  kdj: { type: 'boolean', default: true, description: 'Calculate KDJ (N=9, K=3, D=3)' },
  kdjN: { type: 'number', default: 9, description: 'KDJ RSV period' },
  kdjK: { type: 'number', default: 3, description: 'KDJ K smoothing factor' },
  kdjD: { type: 'number', default: 3, description: 'KDJ D smoothing factor' },
  boll: { type: 'boolean', default: true, description: 'Calculate Bollinger Bands (period=20, std=2)' },
  bollPeriod: { type: 'number', default: 20, description: 'Bollinger Bands MA period' },
  bollStd: { type: 'number', default: 2, description: 'Bollinger Bands standard deviation multiplier' },
  obv: { type: 'boolean', default: true, description: 'Calculate On-Balance Volume' },
  williamsR: { type: 'boolean', default: true, description: 'Calculate Williams %R (period=14)' },
  williamsRPeriod: { type: 'number', default: 14, description: 'Williams %R period' },
  atr: { type: 'boolean', default: true, description: 'Calculate Average True Range (period=14)' },
  atrPeriod: { type: 'number', default: 14, description: 'ATR period' },
  dmi: { type: 'boolean', default: true, description: 'Calculate Directional Movement Index (period=14)' },
  dmiPeriod: { type: 'number', default: 14, description: 'DMI period' },
};

/**
 * Format K-line data for output
 */
function formatKlineOutput(data) {
  const lines = [];
  const header = `股票: ${data.name} (${data.code})\n市场: ${data.market}\n周期: ${data.periodName}\n数据条数: ${data.total}`;
  lines.push(header);
  lines.push('');
  
  // Show the last 10 K-lines (or less if fewer available)
  const showCount = Math.min(10, data.klines.length);
  const startIdx = data.klines.length - showCount;
  
  const tableHeader = '日期        | 开盘     | 收盘     | 最高     | 最低     | 成交量(万) | 涨跌幅(%)';
  lines.push(tableHeader);
  lines.push('-'.repeat(tableHeader.length));
  
  for (let i = startIdx; i < data.klines.length; i++) {
    const k = data.klines[i];
    const vol = (k.volume / 10000).toFixed(2);
    lines.push(
      `${k.date} | ${k.open.toFixed(2)}  | ${k.close.toFixed(2)}  | ${k.high.toFixed(2)}  | ${k.low.toFixed(2)}  | ${vol.padStart(8)} | ${k.changePct.toFixed(2)}`
    );
  }
  
  lines.push('');
  lines.push(`(Showing last ${showCount} of ${data.total} records. Request more data with limit parameter.)`);
  
  return lines.join('\n');
}

/**
 * Format indicator results for output
 */
function formatIndicatorOutput(klines, indicators, options) {
  const lines = [];
  const showCount = Math.min(10, klines.length);
  const startIdx = klines.length - showCount;
  
  lines.push('技术指标计算结果:');
  lines.push('');
  
  // Build a combined table with latest values
  for (let i = startIdx; i < klines.length; i++) {
    const k = klines[i];
    const row = [`日期: ${k.date}`];
    row.push(`  收盘: ${k.close.toFixed(2)}`);
    
    // MA values
    if (indicators.MA) {
      const maVals = [];
      for (const period of (options.maPeriods || [5, 10, 20, 30, 60])) {
        const key = `MA${period}`;
        if (indicators[key] && indicators[key][i] !== null) {
          maVals.push(`MA${period}=${indicators[key][i].toFixed(2)}`);
        }
      }
      if (maVals.length > 0) row.push(`  ${maVals.join(' ')}`);
    }
    
    // MACD
    if (indicators.MACD && indicators.MACD.macd[i] !== null) {
      row.push(`  MACD: ${indicators.MACD.macd[i].toFixed(4)}`);
      row.push(`  信号: ${indicators.MACD.signal[i].toFixed(4)}`);
      row.push(`  柱状: ${indicators.MACD.histogram[i].toFixed(4)}`);
    }
    
    // RSI
    if (indicators.RSI && indicators.RSI[i] !== null) {
      row.push(`  RSI: ${indicators.RSI[i].toFixed(2)}`);
    }
    
    // KDJ
    if (indicators.KDJ && indicators.KDJ.k[i] !== null) {
      row.push(`  K: ${indicators.KDJ.k[i].toFixed(2)} D: ${indicators.KDJ.d[i].toFixed(2)} J: ${indicators.KDJ.j[i].toFixed(2)}`);
    }
    
    // BOLL
    if (indicators.BOLL && indicators.BOLL.middle[i] !== null) {
      row.push(`  BOLL上: ${indicators.BOLL.upper[i].toFixed(2)} 中: ${indicators.BOLL.middle[i].toFixed(2)} 下: ${indicators.BOLL.lower[i].toFixed(2)}`);
    }
    
    // OBV
    if (indicators.OBV && indicators.OBV[i] !== null) {
      row.push(`  OBV: ${indicators.OBV[i].toFixed(0)}`);
    }
    
    // Williams %R
    if (indicators.WilliamsR && indicators.WilliamsR[i] !== null) {
      row.push(`  WR: ${indicators.WilliamsR[i].toFixed(2)}`);
    }
    
    // ATR
    if (indicators.ATR && indicators.ATR[i] !== null) {
      row.push(`  ATR: ${indicators.ATR[i].toFixed(4)}`);
    }
    
    // DMI
    if (indicators.DMI && indicators.DMI.pdi[i] !== null) {
      row.push(`  +DI: ${indicators.DMI.pdi[i].toFixed(2)} -DI: ${indicators.DMI.mdi[i].toFixed(2)} ADX: ${indicators.DMI.adx[i].toFixed(2)}`);
    }
    
    lines.push(row.join('\n'));
    lines.push('');
  }
  
  lines.push(`(Showing last ${showCount} records with indicators)`);
  
  return lines.join('\n');
}

/**
 * Register the tools
 */
function apply(ctx, config) {
  // ── Tool: astock_data ──
  ctx.systemPrompt.section({
    name: 'tool:astock_data',
    order: 140,
    text: 'Use the astock_data tool to fetch A-share (Chinese stock market) K-line data. Supports daily, weekly, monthly, yearly, 5min, 15min, 30min, and 60min periods. Use fq=true for forward-adjusted (前复权) data. The stock code can be in any format: "000001", "sh000001", "600519", etc.',
  });

  ctx.tools.register(defineTool({
    name: 'astock_data',
    description: 'Fetch A-share (Chinese stock market) K-line (candlestick) data. Supports daily, weekly, monthly, and intraday periods.',
    parameters: {
      code: {
        type: 'string',
        required: true,
        description: 'Stock code, e.g., "000001" (平安银行), "600519" (贵州茅台), "300750" (宁德时代)',
      },
      period: {
        type: 'string',
        default: 'daily',
        description: 'K-line period: daily (日K), weekly (周K), monthly (月K), yearly (年K), 5min, 15min, 30min, 60min',
      },
      limit: {
        type: 'number',
        default: 100,
        description: 'Number of K-lines to fetch (max 1000)',
      },
      fq: {
        type: 'boolean',
        default: true,
        description: 'Use forward-adjusted (前复权) data. Set to false for unadjusted data.',
      },
      beginDate: {
        type: 'string',
        default: '',
        description: 'Start date in YYYYMMDD format (e.g., "20240101"). Leave empty for earliest available.',
      },
      endDate: {
        type: 'string',
        default: '',
        description: 'End date in YYYYMMDD format (e.g., "20241231"). Leave empty for latest.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          market: { type: 'string' },
          period: { type: 'string' },
          periodName: { type: 'string' },
          total: { type: 'integer' },
          klines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                date: { type: 'string' },
                open: { type: 'number' },
                close: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' },
                volume: { type: 'number' },
                amount: { type: 'number' },
                amplitude: { type: 'number' },
                changePct: { type: 'number' },
                change: { type: 'number' },
                turnoverRate: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatKlineOutput(value) }],
      presentationMeta: (_args, value) => ({
        code: value.code,
        name: value.name,
        market: value.market,
        period: value.period,
        periodName: value.periodName,
        total: value.total,
        latestKline: value.klines.length > 0 ? value.klines[value.klines.length - 1] : null,
      }),
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await fetchKline(args.code, {
        period: args.period || 'daily',
        limit: args.limit || 100,
        fq: args.fq !== false,
        beginDate: args.beginDate || undefined,
        endDate: args.endDate || undefined,
      }, exec.signal);
      return result;
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `${args.code} ${args.period || 'daily'}`,
      kind: 'stock-kline',
      rawInput: args.code,
    }),
    presentResult: (args, result) => {
      if (result.isError) return undefined;
      return {
        card: 'generic',
        title: `${result.name || args.code} - ${result.periodName}`,
        kind: 'stock-kline',
        code: result.code,
        name: result.name,
        total: result.total,
        latestKline: result.klines?.length > 0 ? result.klines[result.klines.length - 1] : null,
      };
    },
  }));

  // ── Tool: astock_indicators ──
  ctx.systemPrompt.section({
    name: 'tool:astock_indicators',
    order: 141,
    text: 'Use the astock_indicators tool to fetch A-share K-line data AND calculate technical indicators in one call. Supports MA, MACD, RSI, KDJ, BOLL, OBV, Williams %R, ATR, and DMI. Set individual indicator flags to false to skip them and save computation.',
  });

  ctx.tools.register(defineTool({
    name: 'astock_indicators',
    description: 'Fetch A-share stock K-line data and calculate technical indicators (MA, MACD, RSI, KDJ, BOLL, OBV, Williams %R, ATR, DMI) in one call.',
    parameters: {
      code: {
        type: 'string',
        required: true,
        description: 'Stock code, e.g., "000001", "600519", "300750"',
      },
      period: {
        type: 'string',
        default: 'daily',
        description: 'K-line period: daily, weekly, monthly, 60min, 30min, etc.',
      },
      limit: {
        type: 'number',
        default: 100,
        description: 'Number of K-lines to fetch for calculation (max 1000, need enough data for indicators)',
      },
      fq: {
        type: 'boolean',
        default: true,
        description: 'Use forward-adjusted (前复权) data',
      },
      ma: { type: 'boolean', default: true, description: 'Calculate MA' },
      maPeriods: { type: 'array', default: [5, 10, 20, 30, 60], description: 'MA periods, e.g., [5,10,20,30,60]' },
      macd: { type: 'boolean', default: true, description: 'Calculate MACD' },
      macdFast: { type: 'number', default: 12, description: 'MACD fast period' },
      macdSlow: { type: 'number', default: 26, description: 'MACD slow period' },
      macdSignal: { type: 'number', default: 9, description: 'MACD signal period' },
      rsi: { type: 'boolean', default: true, description: 'Calculate RSI' },
      rsiPeriod: { type: 'number', default: 14, description: 'RSI period' },
      kdj: { type: 'boolean', default: true, description: 'Calculate KDJ' },
      boll: { type: 'boolean', default: true, description: 'Calculate Bollinger Bands' },
      obv: { type: 'boolean', default: true, description: 'Calculate OBV' },
      williamsR: { type: 'boolean', default: true, description: 'Calculate Williams %R' },
      atr: { type: 'boolean', default: true, description: 'Calculate ATR' },
      dmi: { type: 'boolean', default: true, description: 'Calculate DMI' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          period: { type: 'string' },
          periodName: { type: 'string' },
          total: { type: 'integer' },
          klines: { type: 'array' },
          indicators: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatIndicatorOutput(value.klines, value.indicators, value._options || {}),
      }],
      presentationMeta: (_args, value) => ({
        code: value.code,
        name: value.name,
        period: value.period,
        total: value.total,
        indicators: Object.keys(value.indicators || {}),
      }),
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const indicatorOptions = {
        ma: args.ma !== false,
        maPeriods: args.maPeriods || [5, 10, 20, 30, 60],
        macd: args.macd !== false,
        macdFast: args.macdFast || 12,
        macdSlow: args.macdSlow || 26,
        macdSignal: args.macdSignal || 9,
        rsi: args.rsi !== false,
        rsiPeriod: args.rsiPeriod || 14,
        kdj: args.kdj !== false,
        boll: args.boll !== false,
        obv: args.obv !== false,
        williamsR: args.williamsR !== false,
        atr: args.atr !== false,
        dmi: args.dmi !== false,
      };

      // Fetch K-line data with enough history for indicators
      const data = await fetchKline(args.code, {
        period: args.period || 'daily',
        limit: args.limit || 100,
        fq: args.fq !== false,
      });

      // Calculate indicators
      const indicators = calculateAllIndicators(data.klines, indicatorOptions);

      return {
        code: data.code,
        name: data.name,
        period: data.period,
        periodName: data.periodName,
        total: data.total,
        klines: data.klines,
        indicators,
        _options: indicatorOptions,
      };
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `${args.code} - 技术指标`,
      kind: 'stock-indicators',
      rawInput: args.code,
    }),
    presentResult: (args, result) => {
      if (result.isError) return undefined;
      return {
        card: 'generic',
        title: `${result.name || args.code} - 技术指标`,
        kind: 'stock-indicators',
        code: result.code,
        name: result.name,
        indicators: Object.keys(result.indicators || {}),
      };
    },
  }));

  // ── Tool: astock_quote ──
  ctx.systemPrompt.section({
    name: 'tool:astock_quote',
    order: 142,
    text: 'Use the astock_quote tool to get a real-time quote for an A-share stock, including current price, open, high, low, volume, and more.',
  });

  ctx.tools.register(defineTool({
    name: 'astock_quote',
    description: 'Fetch real-time quote for an A-share stock (current price, open, high, low, volume, etc.)',
    parameters: {
      code: {
        type: 'string',
        required: true,
        description: 'Stock code, e.g., "000001", "600519"',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          market: { type: 'string' },
          open: { type: 'number' },
          high: { type: 'number' },
          low: { type: 'number' },
          price: { type: 'number' },
          preClose: { type: 'number' },
          volume: { type: 'number' },
          amount: { type: 'number' },
          change: { type: 'number' },
          changePct: { type: 'number' },
          turnoverRate: { type: 'number' },
          amplitude: { type: 'number' },
          pe: { type: 'number' },
          totalMarketCap: { type: 'number' },
          circulatingMarketCap: { type: 'number' },
        },
      },
      render: (_args, value) => {
        const lines = [];
        lines.push(`实时行情 - ${value.name} (${value.code})`);
        lines.push('─'.repeat(40));
        lines.push(`当前价格: ${value.price?.toFixed(2) || 'N/A'}`);
        lines.push(`开盘价:   ${value.open?.toFixed(2) || 'N/A'}`);
        lines.push(`最高价:   ${value.high?.toFixed(2) || 'N/A'}`);
        lines.push(`最低价:   ${value.low?.toFixed(2) || 'N/A'}`);
        lines.push(`昨收价:   ${value.preClose?.toFixed(2) || 'N/A'}`);
        lines.push(`涨跌额:   ${value.change?.toFixed(2) || 'N/A'}`);
        lines.push(`涨跌幅:   ${value.changePct?.toFixed(2) || 'N/A'}%`);
        lines.push(`成交量:   ${value.volume ? (value.volume / 10000).toFixed(2) + '万手' : 'N/A'}`);
        lines.push(`成交额:   ${value.amount ? (value.amount / 100000000).toFixed(2) + '亿' : 'N/A'}`);
        if (value.turnoverRate) lines.push(`换手率:   ${value.turnoverRate.toFixed(2)}%`);
        if (value.amplitude) lines.push(`振幅:     ${value.amplitude.toFixed(2)}%`);
        if (value.pe) lines.push(`市盈率:   ${value.pe.toFixed(2)}`);
        if (value.totalMarketCap) lines.push(`总市值:   ${(value.totalMarketCap / 100000000).toFixed(2)}亿`);
        if (value.circulatingMarketCap) lines.push(`流通市值: ${(value.circulatingMarketCap / 100000000).toFixed(2)}亿`);
        return [{ type: 'text', text: lines.join('\n') }];
      },
      presentationMeta: (_args, value) => ({
        code: value.code,
        name: value.name,
        price: value.price,
        changePct: value.changePct,
      }),
    },
    timeoutMs: 15000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return await fetchQuote(args.code);
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `${args.code} 实时行情`,
      kind: 'stock-quote',
      rawInput: args.code,
    }),
    presentResult: (args, result) => {
      if (result.isError) return undefined;
      return {
        card: 'generic',
        title: `${result.name || args.code} - 实时行情`,
        kind: 'stock-quote',
        code: result.code,
        name: result.name,
        price: result.price,
        changePct: result.changePct,
      };
    },
  }));

  // ── Tool: astock_search ──
  ctx.systemPrompt.section({
    name: 'tool:astock_search',
    order: 143,
    text: 'Use the astock_search tool to search for A-share stocks by code, name, or pinyin keyword.',
  });

  ctx.tools.register(defineTool({
    name: 'astock_search',
    description: 'Search for A-share stocks by code, name, or pinyin keyword.',
    parameters: {
      keyword: {
        type: 'string',
        required: true,
        description: 'Search keyword: stock code, name, or pinyin (e.g., "茅台", "pingan", "000001")',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string' },
                name: { type: 'string' },
                market: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.results.length === 0) {
          return [{ type: 'text', text: '未找到匹配的股票。' }];
        }
        const lines = [`找到 ${value.results.length} 个匹配结果:\n`];
        lines.push('代码      | 名称       | 市场');
        lines.push('─'.repeat(40));
        for (const stock of value.results) {
          lines.push(`${stock.code.padEnd(6)} | ${(stock.name || '').padEnd(8)} | ${stock.market || '--'}`);
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
      presentationMeta: (_args, value) => ({
        count: value.results.length,
        results: value.results.slice(0, 5),
      }),
    },
    timeoutMs: 15000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const stocks = await searchStocks(args.keyword);
      return {
        results: stocks.map(s => ({
          code: s.code,
          name: s.name,
          market: s.market,
        })),
      };
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `搜索: ${args.keyword}`,
      kind: 'stock-search',
      rawInput: args.keyword,
    }),
    presentResult: (args, result) => {
      if (result.isError) return undefined;
      return {
        card: 'generic',
        title: `搜索: ${args.keyword}`,
        kind: 'stock-search',
        keyword: args.keyword,
        count: result.results?.length || 0,
      };
    },
  }));
}

export { apply, name, inject };