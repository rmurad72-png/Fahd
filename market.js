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
const { MarketCache, PriceHistory } = require('./database');
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
  'USDJ','USDX','VAI','MUSD','ZUSD','BIDR','XIDR','USDFL','RSR',
  // ذهب رقمي — ليس للتداول النشط
  'PAXG','XAUT','XAUTUSDT','PAXGUSDT',
  // عملات مستقرة جديدة
  'RLUSD','USD1','STABLE','EURC'
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
  'GT':'gate-2','SIREN':'siren-protocol','SKY':'skale',
  'PAXG':'pax-gold','XAUT':'tether-gold','RLUSD':'ripple-usd',
  'STABLE':'stable-protocol','EURC':'euro-coin',
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
        params: { limit: 100, convert: 'USD', sort: 'market_cap', sort_dir: 'desc', market_type: 'spot', aux: 'cmc_rank,circulating_supply,total_supply,market_cap_by_total_supply,volume_24h_reported,volume_7d,volume_30d,percent_change_1h' },
        timeout: 12000
      }
    );
    const filtered = response.data.data
      .filter(function(c) {
        if (isStablecoin(c.symbol)) return false;
        if (!c.volume24h || c.volume24h < 100000) return false;
        if (!c.price || c.price <= 0) return false;
        return true;
      })
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

  // محاولة CoinGecko فقط إذا كان لديه حصة متبقية
  // وإلا نرجع مصفوفة فارغة — MTF سيُبنى من بيانات CMC
  const base = symbol.replace('/USDT', '').toUpperCase();
  const geckoId = GECKO_IDS[base] || base.toLowerCase();
  const daysMap = { '1h': 1, '4h': 14, '1d': 90 };
  const days = daysMap[timeframe] || 14;

  // CoinGecko معطّل مؤقتاً — نرجع مصفوفة فارغة
  // سيستخدم getMTFAnalysis بيانات CMC بدلاً منها
  logger.debug('🐆 Klines: CoinGecko معطّل — استخدم CMC');
  return [];
}

// ==================== HISTORICAL DATA (3 سنوات للـ Backtest) ====================
async function getHistoricalDaily(symbol, days) {
  days = days || 365;
  const cacheKey = 'hist_' + symbol + '_' + days + 'd';
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // OKX + Binance أولاً
  const klines = await getExchangeKlines(symbol, '1d', Math.min(days, 300));
  if (klines.length >= 10) {
    await setCache(cacheKey, klines, 43200);
    logger.info('🐆 Historical OKX/Binance: ' + symbol + ' ' + klines.length + ' يوم');
    return klines;
  }

  // PriceHistory من MongoDB
  const dbData = await getPriceHistoryFromDB(symbol, days);
  if (dbData.length >= 10) {
    await setCache(cacheKey, dbData, 21600);
    return dbData;
  }

  logger.warn('🐆 Historical: لا بيانات لـ ' + symbol);
  return [];
}

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

// ==================== Z-SCORE ====================
// يقيس انحراف السعر الحالي عن المتوسط بالانحراف المعياري
// Z > 2: مبالغ في الارتفاع | Z < -2: مبالغ في الانخفاض (فرصة)
function calculateZScore(closes, period = 20) {
  if (closes.length < period) return 0;
  const window = closes.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  const current = closes[closes.length - 1];
  return parseFloat(((current - mean) / std).toFixed(2));
}

// تفسير Z-Score للمتداول
function interpretZScore(z) {
  if (z >= 2.5) return { signal: 'تشبع شرائي شديد', action: 'تجنب الدخول', emoji: '🔴', score: -15 };
  if (z >= 1.5) return { signal: 'تشبع شرائي', action: 'انتظر تصحيح', emoji: '🟠', score: -8 };
  if (z >= 0.5) return { signal: 'ارتفاع معتدل', action: 'دخول بحذر', emoji: '🟡', score: 0 };
  if (z >= -0.5) return { signal: 'سعر عادل', action: 'منطقة دخول جيدة', emoji: '🟢', score: 8 };
  if (z >= -1.5) return { signal: 'انخفاض معتدل', action: 'فرصة شراء', emoji: '🟢', score: 12 };
  if (z >= -2.5) return { signal: 'تشبع بيعي', action: 'فرصة شراء قوية', emoji: '💎', score: 15 };
  return { signal: 'تشبع بيعي شديد', action: 'فرصة نادرة', emoji: '💎', score: 20 };
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

  // Z-Score
  const zScore = calculateZScore(closes, Math.min(20, closes.length));
  const zInterpret = interpretZScore(zScore);

  return { trend, rsi, signal, ema20, ema50, current, support, resistance, macd, bb, atr, zScore, zInterpret };
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

// ==================== OKX + BINANCE للبيانات التاريخية ====================
// OKX أولاً (أفضل تغطية) → Binance fallback → CMC fallback
// بدون API Key — مجاني كلياً

// تحويل إطار زمني Binance → OKX
const OKX_INTERVALS = { '1h': '1H', '4h': '4H', '1d': '1D', '3d': '3D', '1w': '1W' };
const BINANCE_INTERVALS = { '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' };

async function getOKXKlines(symbol, interval, limit) {
  interval = interval || '1D';
  limit = limit || 300;
  const base = symbol.replace('/USDT', '').toUpperCase();
  const instId = base + '-USDT';
  const cacheKey = 'okx_' + instId + '_' + interval + '_' + limit;
  const cached = await getCached(cacheKey);
  if (cached) return cached;
  try {
    const bar = OKX_INTERVALS[interval.toLowerCase()] || interval.toUpperCase();
    const resp = await axios.get('https://www.okx.com/api/v5/market/candles', {
      params: { instId: instId, bar: bar, limit: Math.min(limit, 300) },
      timeout: 15000
    });
    const data = resp.data && resp.data.data;
    if (!data || !data.length) return [];
    // OKX يُرجع بترتيب عكسي (الأحدث أولاً) — نعكسه
    const klines = data.reverse().map(function(k) {
      return {
        time: parseInt(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      };
    });
    const ttl = interval === '1D' ? 43200 : interval === '4H' ? 7200 : 3600;
    await setCache(cacheKey, klines, ttl);
    logger.info('🐆 OKX OK: ' + instId + ' ' + klines.length + ' شمعة (' + bar + ')');
    return klines;
  } catch (e) {
    logger.debug('🐆 OKX فشل ' + instId + ': ' + (e.response && e.response.status));
    return [];
  }
}

async function getBinanceKlines(symbol, interval, limit) {
  interval = interval || '1d';
  limit = limit || 365;
  const base = symbol.replace('/USDT', '').toUpperCase();
  const pair = base + 'USDT';
  const cacheKey = 'binance_' + pair + '_' + interval + '_' + limit;
  const cached = await getCached(cacheKey);
  if (cached) return cached;
  try {
    const resp = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: pair, interval: interval, limit: limit },
      timeout: 15000
    });
    if (!resp.data || !resp.data.length) return [];
    const klines = resp.data.map(function(k) {
      return {
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      };
    });
    const ttl = interval === '1d' ? 43200 : interval === '4h' ? 7200 : 3600;
    await setCache(cacheKey, klines, ttl);
    logger.info('🐆 Binance OK: ' + pair + ' ' + klines.length + ' شمعة (' + interval + ')');
    return klines;
  } catch (e) {
    logger.debug('🐆 Binance فشل ' + pair + ': ' + (e.response && e.response.status));
    return [];
  }
}

// الدالة الموحدة — OKX أولاً ثم Binance
async function getExchangeKlines(symbol, interval, limit) {
  interval = interval || '1d';
  limit = limit || 300;
  // OKX أولاً
  const okxInterval = OKX_INTERVALS[interval.toLowerCase()] || '1D';
  const okxData = await getOKXKlines(symbol, okxInterval, limit);
  if (okxData.length >= 10) return okxData;
  // Binance fallback
  const binInterval = BINANCE_INTERVALS[interval.toLowerCase()] || '1d';
  const binData = await getBinanceKlines(symbol, binInterval, limit);
  if (binData.length >= 10) return binData;
  // لا بيانات
  return [];
}

// ==================== MTF من Binance (بيانات حقيقية) ====================
// fallback لـ CMC إذا فشل Binance
function buildMTFFromCMC(coin) {
  const c1h = parseFloat(coin.change1h || 0);
  const c24h = parseFloat(coin.change24h || 0);
  const c7d = parseFloat(coin.change7d || 0);
  const c30d = parseFloat(coin.change30d || 0);

  // تحقق من وجود بيانات حقيقية — إذا كانت كلها صفر فالبيانات مصطنعة
  const hasRealData = Math.abs(c1h) > 0.01 || Math.abs(c24h) > 0.01 || Math.abs(c7d) > 0.01;

  const s1h = c1h > 0.3 ? 1 : c1h < -0.3 ? -1 : 0;
  const s4h = c24h > 1.5 ? 1 : c24h < -1.5 ? -1 : 0;
  const s1d = c7d > 4 ? 1 : c7d < -4 ? -1 : 0;
  const s1w = c30d > 8 ? 1 : c30d < -8 ? -1 : 0;
  const signals = [s1h, s4h, s1d, s1w];
  const bullish = signals.filter(s => s > 0).length;
  const bearish = signals.filter(s => s < 0).length;
  const alignment = Math.max(bullish, bearish) / signals.length;

  // RSI تقريبي من بيانات التغير (أفضل من 50 ثابت)
  const rsi1h = Math.min(85, Math.max(15, 50 + c1h * 4));
  const rsi4h = Math.min(85, Math.max(15, 50 + c24h * 2));
  const rsi1d = Math.min(85, Math.max(15, 50 + c7d * 1.2));
  const rsi1w = Math.min(85, Math.max(15, 50 + c30d * 0.6));

  const tfDetails = [
    { tf: '1H', trend: s1h > 0 ? 'bullish' : s1h < 0 ? 'bearish' : 'neutral', rsi: rsi1h, bbPosition: null },
    { tf: '4H', trend: s4h > 0 ? 'bullish' : s4h < 0 ? 'bearish' : 'neutral', rsi: rsi4h, bbPosition: null },
    { tf: '1D', trend: s1d > 0 ? 'bullish' : s1d < 0 ? 'bearish' : 'neutral', rsi: rsi1d, bbPosition: null },
    { tf: '1W', trend: s1w > 0 ? 'bullish' : s1w < 0 ? 'bearish' : 'neutral', rsi: rsi1w, bbPosition: null }
  ];
  return {
    timeframes: tfDetails.map(function(t) {
      return { tf: t.tf, analysis: { trend: t.trend, rsi: t.rsi,
        signal: t.trend === 'bullish' ? 1 : t.trend === 'bearish' ? -1 : 0,
        zScore: 0, zInterpret: { signal: 'N/A', emoji: '' } } };
    }),
    tfDetails, bullishCount: bullish, bearishCount: bearish, alignment,
    dominantTrend: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
    confidenceBoost: alignment >= 1 ? 20 : alignment >= 0.67 ? 8 : -5,
    source: hasRealData ? 'CMC' : 'CMC_NO_DATA',
    hasRealData: hasRealData
  };
}

async function getMTFAnalysis(symbol, type, coinData) {
  type = type || 'daily';
  const cacheKey = 'mtf_' + symbol + '_' + type;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // محاولة 1: OKX + Binance (بيانات حقيقية)
  let timeframeData = [];
  let hasRealData = false;

  try {
    if (type === 'daily') {
      const [h1, h4, d1] = await Promise.all([
        getExchangeKlines(symbol, '1h', 48),
        getExchangeKlines(symbol, '4h', 84),
        getExchangeKlines(symbol, '1d', 90)
      ]);
      if (h1.length >= 10 || h4.length >= 10 || d1.length >= 10) {
        timeframeData = [
          { tf: '1H', klines: h1 },
          { tf: '4H', klines: h4 },
          { tf: '1D', klines: d1 }
        ];
        hasRealData = true;
        logger.info('🐆 MTF OKX/Binance: ' + symbol);
      }
    } else {
      const d1 = await getExchangeKlines(symbol, '1d', 200);
      if (d1.length >= 10) {
        timeframeData = [
          { tf: '1D', klines: d1 },
          { tf: '3D', klines: resampleKlines(d1, 3) },
          { tf: '1W', klines: resampleKlines(d1, 7) }
        ];
        hasRealData = true;
      }
    }
  } catch (e) {
    logger.debug('🐆 MTF Exchange فشل ' + symbol + ': ' + e.message);
  }

  // محاولة 2: CMC fallback
  if (!hasRealData) {
    const base = symbol.replace('/USDT', '').toUpperCase();
    const coins = await getCached('top100_coins_v2') || [];
    const coin = coinData || coins.find(function(c) { return c.symbol === base; });
    if (coin) {
      const result = buildMTFFromCMC(coin);
      await setCache(cacheKey, result, 1800);
      logger.info('🐆 MTF CMC fallback: ' + symbol + (result.hasRealData ? '' : ' (بيانات محدودة)'));
      return result;
    }
    return buildMTFFromCMC({ change1h: 0, change24h: 0, change7d: 0, change30d: 0 });
  }

  // معالجة البيانات الحقيقية
  const analyses = timeframeData.map(function(td) {
    return { tf: td.tf, analysis: analyzeTimeframe(td.klines), dataPoints: td.klines.length };
  });
  const signals = analyses.map(function(a) { return a.analysis.signal; });
  const bullish = signals.filter(function(s) { return s > 0; }).length;
  const bearish = signals.filter(function(s) { return s < 0; }).length;
  const alignment = Math.max(bullish, bearish) / Math.max(signals.length, 1);
  const tfDetails = analyses.map(function(a) {
    return {
      tf: a.tf, trend: a.analysis.trend,
      rsi: parseFloat(a.analysis.rsi.toFixed(1)),
      ema20: a.analysis.ema20, dataPoints: a.dataPoints,
      bbPosition: a.analysis.bb && a.analysis.bb.position ? parseFloat(a.analysis.bb.position.toFixed(2)) : null,
      zScore: a.analysis.zScore || 0,
      zInterpret: a.analysis.zInterpret || { signal: 'N/A', emoji: '' }
    };
  });
  const result = {
    timeframes: analyses, tfDetails, bullishCount: bullish, bearishCount: bearish, alignment,
    dominantTrend: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
    confidenceBoost: alignment >= 1 ? 20 : alignment >= 0.67 ? 8 : -5,
    type, source: 'OKX/Binance'
  };
  await setCache(cacheKey, result, type === 'daily' ? 900 : 1800);
  return result;
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

    // Z-Score من الإطار اليومي
    const d1Analysis = mtf?.timeframes?.find(t => t.tf === '1D')?.analysis;
    const zScore = d1Analysis?.zScore || 0;
    const zInterpret = d1Analysis?.zInterpret || interpretZScore(0);

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
      zScore, zInterpret,
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
  getTopCoins, getVerifiedPrice, getKlines, getOKXKlines, getBinanceKlines, getExchangeKlines, getHistoricalCached, getHistoricalDaily,
  calculateZScore, interpretZScore,
  saveDailyPrices, getPriceHistoryStats, getPriceHistoryFromDB,
  getMTFAnalysis, runBacktest, calculateConfidence,
  getFearGreedIndex, getFundingRate, getBTCDominance,
  getBTCOnChainMetrics, getMempoolData,
  getFullOnChainData, getPerformanceBenchmarks,
  scanMarket, isStablecoin
};
