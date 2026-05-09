/**
 * agent.js — محرك الذكاء 🐆 الفهد v2
 * Claude Haiku: تحليل نصي + On-Chain + MTF + Backtest
 * Claude Sonnet: تحليل الشارت البصري
 */
const axios = require('axios');
const { logger } = require('./logger');

const API = 'https://api.anthropic.com/v1/messages';
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

async function callClaude(model, system, userMsg, imageB64 = null) {
  const content = [];
  if (imageB64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } });
  content.push({ type: 'text', text: userMsg });
  try {
    const resp = await axios.post(API,
      { model, max_tokens: 1500, system, messages: [{ role: 'user', content }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 30000 }
    );
    return resp.data.content[0]?.text || '';
  } catch (error) {
    logger.error(`🐆 Claude API (${model}): ${error.message}`);
    throw new Error(`فشل تحليل Claude: ${error.message}`);
  }
}

function parseJSON(text) {
  try {
    let clean = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s !== -1 && e > s) clean = clean.substring(s, e + 1);
    return JSON.parse(clean);
  } catch {
    return { recommendation: 'wait', confidence: 0, entry: null, target: null, stopLoss: null, riskReward: null, summary: text.substring(0, 400), analysis: { trend: 'غير محدد', momentum: 'N/A', onChainSignal: 'N/A', mtfSignal: 'N/A', backtestInsight: 'N/A', sentiment: 'N/A', risks: 'N/A', catalysts: 'N/A' } };
  }
}

const SYSTEM_HEDGE_FUND = `أنت "الفهد" — وكيل ذكاء اصطناعي متخصص في تداول السوق الفوري (Spot) للعملات الرقمية بمستوى صناديق التحوط العالمية.

قواعد التحليل:
1. تحليل السوق الفوري (Spot) فقط — لا Futures ولا مشتقات
2. دمج: فني (MTF) + On-Chain + نفسي السوق + Backtest في قرار واحد
3. نسبة الثقة دقيقة 0-100% بناءً على تقارب جميع المؤشرات
4. الحد الأدنى للتوصية: 65%
5. صادق ومباشر — "تجنب" أو "انتظر" قرار محترم إذا لم تكن الشروط مكتملة
6. الرد بـ JSON صارم فقط`;

const SYSTEM_CHART = `أنت "الفهد" — محلل شارت بصري خبير للسوق الفوري (Spot) فقط. الرد بـ JSON صارم فقط.`;

// ==================== DEEP ANALYSIS ====================
async function deepAnalysis(symbol, marketData, type = 'daily') {
  const p = parseFloat(marketData.price) || 0;
  const onChain = marketData.onChain || {};
  const mtf = marketData.mtf || {};
  const backtest = marketData.backtest || {};
  const fg = onChain.fearGreed;
  const fr = onChain.fundingRate;
  const dom = onChain.btcDominance;
  const btcChain = onChain.btcOnChain;
  const mempool = onChain.mempool;

  const prompt = `حلل هذه العملة بعمق كامل كمدير صندوق تحوط عالمي — السوق الفوري (Spot) فقط:

العملة: ${symbol}
السوق: Spot فقط
السعر: ${p > 0 ? '$' + p.toFixed(p < 1 ? 6 : 2) : 'غير متوفر'}
التغير 24س: ${parseFloat(marketData.change24h || 0).toFixed(2)}%
التغير 7أيام: ${parseFloat(marketData.change7d || 0).toFixed(2)}%
التغير 30يوم: ${parseFloat(marketData.change30d || 0).toFixed(2)}%
الحجم 24س: ${marketData.volume24h ? '$' + (marketData.volume24h / 1e6).toFixed(1) + 'M' : 'N/A'}
الترتيب: #${marketData.rank || 'N/A'}
الإطار: ${type === 'daily' ? 'يومي (1H+4H+1D)' : 'شهري (1D+3D+1W)'}

تحليل متعدد الفريمات (MTF):
- الاتجاه السائد: ${mtf.dominantTrend || 'غير محدد'}
- صاعد: ${mtf.bullishCount || 0}/${(mtf.timeframes || []).length} فريمات
- هابط: ${mtf.bearishCount || 0}/${(mtf.timeframes || []).length} فريمات
- تناسق الفريمات: ${mtf.alignment ? (mtf.alignment * 100).toFixed(0) + '%' : 'N/A'}

On-Chain:
- الخوف والطمع: ${fg ? fg.value + '/100 — ' + fg.classificationAr + ' (' + fg.signal + ')' : 'غير متوفر'}
- Funding Rate: ${fr ? fr.rate.toFixed(4) + '% — ' + fr.signalAr : 'غير متوفر'}
- هيمنة BTC: ${dom ? dom.btcDominance + '% — ' + dom.signal : 'غير متوفر'}
- عناوين BTC النشطة: ${btcChain?.activeAddresses ? btcChain.activeAddresses.toLocaleString() + ' — ' + btcChain.signal : 'غير متوفر'}
- ضغط Mempool: ${mempool ? mempool.signal : 'غير متوفر'}

Backtest (3 سنوات):
- نجاح النمط على ${symbol}: ${backtest.winRate !== undefined ? backtest.winRate + '%' : 'غير متوفر'} (${backtest.occurrences || 0} مرة)
- متوسط العائد: ${backtest.avgReturn !== undefined ? backtest.avgReturn + '%' : 'N/A'}
- أسوأ سيناريو: ${backtest.worstCase !== undefined ? backtest.worstCase + '%' : 'N/A'}
- نجاح النمط في السوق العام: ${backtest.marketWinRate !== undefined ? backtest.marketWinRate + '%' : 'N/A'}

أجب بـ JSON:
{
  "symbol": "${symbol}",
  "market": "spot",
  "recommendation": "long|short|wait|avoid",
  "confidence": <0-100>,
  "entry": <سعر الدخول>,
  "target": <الهدف الأولي 5-20%>,
  "stopLoss": <وقف الخسارة 3%>,
  "trailingStop": "50% من المكسب",
  "riskReward": <R/R>,
  "timeframe": "${type}",
  "analysis": {
    "trend": "<تحليل الاتجاه>",
    "momentum": "<تحليل الزخم>",
    "mtfSignal": "<تفسير MTF>",
    "onChainSignal": "<تفسير On-Chain>",
    "backtestInsight": "<تفسير Backtest>",
    "sentiment": "<مزاج السوق>",
    "catalysts": "<محفزات>",
    "risks": "<مخاطر>"
  },
  "summary": "<ملخص 2-3 جمل>"
}`;

  const resp = await callClaude(HAIKU, SYSTEM_HEDGE_FUND, prompt);
  return parseJSON(resp);
}

// ==================== CHART ANALYSIS ====================
async function analyzeChart(imageB64, context = '') {
  const prompt = `حلل هذا الشارت للسوق الفوري (Spot) فقط.
${context ? 'معلومات: ' + context : ''}

JSON فقط:
{
  "symbol": "<العملة أو null>",
  "market": "spot",
  "timeframe": "<الإطار أو null>",
  "recommendation": "enter|avoid|wait",
  "confidence": <0-100>,
  "direction": "long|short|neutral",
  "currentPrice": <السعر أو null>,
  "suggestedEntry": <دخول أو null>,
  "suggestedTarget": <هدف أو null>,
  "suggestedStop": <وقف أو null>,
  "riskReward": <R/R أو null>,
  "patterns": ["<نمط>"],
  "keyLevels": { "support": [], "resistance": [] },
  "technicalSummary": "<تحليل مختصر>",
  "decision": "<ادخل الآن|لا تدخل|انتظر تأكيداً>",
  "reasoning": "<سبب القرار>"
}`;
  const resp = await callClaude(SONNET, SYSTEM_CHART, prompt, imageB64);
  return parseJSON(resp);
}

// ==================== LESSON FROM TRADE ====================
async function analyzeLesson(trade, outcome, cancelReason = null) {
  const system = `أنت "الفهد" — تستخلص دروساً قابلة للتطبيق من كل صفقة وأمر ملغى لتحسين استراتيجيتك.`;
  const prompt = `${cancelReason ? 'أمر ملغى/منتهي:' : 'صفقة مكتملة:'}
العملة: ${trade.symbol} (Spot)
الاتجاه: ${trade.direction}
الدخول: $${trade.entryPrice}
${trade.exitPrice ? 'الخروج: $' + trade.exitPrice : ''}
النتيجة: ${outcome}${trade.pnlPercent ? ' (' + trade.pnlPercent.toFixed(2) + '%)' : ''}
ثقة الفهد: ${trade.confidence}%
${cancelReason ? 'سبب الإلغاء: ' + cancelReason : 'سبب الإغلاق: ' + (trade.closeReason || 'N/A')}

JSON:
{
  "lesson": "<الدرس الأساسي>",
  "whatWorked": "<ما نجح>",
  "whatFailed": "<ما أخفق>",
  "strategyAdjustment": "<تعديل مقترح على معايير التحليل>",
  "entryTimingFeedback": "<تقييم توقيت الدخول>",
  "nextTimeApproach": "<المقاربة المستقبلية>"
}`;
  const resp = await callClaude(HAIKU, system, prompt);
  return parseJSON(resp);
}

// ==================== MORNING BRIEFING ====================
async function generateMorningBriefing(scanResult, benchmarks) {
  const system = `أنت "الفهد" — تقدم ملخصاً صباحياً موجزاً واحترافياً للسوق الفوري.`;
  const fg = scanResult.onChain?.fearGreed;
  const dom = scanResult.onChain?.btcDominance;
  const prompt = `ملخص صباحي للمتداول:

BTC: $${benchmarks?.btc?.price?.toFixed(0) || 'N/A'} (${benchmarks?.btc?.change24h?.toFixed(2) || 'N/A'}%)
ETH: $${benchmarks?.eth?.price?.toFixed(0) || 'N/A'} (${benchmarks?.eth?.change24h?.toFixed(2) || 'N/A'}%)
الخوف والطمع: ${fg ? fg.value + '/100 — ' + fg.classificationAr : 'N/A'}
هيمنة BTC: ${dom ? dom.btcDominance + '%' : 'N/A'}
فرص Spot اليوم: ${scanResult.opportunities?.length || 0} عملة فوق 65%

الملخص: 3-4 جمل — حالة السوق، أبرز فرصة، نصيحة اليوم.`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== QUICK SCAN SUMMARY ====================
async function quickScanSummary(opportunities, onChain) {
  if (!opportunities.length) return 'لا توجد فرص تلبي معايير الثقة (65%+) حالياً في السوق الفوري.';
  const system = `أنت "الفهد" — ملخص سوق موجز للسوق الفوري (Spot).`;
  const top3 = opportunities.slice(0, 3);
  const fg = onChain?.fearGreed;
  const prompt = `لخص أفضل فرص الـ Spot:
${fg ? 'الخوف والطمع: ' + fg.value + '/100 — ' + fg.classificationAr : ''}
${top3.map((o, i) => `${i + 1}. ${o.symbol} ${o.direction === 'long' ? 'شراء' : 'بيع'} | $${o.price?.toFixed(4)} | ثقة: ${o.confidence}% | MTF: ${(o.mtfAlignment * 100)?.toFixed(0)}%`).join('\n')}

4-5 أسطر: أبرز فرصة، السياق، تحذير.`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== FREE CHAT ====================
async function freeChatWithFahd(message, history = []) {
  const system = `أنت "الفهد" — تتحاور مع المتداول بصدق واحترافية. تستمع لملاحظاته وتتعلم منها. تركز على السوق الفوري (Spot).`;
  const messages = [...history, { role: 'user', content: message }];
  try {
    const resp = await axios.post(API,
      { model: HAIKU, max_tokens: 800, system, messages },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 25000 }
    );
    return resp.data.content[0]?.text || '';
  } catch (error) {
    throw new Error(`فشل الرد: ${error.message}`);
  }
}

// ==================== FEEDBACK ANALYSIS ====================
async function analyzeFeedback(feedbackData) {
  const system = `أنت "الفهد" — تحلل تغذية راجعة من المتداول وتتعلم منها لتحسين أداءك في السوق الفوري.`;
  const t = feedbackData.trade;
  const prompt = `تغذية راجعة:
${t ? `الصفقة: ${t.symbol} (Spot) ${t.direction === 'long' ? 'شراء' : 'بيع'}
دخول: $${t.entryPrice} | خروج: $${t.exitPrice}
النتيجة: ${t.outcome} (${t.pnlPercent?.toFixed(2)}%)
توصية الفهد: ${t.fahdRecommendation}
قرار المتداول: ${t.userAction}` : ''}
ملاحظة المتداول: ${feedbackData.userNote}

JSON:
{
  "acknowledgment": "<رد صادق>",
  "analysis": "<تحليل الموقف>",
  "whereIWasRight": "<ما كان صحيحاً>",
  "whereIWasWrong": "<ما أخطأت فيه>",
  "lesson": "<الدرس المستفاد>",
  "strategyAdjustment": "<تعديل على استراتيجيتي>",
  "userAdvice": "<نصيحة للمتداول>",
  "summary": "<ملخص>"
}`;
  const resp = await callClaude(HAIKU, system, prompt);
  return parseJSON(resp);
}

module.exports = {
  deepAnalysis, analyzeChart, analyzeLesson,
  generateMorningBriefing, quickScanSummary,
  freeChatWithFahd, analyzeFeedback
};
