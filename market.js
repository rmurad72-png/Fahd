/**
 * market.js — بيانات السوق 🐆 الفهد v2
 * المصادر: CMC (أسعار + Top100 Spot) + CoinGecko (OHLCV) +
 *          Alternative.me (Fear&Greed) + Bitget (Funding) +
 *          Blockchain.com + Mempool.space (On-Chain)
 */
const axios = require('axios');
const { MarketCache } = require('./database');
const logger = { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a), debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a) };

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
  'ONDO':'ondo-finance','NEAR':'near','ZEC':'zcash','WLFI':'world-liberty-financial'
};

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
        params: {
          limit: 150,
          convert: 'USD',
          sort: 'market_cap',
          sort_dir: 'desc',
          market_type: 'spot'
        },
        timeout: 12000
      }
    );

    const filtered = response.data.data
      .filter(c => !isStablecoin(c.symbol))
      .slice(0, 100)
      .map(c => ({
        rank: c.cmc_rank,
        symbol: c.symbol,
        name: c.name,
        price: c.quote.USD.price,
        marketCap: c.quote.USD.market_cap,
        volume24h: c.quote.USD.volume_24h,
        change24h: c.quote.USD.percent_change_24h,
        change7d: c.quote.USD.percent_change_7d,
        change30d: c.quote.USD.percent_change_30d || 0,
        marketType: 'spot'
      }));

    await setCache(cacheKey, filtered, 6 * 3600);
    logger.info(`🐆 الفهد v2: Top ${filtered.length} عملة Spot (بدون Stablecoins — هدف 100)`);
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
    const coins = await getCached('top_coins_v2');
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
      {
        headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY, Accept: 'application/json' },
        params: { symbol: base, convert: 'USD' },
        timeout: 10000
      }
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
async function getKlines(symbol, timeframe) {
  const cacheKey = `klines_${symbol}_${timeframe}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const base = symbol.replace('/USDT', '').toUpperCase();
  const geckoId = GECKO_IDS[base] || base.toLowerCase();
  // زيادة الأيام لـ Backtest أفضل
  const days = { '1h': 14, '4h': 60, '1d': 365, '3d': 365, '1w': 365 }[timeframe] || 60;

  try {
    const resp = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc`,
      { params: { vs_currency: 'usd', days }, timeout: 15000 }
    );
    if (!resp.data?.length) return [];
    const klines = resp.data.map(k => ({
      time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: 0
    }));
    const ttl = timeframe === '1h' ? 900 : timeframe === '4h' ? 1800 : 7200;
    await setCache(cacheKey, klines, ttl);
    logger.debug(`🐆 Klines: ${symbol} ${timeframe} (${klines.length} شمعة)`);
    return klines;
  } catch (error) {
    logger.debug(`🐆 Klines فشل ${symbol} ${timeframe}: ${error.message}`);
    return [];
  }
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
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function analyzeTimeframe(klines) {
  if (!klines || klines.length < 20) return { trend: 'neutral', rsi: 50, signal: 0 };
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const rsi = calculateRSI(closes);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, Math.min(50, closes.length - 1));
  const current = closes[closes.length - 1];
  let trend = 'neutral', signal = 0;
  if (current > ema20 && ema20 > ema50) { trend = 'bullish'; signal = 1; }
  else if (current < ema20 && ema20 < ema50) { trend = 'bearish'; signal = -1; }
  const support = Math.min(...lows.slice(-20));
  const resistance = Math.max(...highs.slice(-20));
  return { trend, rsi, signal, ema20, ema50, current, support, resistance };
}

async function getMTFAnalysis(symbol, type = 'daily') {
  const cacheKey = `mtf_${symbol}_${type}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const timeframes = type === 'daily'
    ? ['1h', '4h', '1d']
    : ['1d', '3d', '1w'];

  const results = await Promise.allSettled(
    timeframes.map(tf => getKlines(symbol, tf).then(k => ({ tf, analysis: analyzeTimeframe(k) })))
  );

  const analyses = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const signals = analyses.map(a => a.analysis.signal);
  const bullish = signals.filter(s => s > 0).length;
  const bearish = signals.filter(s => s < 0).length;
  const alignment = Math.max(bullish, bearish) / Math.max(signals.length, 1);

  const result = {
    timeframes: analyses,
    bullishCount: bullish,
    bearishCount: bearish,
    alignment,
    dominantTrend: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
    confidenceBoost: alignment >= 1 ? 20 : alignment >= 0.67 ? 8 : -5
  };

  await setCache(cacheKey, result, 900);
  return result;
}

// ==================== BACKTEST ====================
async function runBacktest(symbol, signalType, confidence) {
  const cacheKey = `backtest_${symbol}_${signalType}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const klines = await getKlines(symbol, '1d');
    if (klines.length < 30) return null; // تخفيف الحد الأدنى لقبول بيانات أقل

    const closes = klines.map(k => k.close);
    let wins = 0, losses = 0, totalReturn = 0, worstDD = 0;
    const patternResults = [];

    for (let i = 50; i < closes.length - 11; i++) {
      const window = closes.slice(Math.max(0, i - 20), i);
      const rsi = calculateRSI(window);
      const ema20 = calculateEMA(window, Math.min(20, window.length));
      const isBullish = closes[i] > ema20 && rsi < 65;
      const isBearish = closes[i] < ema20 && rsi > 35;

      if ((signalType === 'long' && isBullish) || (signalType === 'short' && isBearish)) {
        const entry = closes[i];
        const future = closes.slice(i + 1, i + 12);
        const maxMove = signalType === 'long'
          ? (Math.max(...future) - entry) / entry * 100
          : (entry - Math.min(...future)) / entry * 100;
        const finalMove = (closes[i + 11] - entry) / entry * 100 * (signalType === 'long' ? 1 : -1);

        if (maxMove >= 5) wins++; else losses++;
        totalReturn += Math.min(maxMove, 20);
        worstDD = Math.min(worstDD, finalMove);
        patternResults.push(maxMove);
      }
    }

    const total = wins + losses;
    const result = {
      symbol,
      winRate: total > 0 ? Math.round(wins / total * 100) : 0,
      avgReturn: total > 0 ? (totalReturn / total).toFixed(1) : 0,
      worstCase: worstDD.toFixed(1),
      occurrences: total,
      marketWinRate: await getMarketPatternWinRate(signalType),
      verdict: total > 5 && (wins / total) > 0.55 ? 'positive' : total > 5 && (wins / total) < 0.40 ? 'negative' : 'neutral'
    };

    await setCache(cacheKey, result, 12 * 3600);
    return result;
  } catch (error) {
    logger.debug(`🐆 Backtest فشل ${symbol}: ${error.message}`);
    return null;
  }
}

async function getMarketPatternWinRate(signalType) {
  const btcKlines = await getKlines('BTC/USDT', '1d');
  const ethKlines = await getKlines('ETH/USDT', '1d');
  let totalWins = 0, totalTrades = 0;

  for (const klines of [btcKlines, ethKlines]) {
    if (klines.length < 50) continue;
    const closes = klines.map(k => k.close);
    for (let i = 20; i < closes.length - 11; i++) {
      const rsi = calculateRSI(closes.slice(0, i));
      const ema = calculateEMA(closes.slice(0, i), 20);
      const valid = signalType === 'long' ? closes[i] > ema && rsi < 65 : closes[i] < ema && rsi > 35;
      if (valid) {
        totalTrades++;
        const future = closes.slice(i + 1, i + 12);
        const move = signalType === 'long'
          ? (Math.max(...future) - closes[i]) / closes[i] * 100
          : (closes[i] - Math.min(...future)) / closes[i] * 100;
        if (move >= 5) totalWins++;
      }
    }
  }
  return totalTrades > 0 ? Math.round(totalWins / totalTrades * 100) : 0;
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
      btcDominance: dom,
      ethDominance: ethDom,
      totalMarketCap: totalMcap,
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
      activeAddresses: activeAddr,
      txCount,
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
    const coins = await getCached('top_coins_v2') || [];
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
    getFearGreedIndex(),
    getFundingRate(symbol),
    getBTCDominance(),
    getBTCOnChainMetrics(),
    getMempoolData()
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
  let score = 0, maxScore = 0;

  // اتجاه السعر (20)
  maxScore += 20;
  const c24 = Math.abs(parseFloat(coin.change24h) || 0);
  const c7d = parseFloat(coin.change7d) || 0;
  const c24raw = parseFloat(coin.change24h) || 0;
  if (c24 > 5) score += 20;
  else if (c24 > 3) score += 15;
  else if (c24 > 1) score += 8;
  else score += 3;

  // تناسق الاتجاه (15)
  maxScore += 15;
  if ((c24raw > 0 && c7d > 0) || (c24raw < 0 && c7d < 0)) {
    score += c24 > 3 ? 15 : 10;
  } else score += 3;

  // MTF Alignment (20)
  maxScore += 20;
  score += Math.max(0, (mtf?.confidenceBoost || 0) + 10);

  // حجم التداول (10)
  maxScore += 10;
  const volRatio = (coin.volume24h || 0) / Math.max(coin.marketCap || 1, 1);
  if (volRatio > 0.15) score += 10;
  else if (volRatio > 0.08) score += 7;
  else if (volRatio > 0.03) score += 4;
  else score += 1;

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
    else score += 1;
  } else score += 4;

  // BTC On-Chain (7)
  maxScore += 7;
  if (onChain?.btcOnChain) score += 7 + (onChain.btcOnChain.confidenceEffect || 0);
  else score += 3;

  return Math.min(100, Math.round((score / maxScore) * 100));
}

// ==================== SCAN ====================
async function scanMarket(type = 'daily') {
  const cacheKey = `scan_${type}_v2`;
  const cached = await getCached(cacheKey);
  if (cached && (Date.now() - cached.scannedAt) < 10 * 60 * 1000) return cached;

  const [coins, onChain] = await Promise.all([
    getTopCoins(),
    getFullOnChainData('BTC')
  ]);

  logger.info(`🐆 الفهد v2: مسح السوق (${type}) — ${coins.length} عملة Spot`);

  const opportunities = [];
  const batchSize = 8;

  for (let i = 0; i < coins.length; i += batchSize) {
    const batch = coins.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(coin => analyzeOpportunity(coin, type, onChain))
    );
    results.forEach(r => { if (r.status === 'fulfilled' && r.value) opportunities.push(r.value); });
    if (i + batchSize < coins.length) await sleep(400);
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
      name: coin.name,
      rank: coin.rank,
      price: coin.price,
      change24h: coin.change24h,
      change7d: coin.change7d,
      volume24h: coin.volume24h,
      marketCap: coin.marketCap,
      direction,
      confidence,
      scanConfidence: confidence, // للتوافق مع التحليل العميق
      target,
      stopLoss,
      riskReward: Math.abs(target - coin.price) / Math.max(Math.abs(coin.price - stopLoss), 0.0001),
      change24h: coin.change24h,
      change7d: coin.change7d,
      volume24h: coin.volume24h,
      mtfAlignment: mtf?.alignment || 0,
      dominantTrend: mtf?.dominantTrend,
      market: 'spot'
    };
  } catch { return null; }
}

function calculateLevels(price, direction, type) {
  if (direction === 'long') {
    return {
      target: price * (type === 'daily' ? 1.12 : 1.25),
      stopLoss: price * (type === 'daily' ? 0.97 : 0.93)
    };
  }
  return {
    target: price * (type === 'daily' ? 0.88 : 0.75),
    stopLoss: price * (type === 'daily' ? 1.03 : 1.07)
  };
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
  getTopCoins, getVerifiedPrice, getKlines,
  getMTFAnalysis, runBacktest, calculateConfidence,
  getFearGreedIndex, getFundingRate, getBTCDominance,
  getBTCOnChainMetrics, getMempoolData,
  getFullOnChainData, getPerformanceBenchmarks,
  scanMarket, isStablecoin
};
