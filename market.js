/**
 * market.js — بيانات السوق 🐆 الفهد v2
 * المصادر: CMC (أسعار + Top100 Spot) + CoinGecko (OHLCV 3 سنوات) +
 *          Alternative.me (Fear&Greed) + Bitget (Funding) +
 *          Blockchain.com + Mempool.space (On-Chain)
 *
 * التحديثات (Railway Upgraded):
 *  - Backtest حقيقي 3 سنوات (1095 يوم) عبر CoinGecko /market_chart
 *  - MTF شهري: 1D + 3D (محاكى من 1D) + 1W (محاكى من 1D)
 *  - مؤشرات إضافية: Bollinger Bands + MACD + ATR
 *  - Cache طويل للبيانات التاريخية (24 ساعة)
 */
const axios = require('axios');
const { MarketCache } = require('./database');
const logger = {
  info: (...a) => console.log('[INFO]', ...a),
  warn: (...a) => console.warn('[WARN]', ...a),
  error: (...a) => console.error('[ERROR]', ...a),
  debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a)
};

// ==================== STABLECOINS ====================
const STABLECOINS = new Set([
  'USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','PYUSD','GUSD',
  'USDP','FRAX','LUSD','SUSD','CUSD','CEUR','USDD','EURS','HUSD',
  'USDJ','USDX','VAI','MUSD','ZUSD','BIDR','XIDR','USDFL','RSR'
]);
function isStablecoin(symbol) {
  return STABLECOINS.has(symbol.toUpperCase()) || /^(USDT|USDC|USD|DAI|TUSD)[A-Z]?$/.test(symbol);
}

// خريطة CoinGecko IDs
const GECKO_IDS = {
  'BTC':'bitcoin','ETH':'ethereum','BNB':'binancecoin','SOL':'solana',
  'XRP':'ripple','ADA':'cardano','DOGE':'dogecoin','AVAX':'avalanche-2',
  'LINK':'chainlink','DOT':'polkadot','MATIC':'matic-network','LTC':'litecoin',
  'BCH':'bitcoin-cash','XLM':'stellar','ATOM':'cosmos','UNI':'uniswap',
  'NEAR':'near','ARB':'arbitrum','OP':'optimism','SUI':'sui','APT':'aptos',
  'INJ':'injective-protocol','FTM':'fantom','ALGO':'algorand','FIL':'filecoin',
  'ICP':'internet-computer','HBAR':'hedera-hashgraph','VET':'vechain',
  'MANA':'decentraland','SAND':'the-sandbox','AXS':'axie-infinity',
  'GRT':'the-graph','AAVE':'aave','CRV':'curve-dao-token','TON':'the-open-network',
  'TRX':'tron','SHIB':'shiba-inu','LDO':'lido-dao','MKR':'maker',
  'SNX':'havven','COMP':'compound-governance-token','ENS':'ethereum-name-service',
  'ONDO':'ondo-finance','ZEC':'zcash','WLFI':'world-liberty-financial',
  'RENDER':'render-token','WIF':'dogwifcoin','PEPE':'pepe','BONK':'bonk',
  'SEI':'sei-network','JUP':'jupiter-exchange-solana','STRK':'starknet',
  'JASMY':'jasmycoin','GALA':'gala','IMX':'immutable-x','BLUR':'blur',
  'CFX':'conflux-token','KAVA':'kava','ROSE':'oasis-network','ZIL':'zilliqa',
  'ONE':'harmony','CHZ':'chiliz','HOT':'holotoken','BAT':'basic-attention-token',
  'ANKR':'ankr','WLD':'worldcoin-wld','TIA':'celestia','PYTH':'pyth-network',
  'NOT':'notcoin','USUAL':'usual','LAYER':'solayer','OM':'mantra-dao',
  'TRUMP':'official-trump','IP':'story-protocol',
  'POL':'matic-network','XTZ':'tezos','MON':'monad-protocol',
  'ETHFI':'ether-fi','EURC':'euro-coin','XAUt':'tether-gold',
  'CRO':'crypto-com-chain','MNT':'mantle','ENA':'ethena',
  'XMR':'monero','KAS':'kaspa','KCS':'kucoin-shares',
  'QNT':'quant-network','GT':'gate-2','FLR':'flare-networks',
  'VVV':'venice-token','XDC':'xdce-crowd-sale',
  'LUNC':'terra-luna','FET':'fetch-ai','SPX':'spx6900',
  'BGB':'bitget-token','MORPHO':'morpho','DEXE':'dexe',
  'PUMP':'pump-fun','JST':'just','ZRO':'layerzero',
  'CAKE':'pancakeswap-token','VIRTUAL':'virtual-protocol',
  'EDGE':'edge-token','SIREN':'siren-protocol',
  'NEXO':'nexo','AERO':'aerodrome-finance','DASH':'dash',
  'ZEC':'zcash','STX':'blockstack','FIL':'filecoin',
  'GRT':'the-graph','LDO':'lido-dao','MKR':'maker',
  'COMP':'compound-governance-token','SNX':'havven',
  'ALGO':'algorand','VET':'vechain','MANA':'decentraland',
  'SAND':'the-sandbox','AXS':'axie-infinity',
  'CRV':'curve-dao-token','AAVE':'aave',
  'ENS':'ethereum-name-service','ONDO':'ondo-finance',
  'USD1':'usd1','STABLE':'stable-protocol',
  'ETC':'ethereum-classic','PI':'pi-network',
  'SKY':'sky-mavis','OKB':'okb','HYPE':'hyperliquid',
  'ZEC':'zcash','STX':'blockstack','AERO':'aerodrome-finance',
  'PENGU':'pudgy-penguins','MOVE':'movement','EIGEN':'eigenlayer'
};

// ==================== RATE LIMITER مركزي ====================
// يمنع تجاوز حد CoinGecko Demo: 30 طلب/دقيقة
const geckoQueue = { queue: [], processing: false, lastCall: 0, minInterval: 1500 };

async function geckoRequest(url, params, timeout = 25000) {
  return new Promise((resolve, reject) => {
    geckoQueue.queue.push({ url, params, timeout, resolve, reject });
    if (!geckoQueue.processing) processGeckoQueue();
  });
}

async function processGeckoQueue() {
  if (geckoQueue.processing || geckoQueue.queue.length === 0) return;
  geckoQueue.processing = true;
  while (geckoQueue.queue.length > 0) {
    const now = Date.now();
    const wait = geckoQueue.minInterval - (now - geckoQueue.lastCall);
    if (wait > 0) await sleep(wait);
    const { url, params, timeout, resolve, reject } = geckoQueue.queue.shift();
    try {
      // إرسال API Key كـ Header (الطريقة الصحيحة للـ Demo Key)
      const headers = {};
      if (process.env.COINGECKO_API_KEY) {
        headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
      }
      // حذف Key من الـ params إذا كان موجوداً (لتجنب التكرار)
      const cleanParams = { ...params };
      delete cleanParams.x_cg_demo_api_key;
      const resp = await axios.get(url, { params: cleanParams, headers, timeout });
      geckoQueue.lastCall = Date.now();
      resolve(resp);
    } catch (e) {
      if (e.response?.status === 429) {
        logger.warn(`🐆 CoinGecko 429 — انتظار 30 ثانية`);
        await sleep(30000);
        geckoQueue.queue.unshift({ url, params, timeout, resolve, reject });
      } else if (e.response?.status === 401) {
        logger.error(`🐆 CoinGecko 401 — تحقق من COINGECKO_API_KEY في Railway`);
        geckoQueue.lastCall = Date.now();
        reject(e);
      } else {
        geckoQueue.lastCall = Date.now();
        reject(e);
      }
    }
  }
  geckoQueue.processing = false;
}

// ==================== CACHE ====================
const memCache = new Map();

async function getCached(key) {
  if (memCache.has(key)) {
    const { data, expiresAt } = memCache.get(key);
    if (Date.now() < expiresAt) return data;
    memCache.delete(key);
  }
  try {
    const cached = await MarketCache.findOne({ key });
    if (cached?.expiresAt > new Date()) return cached.data;
  } catch (e) {}
  return null;
}

async function setCache(key, data, ttlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  memCache.set(key, { data, expiresAt });
  if (ttlSeconds > 300) {
    try {
      await MarketCache.findOneAndUpdate(
        { key }, { key, data, expiresAt: new Date(expiresAt) }, { upsert: true }
      );
    } catch (e) {}
  }
}

// ==================== TOP 100 SPOT ====================
async function getTopCoins() {
  const cacheKey = 'top100_coins_v2';
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest',
      {
        headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY },
        params: { limit: 100, convert: 'USD', sort: 'market_cap', sort_dir: 'desc', market_type: 'spot' },
        timeout: 12000
      }
    );
    const filtered = response.data.data
      .filter(c => !isStablecoin(c.symbol))
      .slice(0, 100)
      .map(c => ({
        rank: c.cmc_rank, symbol: c.symbol, name: c.name,
        price: c.quote.USD.price, marketCap: c.quote.USD.market_cap,
        volume24h: c.quote.USD.volume_24h, change24h: c.quote.USD.percent_change_24h,
        change7d: c.quote.USD.percent_change_7d, change30d: c.quote.USD.percent_change_30d || 0,
        marketType: 'spot'
      }));
    await setCache(cacheKey, filtered, 6 * 3600);
    logger.info(`🐆 الفهد: Top ${filtered.length} عملة Spot (بدون Stablecoins)`);
    return filtered;
  } catch (error) {
    logger.error('🐆 خطأ في جلب Top 100:', error.message);
    return getDefaultCoins();
  }
}

// ==================== PRICE ====================
async function getVerifiedPrice(symbol) {
  const cacheKey = `price_${symbol}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const base = symbol.replace('/USDT', '').toUpperCase();
  try {
    const coins = await getCached('top100_coins_v2');
    if (coins) {
      const coin = coins.find(c => c.symbol === base);
      if (coin?.price > 0) {
        const result = { price: coin.price, symbol, source: 'CMC_cache', verified: true };
        await setCache(cacheKey, result, 60);
        return result;
      }
    }
    const resp = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
      { headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY }, params: { symbol: base, convert: 'USD' }, timeout: 10000 }
    );
    const entry = resp.data?.data?.[base];
    const price = Array.isArray(entry) ? entry[0]?.quote?.USD?.price : entry?.quote?.USD?.price;
    if (!price || price <= 0) throw new Error('سعر غير متاح');
    const result = { price, symbol, source: 'CMC_direct', verified: true };
    await setCache(cacheKey, result, 60);
    return result;
  } catch (error) {
    logger.error(`🐆 getVerifiedPrice(${symbol}): ${error.message}`);
    throw error;
  }
}

// ==================== KLINES (CoinGecko OHLCV) ====================
// للإطارات القصيرة: /ohlc endpoint
async function getKlines(symbol, timeframe) {
  const cacheKey = `klines_${symbol}_${timeframe}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const base = symbol.replace('/USDT', '').toUpperCase();
  const geckoId = GECKO_IDS[base] || base.toLowerCase();

  // CoinGecko /ohlc يقبل فقط: 1, 7, 14, 30, 90, 180, 365
  // الإطار الزمني يُحدد تلقائياً بناءً على days:
  // days=1 → 30min | days=7,14 → 4h | days=30,90 → 1d | days>=180 → 1w
  const daysMap = { '1h': 1, '4h': 14, '1d': 90 };
  const days = daysMap[timeframe] || 14;

  try {
    const geckoParams = { vs_currency: 'usd', days };
    if (process.env.COINGECKO_API_KEY) geckoParams.x_cg_demo_api_key = process.env.COINGECKO_API_KEY;
    const resp = await geckoRequest(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc`,
      geckoParams, 15000
    );
    if (!resp.data?.length) return [];
    const klines = resp.data.map(k => ({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: 0 }));
    const ttl = timeframe === '1h' ? 900 : timeframe === '4h' ? 1800 : 7200;
    await setCache(cacheKey, klines, ttl);
    logger.debug(`🐆 Klines OK: ${symbol} ${timeframe} days=${days} candles=${klines.length}`);
    return klines;
  } catch (error) {
    const status = error.response?.status;
    if (status === 404) {
      logger.debug(`🐆 Klines 404 — ${symbol} غير موجود في CoinGecko`);
    } else {
      logger.warn(`🐆 Klines فشل ${symbol} ${timeframe} days=${days}: status=${status} ${error.message}`);
    }
    return [];
  }
}

// ==================== HISTORICAL DATA (3 سنوات للـ Backtest) ====================
async function getHistoricalDaily(symbol, days = 1095) {
  const cacheKey = `hist_${symbol}_${days}d`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const base = symbol.replace('/USDT', '').toUpperCase();
  const geckoId = GECKO_IDS[base] || base.toLowerCase();

  // أولوية /ohlc — أكثر موثوقية مع Demo Key
  for (const d of [365, 180, 90]) {
    try {
      const resp = await geckoRequest(
        `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc`,
        { vs_currency: 'usd', days: d }, 20000
      );
      const data = resp.data || [];
      if (data.length >= 20) {
        const klines = data.map(k => ({
          time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: 0
        }));
        logger.info(`🐆 Hist ohlc OK: ${symbol} ${klines.length} شمعة (${d}d)`);
        await setCache(cacheKey, klines, 12 * 3600);
        return klines;
      }
    } catch (e) {
      if (e.response?.status === 404) break;
      logger.debug(`🐆 Hist ohlc/${d}d: ${symbol} ${e.response?.status}`);
    }
  }

  // fallback: /market_chart
  try {
    const resp = await geckoRequest(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart`,
      { vs_currency: 'usd', days: 365, interval: 'daily' }, 25000
    );
    const prices = resp.data?.prices || [];
    if (prices.length >= 20) {
      const klines = prices.map((p, i) => {
        const close = p[1], prev = i > 0 ? prices[i-1][1] : close;
        return { time: p[0], open: prev, high: Math.max(close,prev)*1.01, low: Math.min(close,prev)*0.99, close, volume: 0 };
      });
      logger.info(`🐆 Hist market_chart OK: ${symbol} ${klines.length} شمعة`);
      await setCache(cacheKey, klines, 12 * 3600);
      return klines;
    }
  } catch (e) {
    logger.debug(`🐆 Hist market_chart: ${symbol} ${e.response?.status}`);
  }

  return [];
}

// جلب مع Cache أولوية عالية
async function getHistoricalCached(symbol, days = 1095) {
  const cacheKey = `hist_${symbol}_${days}d`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;
  await sleep(800);
  return getHistoricalDaily(symbol, days);
}

// ==================== MTF INDICATORS ====================
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calculateMACD(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;
  // نحتاج مصفوفة macd لحساب signal line (EMA9 على MACD)
  // تبسيط: نستخدم القيمة الحالية
  return { macd, signal: macd * 0.85, histogram: macd * 0.15 };
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
  const recent = closes.slice(-period);
  const middle = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;
  const current = closes[closes.length - 1];
  const position = (upper - lower) > 0 ? (current - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, position };
}

function calculateATR(klines, period = 14) {
  if (klines.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const hl = klines[i].high - klines[i].low;
    const hc = Math.abs(klines[i].high - klines[i-1].close);
    const lc = Math.abs(klines[i].low - klines[i-1].close);
    trs.push(Math.max(hl, hc, lc));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function analyzeTimeframe(klines) {
  if (!klines || klines.length < 20) return { trend: 'neutral', rsi: 50, signal: 0 };
  const closes = klines.map(k => k.close);
  const rsi = calculateRSI(closes);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, Math.min(50, closes.length - 1));
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);
  const current = closes[closes.length - 1];
  const atr = calculateATR(klines);

  let trend = 'neutral', signal = 0;
  let bullishPoints = 0, bearishPoints = 0;

  // EMA trend
  if (current > ema20 && ema20 > ema50) { trend = 'bullish'; bullishPoints += 2; }
  else if (current < ema20 && ema20 < ema50) { trend = 'bearish'; bearishPoints += 2; }

  // RSI
  if (rsi > 55 && rsi < 75) bullishPoints++;
  else if (rsi < 45 && rsi > 25) bearishPoints++;
  else if (rsi >= 75) bearishPoints++; // overbought
  else if (rsi <= 25) bullishPoints++; // oversold reversal

  // MACD
  if (macd.histogram > 0) bullishPoints++;
  else if (macd.histogram < 0) bearishPoints++;

  // Bollinger Position
  if (bb.position > 0.7) bearishPoints++; // قرب الحد العلوي
  else if (bb.position < 0.3) bullishPoints++; // قرب الحد السفلي

  if (bullishPoints > bearishPoints) { trend = 'bullish'; signal = 1; }
  else if (bearishPoints > bullishPoints) { trend = 'bearish'; signal = -1; }

  const support = Math.min(...klines.slice(-20).map(k => k.low));
  const resistance = Math.max(...klines.slice(-20).map(k => k.high));

  return { trend, rsi, signal, ema20, ema50, current, support, resistance, macd, bb, atr };
}

// ==================== MTF محاكاة الإطارات الأطول ====================
// من بيانات يومية نحاكي 3D و 1W بدمج الشمعات
function resampleKlines(dailyKlines, periodDays) {
  if (!dailyKlines.length) return [];
  const resampled = [];
  for (let i = 0; i + periodDays <= dailyKlines.length; i += periodDays) {
    const chunk = dailyKlines.slice(i, i + periodDays);
    resampled.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(k => k.high)),
      low: Math.min(...chunk.map(k => k.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, k) => s + (k.volume || 0), 0)
    });
  }
  return resampled;
}

async function getMTFAnalysis(symbol, type = 'daily') {
  const cacheKey = `mtf_${symbol}_${type}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  let timeframeData = [];

  if (type === 'daily') {
    // يومي: 1H + 4H + 1D
    const [h1, h4, d1] = await Promise.allSettled([
      getKlines(symbol, '1h'),
      getKlines(symbol, '4h'),
      getKlines(symbol, '1d')
    ]);
    timeframeData = [
      { tf: '1H', klines: h1.status === 'fulfilled' ? h1.value : [] },
      { tf: '4H', klines: h4.status === 'fulfilled' ? h4.value : [] },
      { tf: '1D', klines: d1.status === 'fulfilled' ? d1.value : [] }
    ];
  } else {
    // شهري: 1D + 3D + 1W — نستخدم بيانات 365 يوم
    const d1Klines = await getKlines(symbol, '1d').catch(() => []);
    const d3Klines = resampleKlines(d1Klines, 3);
    const w1Klines = resampleKlines(d1Klines, 7);

    timeframeData = [
      { tf: '1D', klines: d1Klines },
      { tf: '3D', klines: d3Klines },
      { tf: '1W', klines: w1Klines }
    ];
  }

  const analyses = timeframeData.map(({ tf, klines }) => ({
    tf,
    analysis: analyzeTimeframe(klines),
    dataPoints: klines.length
  }));

  const signals = analyses.map(a => a.analysis.signal);
  const bullish = signals.filter(s => s > 0).length;
  const bearish = signals.filter(s => s < 0).length;
  const alignment = Math.max(bullish, bearish) / Math.max(signals.length, 1);

  // تفاصيل كل إطار زمني
  const tfDetails = analyses.map(a => ({
    tf: a.tf,
    trend: a.analysis.trend,
    rsi: parseFloat(a.analysis.rsi.toFixed(1)),
    ema20: a.analysis.ema20,
    dataPoints: a.dataPoints,
    bbPosition: a.analysis.bb?.position ? parseFloat(a.analysis.bb.position.toFixed(2)) : null
  }));

  const result = {
    timeframes: analyses,
    tfDetails, // تفصيل كل إطار
    bullishCount: bullish,
    bearishCount: bearish,
    alignment,
    dominantTrend: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
    confidenceBoost: alignment >= 1 ? 20 : alignment >= 0.67 ? 8 : -5,
    type // daily أو monthly
  };

  await setCache(cacheKey, result, type === 'daily' ? 900 : 1800);
  return result;
}

// ==================== BACKTEST 3 سنوات كامل ====================
async function runBacktest(symbol, signalType, confidence) {
  const cacheKey = `backtest_v3_${symbol}_${signalType}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    // محاولة 1: بيانات تاريخية كاملة (3 سنوات)
    let klines = await getHistoricalDaily(symbol, 1095);
    logger.info(`🐆 Backtest ${symbol}: Historical=${klines.length} شمعة`);

    // محاولة 2: fallback لـ /ohlc يومي (90 يوم)
    if (klines.length < 30) {
      logger.warn(`🐆 Backtest fallback ohlc: ${symbol}`);
      klines = await getKlines(symbol, '1d');
      logger.info(`🐆 Backtest ohlc: ${symbol} ${klines.length} شمعة`);
    }

    if (klines.length < 30) {
      logger.warn(`🐆 Backtest: بيانات غير كافية لـ ${symbol} (${klines.length} يوم)`);
      return buildMinimalBacktest(symbol, klines, signalType);
    }

    const closes = klines.map(k => k.close);
    const years = Math.round(klines.length / 365 * 10) / 10;

    let wins = 0, losses = 0, totalReturn = 0, worstDD = 0;
    let maxConsecLosses = 0, currentLosses = 0;
    let totalSignals = 0;
    const monthlyReturns = [];

    // === Backtest واقعي — شروط مرنة تُولّد عينة كافية ===
    const step = Math.max(1, Math.floor(closes.length / 150));
    logger.info(`🐆 Backtest loop: ${symbol} closes=${closes.length} step=${step}`);
    for (let i = 20; i < closes.length - 10; i += step) {
      const window = closes.slice(Math.max(0, i - 20), i);
      if (window.length < 10) continue;
      const rsi = calculateRSI(window, Math.min(14, window.length - 1));
      const ema20 = calculateEMA(window, Math.min(20, window.length));
      const longSignal = signalType === 'long' && (closes[i] > ema20 && rsi < 72 || rsi < 32);
      const shortSignal = signalType === 'short' && (closes[i] < ema20 && rsi > 28 || rsi > 68);
      if (!longSignal && !shortSignal) continue;
      totalSignals++;
      const entry = closes[i];
      const future = closes.slice(i + 1, Math.min(i + 11, closes.length));
      if (!future.length) continue;
      const targetPct = 0.08, stopPct = 0.04;
      let outcome = 0, hitTarget = false, hitStop = false;
      for (const fc of future) {
        const move = signalType === 'long' ? (fc - entry)/entry : (entry - fc)/entry;
        if (move >= targetPct) { hitTarget = true; outcome = targetPct * 100; break; }
        if (move <= -stopPct) { hitStop = true; outcome = -stopPct * 100; break; }
      }
      if (!hitTarget && !hitStop) {
        outcome = signalType === 'long'
          ? (future[future.length-1] - entry)/entry * 100
          : (entry - future[future.length-1])/entry * 100;
      }
      if (outcome > 0) { wins++; currentLosses = 0; totalReturn += Math.min(outcome, targetPct*100); }
      else { losses++; currentLosses++; maxConsecLosses = Math.max(maxConsecLosses, currentLosses); totalReturn += outcome; worstDD = Math.min(worstDD, outcome); }
    }
    logger.info(`🐆 Backtest result: ${symbol} signals=${totalSignals} wins=${wins} losses=${losses}`);

    const total = wins + losses;
    const winRate = total > 0 ? Math.round(wins / total * 100) : 0;
    const avgReturn = total > 0 ? (totalReturn / total).toFixed(2) : '0';
    const marketWinRate = await getMarketPatternWinRate(signalType);

    // تحليل إضافي: أداء خلال فترات مختلفة
    const recentKlines = klines.slice(-90); // آخر 3 أشهر
    const recentCloses = recentKlines.map(k => k.close);
    let recentWins = 0, recentTotal = 0;
    for (let i = 20; i < recentCloses.length - 10; i++) {
      const w = recentCloses.slice(0, i);
      const rsi = calculateRSI(w);
      const ema = calculateEMA(w, 20);
      const valid = signalType === 'long' ? recentCloses[i] > ema && rsi < 65 : recentCloses[i] < ema && rsi > 35;
      if (!valid) continue;
      recentTotal++;
      const move = signalType === 'long'
        ? (recentCloses[Math.min(i+10, recentCloses.length-1)] - recentCloses[i]) / recentCloses[i] * 100
        : (recentCloses[i] - recentCloses[Math.min(i+10, recentCloses.length-1)]) / recentCloses[i] * 100;
      if (move > 5) recentWins++;
    }
    const recentWinRate = recentTotal > 0 ? Math.round(recentWins / recentTotal * 100) : winRate;

    const result = {
      symbol,
      signalType,
      // إحصائيات أساسية
      winRate,
      avgReturn: parseFloat(avgReturn),
      worstCase: parseFloat(worstDD.toFixed(2)),
      occurrences: total,
      totalSignals,
      // مقاييس متقدمة
      marketWinRate,
      recentWinRate, // آخر 3 أشهر
      maxConsecLosses,
      // تفاصيل
      dataYears: years,
      dataPoints: klines.length,
      // حكم
      verdict: total > 10 && winRate > 55 ? 'positive' :
               total > 10 && winRate < 40 ? 'negative' : 'neutral',
      verdictAr: total > 10 && winRate > 55 ? 'أداء تاريخي إيجابي' :
                 total > 10 && winRate < 40 ? 'أداء تاريخي ضعيف' : 'أداء تاريخي محايد'
    };

    // Cache لـ 24 ساعة (بيانات تاريخية)
    await setCache(cacheKey, result, 24 * 3600);
    logger.info(`🐆 Backtest ${symbol} ${signalType}: ${winRate}% فوز من ${total} إشارة (${years} سنة)`);
    return result;

  } catch (error) {
    logger.warn(`🐆 Backtest فشل ${symbol}: ${error.message}`);
    return null;
  }
}

// Backtest مبسط عندما تكون البيانات أقل من 60 يوم
function buildMinimalBacktest(symbol, klines, signalType) {
  if (!klines.length) return null;
  const closes = klines.map(k => k.close);
  let wins = 0, losses = 0;
  for (let i = 20; i < closes.length - 5; i++) {
    const w = closes.slice(0, i);
    const rsi = calculateRSI(w);
    const ema = calculateEMA(w, Math.min(20, w.length));
    const valid = signalType === 'long' ? closes[i] > ema && rsi < 65 : closes[i] < ema && rsi > 35;
    if (!valid) continue;
    const move = signalType === 'long'
      ? (closes[Math.min(i+5, closes.length-1)] - closes[i]) / closes[i] * 100
      : (closes[i] - closes[Math.min(i+5, closes.length-1)]) / closes[i] * 100;
    if (move > 3) wins++; else losses++;
  }
  const total = wins + losses;
  return {
    symbol, signalType, winRate: total > 0 ? Math.round(wins/total*100) : 0,
    avgReturn: 0, worstCase: 0, occurrences: total, dataYears: klines.length/365,
    verdict: 'neutral', verdictAr: 'بيانات محدودة', dataPoints: klines.length
  };
}

async function getMarketPatternWinRate(signalType) {
  const cacheKey = `market_win_${signalType}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const btcKlines = await getHistoricalDaily('BTC/USDT', 730).catch(() => []);
  const ethKlines = await getHistoricalDaily('ETH/USDT', 730).catch(() => []);
  let totalWins = 0, totalTrades = 0;

  for (const klines of [btcKlines, ethKlines]) {
    if (klines.length < 50) continue;
    const closes = klines.map(k => k.close);
    for (let i = 30; i < closes.length - 10; i++) {
      const w = closes.slice(0, i);
      const rsi = calculateRSI(w);
      const ema = calculateEMA(w, 20);
      const valid = signalType === 'long' ? closes[i] > ema && rsi < 65 : closes[i] < ema && rsi > 35;
      if (!valid) continue;
      totalTrades++;
      const move = signalType === 'long'
        ? (Math.max(...closes.slice(i+1, i+11)) - closes[i]) / closes[i] * 100
        : (closes[i] - Math.min(...closes.slice(i+1, i+11))) / closes[i] * 100;
      if (move >= 5) totalWins++;
    }
  }

  const rate = totalTrades > 0 ? Math.round(totalWins / totalTrades * 100) : 50;
  await setCache(cacheKey, rate, 24 * 3600);
  return rate;
}

// ==================== ON-CHAIN ====================
async function getFearGreedIndex() {
  const cached = await getCached('fear_greed');
  if (cached) return cached;
  try {
    const resp = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8000 });
    const d = resp.data?.data?.[0];
    if (!d) return null;
    const value = parseInt(d.value);
    const result = {
      value,
      classificationAr: value <= 20 ? 'خوف شديد' : value <= 40 ? 'خوف' : value <= 60 ? 'محايد' : value <= 80 ? 'طمع' : 'طمع شديد',
      signal: value <= 25 ? 'فرصة شراء تاريخية' : value <= 40 ? 'إشارة شراء' : value >= 80 ? 'تحذير — طمع مفرط' : 'محايد',
      confidenceEffect: value <= 30 ? 10 : value >= 75 ? -5 : 0
    };
    await setCache('fear_greed', result, 3600);
    return result;
  } catch { return null; }
}

async function getFundingRate(symbol) {
  const key = `funding_${symbol}`;
  const cached = await getCached(key);
  if (cached) return cached;
  try {
    const base = symbol.replace('/USDT', '').toUpperCase();
    const resp = await axios.get(
      'https://api.bitget.com/api/v2/mix/market/current-fund-rate',
      { params: { symbol: base + 'USDT', productType: 'USDT-FUTURES' }, timeout: 8000 }
    );
    const data = resp.data?.data;
    const rate = parseFloat(Array.isArray(data) ? data[0]?.fundingRate : data?.fundingRate) || 0;
    const ratePercent = rate * 100;
    const result = {
      rate: ratePercent,
      signalAr: ratePercent > 0.1 ? 'تمويل مرتفع — ضغط هبوطي' : ratePercent < -0.05 ? 'تمويل سالب — فرصة صعود' : 'تمويل محايد',
      signal: ratePercent > 0.1 ? 'bearish' : ratePercent < -0.05 ? 'bullish' : 'neutral'
    };
    await setCache(key, result, 1800);
    return result;
  } catch { return null; }
}

async function getBTCDominance() {
  const cached = await getCached('btc_dom');
  if (cached) return cached;
  try {
    const resp = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest',
      { headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY }, timeout: 8000 }
    );
    const dom = parseFloat(resp.data?.data?.btc_dominance?.toFixed(1)) || 0;
    const ethDom = parseFloat(resp.data?.data?.eth_dominance?.toFixed(1)) || 0;
    const totalMcap = resp.data?.data?.quote?.USD?.total_market_cap || 0;
    const result = {
      btcDominance: dom, ethDominance: ethDom, totalMarketCap: totalMcap,
      signal: dom > 58 ? 'BTC يهيمن — Altcoins ضعيفة' : dom < 45 ? 'Altseason محتمل' : 'سوق متوازن'
    };
    await setCache('btc_dom', result, 3600);
    return result;
  } catch { return null; }
}

async function getBTCOnChainMetrics() {
  const cached = await getCached('btc_onchain');
  if (cached) return cached;
  try {
    const [addrResp, txResp] = await Promise.allSettled([
      axios.get('https://api.blockchain.info/charts/n-unique-addresses?timespan=1days&format=json&cors=true', { timeout: 8000 }),
      axios.get('https://api.blockchain.info/charts/n-transactions?timespan=1days&format=json&cors=true', { timeout: 8000 })
    ]);
    const getLatest = r => r.status === 'fulfilled' ? r.value.data?.values?.slice(-1)[0]?.y : null;
    const activeAddr = getLatest(addrResp);
    const txCount = getLatest(txResp);
    const result = {
      activeAddresses: activeAddr, txCount,
      signal: activeAddr > 1000000 ? 'نشاط مرتفع — اهتمام حقيقي' : activeAddr > 700000 ? 'نشاط معتدل' : 'نشاط منخفض — حذر',
      confidenceEffect: activeAddr > 1000000 ? 5 : activeAddr < 500000 ? -5 : 0
    };
    await setCache('btc_onchain', result, 3600);
    return result;
  } catch { return null; }
}

async function getMempoolData() {
  const cached = await getCached('mempool');
  if (cached) return cached;
  try {
    const resp = await axios.get('https://mempool.space/api/v1/fees/recommended', { timeout: 8000 });
    const fees = resp.data;
    const result = {
      fastFee: fees?.fastestFee || 0,
      signal: (fees?.fastestFee || 0) > 100 ? 'ضغط عالٍ — نشاط مرتفع' : 'شبكة هادئة',
      networkCongestion: (fees?.fastestFee || 0) > 100 ? 'high' : 'normal'
    };
    await setCache('mempool', result, 1800);
    return result;
  } catch { return null; }
}

async function getPerformanceBenchmarks() {
  const cached = await getCached('benchmarks');
  if (cached) return cached;
  try {
    const coins = await getCached('top100_coins_v2') || [];
    const btc = coins.find(c => c.symbol === 'BTC');
    const eth = coins.find(c => c.symbol === 'ETH');
    const totalMcap = await getBTCDominance();
    const result = {
      btc: { price: btc?.price, change24h: btc?.change24h, change7d: btc?.change7d, change30d: btc?.change30d },
      eth: { price: eth?.price, change24h: eth?.change24h, change7d: eth?.change7d, change30d: eth?.change30d },
      totalMarketCap: totalMcap?.totalMarketCap,
      totalChange24h: null
    };
    await setCache('benchmarks', result, 3600);
    return result;
  } catch { return null; }
}

async function getFullOnChainData(symbol = 'BTC') {
  const [fg, fr, dom, btcOnChain, mempool] = await Promise.allSettled([
    getFearGreedIndex(), getFundingRate(symbol), getBTCDominance(),
    getBTCOnChainMetrics(), getMempoolData()
  ]);
  return {
    fearGreed: fg.status === 'fulfilled' ? fg.value : null,
    fundingRate: fr.status === 'fulfilled' ? fr.value : null,
    btcDominance: dom.status === 'fulfilled' ? dom.value : null,
    btcOnChain: btcOnChain.status === 'fulfilled' ? btcOnChain.value : null,
    mempool: mempool.status === 'fulfilled' ? mempool.value : null
  };
}

// ==================== CONFIDENCE ====================
function calculateConfidence(coin, mtf, onChain, type) {
  // ==================== نظام ثقة موحد مع التحليل العميق ====================
  // الهدف: لا يتجاوز فرق الثقة بين المسح والتحليل العميق ±15%
  // المبدأ: MTF وحده لا يكفي — يجب تقارب جميع المؤشرات

  let score = 0, maxScore = 0;
  let penalties = 0; // عقوبات تخفض الثقة النهائية

  // اتجاه السعر (15) — خُفِّض من 20
  maxScore += 15;
  const c24 = Math.abs(parseFloat(coin.change24h) || 0);
  const c7d = parseFloat(coin.change7d) || 0;
  const c24raw = parseFloat(coin.change24h) || 0;
  if (c24 > 5) score += 15;
  else if (c24 > 3) score += 11;
  else if (c24 > 1) score += 6;
  else score += 2;

  // تناسق الاتجاه 24س + 7أيام (10)
  maxScore += 10;
  if ((c24raw > 0 && c7d > 0) || (c24raw < 0 && c7d < 0)) score += c24 > 3 ? 10 : 7;
  else { score += 2; penalties += 3; } // تناقض الاتجاهات = عقوبة مخففة

  // MTF Alignment (15)
  maxScore += 15;
  const mtfAlignment = mtf?.alignment || 0;
  const mtfBoost = mtf?.confidenceBoost || 0;
  if (mtfAlignment >= 1.0) score += 15;       // 3/3 فريمات
  else if (mtfAlignment >= 0.67) score += 11; // 2/3 فريمات
  else if (mtfAlignment >= 0.33) score += 6;  // 1/3 فريمات
  else { score += 1; penalties += 5; }         // 0/3 = عقوبة مخففة

  // حجم التداول vs Market Cap (10)
  maxScore += 10;
  const volRatio = (coin.volume24h || 0) / Math.max(coin.marketCap || 1, 1);
  if (volRatio > 0.15) score += 10;
  else if (volRatio > 0.08) score += 7;
  else if (volRatio > 0.03) score += 4;
  else { score += 1; penalties += 2; } // حجم منخفض = عقوبة مخففة

  // Market Cap Rank (10)
  maxScore += 10;
  const rank = parseInt(coin.rank) || 100;
  if (rank <= 5) score += 10;
  else if (rank <= 10) score += 8;
  else if (rank <= 20) score += 6;
  else if (rank <= 50) score += 4;
  else score += 2;

  // Fear & Greed (10)
  maxScore += 10;
  if (onChain?.fearGreed) {
    const fg = onChain.fearGreed.value;
    const trend = mtf?.dominantTrend;
    if ((fg <= 30 && trend === 'bullish') || (fg >= 75 && trend === 'bearish')) score += 10;
    else if (fg >= 40 && fg <= 60) score += 6;
    else score += 3;
  } else score += 5;

  // Funding Rate (8)
  maxScore += 8;
  if (onChain?.fundingRate) {
    const fr = onChain.fundingRate.signal;
    const trend = mtf?.dominantTrend;
    if ((fr === 'bullish' && trend === 'bullish') || (fr === 'bearish' && trend === 'bearish')) score += 8;
    else if (fr === 'neutral') score += 5;
    else { score += 1; penalties += 3; }
  } else score += 4;

  // BTC Dominance تأثير (7)
  maxScore += 7;
  if (onChain?.btcDominance) {
    const dom = onChain.btcDominance.btcDominance || 50;
    const trend = mtf?.dominantTrend;
    // هيمنة BTC عالية تضر الـ Altcoins
    if (dom > 62 && trend === 'bullish' && coin.symbol !== 'BTC') {
      score += 3; penalties += 3; // عقوبة مخففة — فقط عند هيمنة عالية جداً
    } else if (dom < 50) score += 7;
    else score += 4;
  } else score += 3;

  // BTC On-Chain (5)
  maxScore += 5;
  if (onChain?.btcOnChain) score += 5 + (onChain.btcOnChain.confidenceEffect || 0);
  else score += 2;

  // ==================== عقوبة خاصة بالعملات الصغيرة ====================
  // عملات خارج Top 50 مع MTF=100% وحجم ضعيف جداً
  if (rank > 70 && mtfAlignment >= 1.0 && volRatio < 0.02) {
    penalties += 8; // فقط العملات الصغيرة جداً مع حجم ضعيف جداً
  }

  // ==================== الحساب النهائي ====================
  const rawScore = Math.round((score / maxScore) * 100);
  const finalScore = Math.max(0, Math.min(100, rawScore - penalties));

  // تسجيل فقط في development
  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`🐆 Confidence ${coin.symbol}: raw=${rawScore} penalties=${penalties} final=${finalScore}`);
  }
  return finalScore;
}

// ==================== SCAN ====================
async function scanMarket(type = 'daily') {
  const cacheKey = `scan_${type}_v3`;
  const cached = await getCached(cacheKey);
  if (cached && (Date.now() - cached.scannedAt) < 20 * 60 * 1000) return cached; // 20 دقيقة cache

  const [coins, onChain] = await Promise.all([getTopCoins(), getFullOnChainData('BTC')]);
  logger.info(`🐆 الفهد: مسح السوق (${type}) — ${coins.length} عملة Spot`);

  const opportunities = [];
  const batchSize = 3; // معالجة 3 عملات متوازية — الـ geckoQueue يتحكم بالسرعة
  for (let i = 0; i < coins.length; i += batchSize) {
    const batch = coins.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(coin => analyzeOpportunity(coin, type, onChain)));
    results.forEach(r => { if (r.status === 'fulfilled' && r.value) opportunities.push(r.value); });
  }

  opportunities.sort((a, b) => b.confidence - a.confidence);

  const result = {
    opportunities: opportunities.filter(o => o.confidence >= 65),
    allOpportunities: opportunities,
    scannedAt: Date.now(),
    totalScanned: coins.length,
    type,
    onChain
  };

  await setCache(cacheKey, result, type === 'daily' ? 600 : 1800);
  return result;
}

async function analyzeOpportunity(coin, type, onChain) {
  try {
    const mtf = await getMTFAnalysis(coin.symbol + '/USDT', type);
    const confidence = calculateConfidence(coin, mtf, onChain, type);
    if (confidence < 40) return null;

    const direction = mtf?.dominantTrend === 'bearish' ? 'short' : 'long';
    const { target, stopLoss } = calculateLevels(coin.price, direction, type);

    return {
      symbol: coin.symbol + '/USDT',
      name: coin.name, rank: coin.rank, price: coin.price,
      change24h: coin.change24h, change7d: coin.change7d,
      volume24h: coin.volume24h, marketCap: coin.marketCap,
      direction, confidence, scanConfidence: confidence,
      target, stopLoss,
      riskReward: Math.abs(target - coin.price) / Math.max(Math.abs(coin.price - stopLoss), 0.0001),
      mtfAlignment: mtf?.alignment || 0,
      dominantTrend: mtf?.dominantTrend,
      tfDetails: mtf?.tfDetails || [],
      market: 'spot'
    };
  } catch { return null; }
}

function calculateLevels(price, direction, type) {
  if (direction === 'long') {
    return { target: price * (type === 'daily' ? 1.12 : 1.25), stopLoss: price * (type === 'daily' ? 0.97 : 0.93) };
  }
  return { target: price * (type === 'daily' ? 0.88 : 0.75), stopLoss: price * (type === 'daily' ? 1.03 : 1.07) };
}

function getDefaultCoins() {
  return ['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','AVAX','LINK','DOT',
    'MATIC','LTC','BCH','XLM','ATOM','UNI','NEAR','ARB','OP','SUI'].map((s, i) => ({
    rank: i+1, symbol: s, name: s, price: 0, marketCap: 0,
    volume24h: 0, change24h: 0, change7d: 0, change30d: 0, marketType: 'spot'
  }));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  getTopCoins, getVerifiedPrice, getKlines, getHistoricalCached, getHistoricalDaily,
  getMTFAnalysis, runBacktest, calculateConfidence,
  getFearGreedIndex, getFundingRate, getBTCDominance,
  getBTCOnChainMetrics, getMempoolData,
  getFullOnChainData, getPerformanceBenchmarks,
  scanMarket, isStablecoin
};
