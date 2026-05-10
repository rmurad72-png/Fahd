/**
 * agent.js — محرك الذكاء 🐆 الفهد v2
 * محدّث: Backtest 3 سنوات + MTF شهري 1D+3D+1W
 */
const axios = require('axios');
const logger = {
  info: (...a) => console.log('[INFO]', ...a),
  warn: (...a) => console.warn('[WARN]', ...a),
  error: (...a) => console.error('[ERROR]', ...a),
  debug: (...a) => {}
};

const API = 'https://api.anthropic.com/v1/messages';
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

async function callClaude(model, system, userMsg, imageB64 = null) {
  const content = [];
  if (imageB64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } });
  content.push({ type: 'text', text: userMsg });
  try {
    const resp = await axios.post(API,
      { model, max_tokens: 2000, system, messages: [{ role: 'user', content }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 45000 }
    );
    return resp.data.content[0]?.text || '';
  } catch (error) {
    logger.error(`🐆 الفهد — Claude API (${model}): ${error.message}`);
    throw new Error(`فشل تحليل الفهد: ${error.message}`);
  }
}

// ==================== JSON PARSER المحسّن ====================
function parseJSON(text) {
  if (!text) return null;
  try {
    let clean = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s !== -1 && e > s) return JSON.parse(clean.substring(s, e + 1));
  } catch {}
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  logger.warn('🐆 الفهد — JSON parser فشل، استخراج يدوي');
  return extractManually(text);
}

function extractManually(text) {
  const getVal = (keys) => {
    for (const key of keys) {
      const match = text.match(new RegExp(`"${key}"\\s*:\\s*"?([^",}\\n]+)"?`));
      if (match) return match[1].trim();
    }
    return null;
  };
  const getNum = (keys) => {
    for (const key of keys) {
      const match = text.match(new RegExp(`"${key}"\\s*:\\s*(\\d+\\.?\\d*)`));
      if (match) return parseFloat(match[1]);
    }
    return null;
  };
  return {
    recommendation: getVal(['recommendation']) || 'wait',
    confidence: getNum(['confidence']) || 0,
    entry: getNum(['entry']),
    target: getNum(['target']),
    stopLoss: getNum(['stopLoss', 'stop_loss']),
    riskReward: getNum(['riskReward', 'risk_reward']),
    summary: text.substring(0, 300),
    analysis: {
      trend: getVal(['trend']) || 'غير محدد',
      momentum: getVal(['momentum']) || 'N/A',
      mtfSignal: getVal(['mtfSignal']) || 'N/A',
      onChainSignal: getVal(['onChainSignal']) || 'N/A',
      backtestInsight: getVal(['backtestInsight']) || 'N/A',
      sentiment: getVal(['sentiment']) || 'N/A',
      risks: getVal(['risks']) || 'N/A',
      catalysts: getVal(['catalysts']) || 'N/A'
    }
  };
}

const SYSTEM_FAHD = `أنت "الفهد 🐆" — وكيل ذكاء اصطناعي متخصص في تداول السوق الفوري (Spot) للعملات الرقمية بمستوى صناديق التحوط العالمية.

قواعد الفهد الأساسية:
1. السوق الفوري (Spot) فقط — لا Futures ولا مشتقات
2. الثقة المُعلنة في التحليل العميق يجب أن تكون متوافقة مع معايير الثقة في المسح
3. إذا كانت ثقة المسح X% فالتحليل العميق يجب أن يكون في نفس النطاق ±15%
4. الحد الأدنى للتوصية بالدخول: 65%
5. الرد بـ JSON صارم فقط — بدون أي نص خارج JSON`;

const SYSTEM_CHART = `أنت "الفهد 🐆" — محلل شارت بصري خبير للسوق الفوري (Spot). الرد بـ JSON صارم فقط.`;

// ==================== DEEP ANALYSIS ====================
async function deepAnalysis(symbol, marketData, type = 'daily') {
  const p = parseFloat(marketData.price) || 0;
  const onChain = marketData.onChain || {};
  const mtf = marketData.mtf || {};
  const backtest = marketData.backtest || {};
  const scanConfidence = marketData.scanConfidence || null;
  const fg = onChain.fearGreed;
  const fr = onChain.fundingRate;
  const dom = onChain.btcDominance;
  const btcChain = onChain.btcOnChain;
  const mempool = onChain.mempool;

  // تفاصيل MTF لكل إطار زمني
  const tfLabels = type === 'daily' ? '1H + 4H + 1D' : '1D + 3D + 1W';
  const tfDetails = (mtf.tfDetails || []).map(tf =>
    `   ${tf.tf}: ${tf.trend === 'bullish' ? 'صاعد' : tf.trend === 'bearish' ? 'هابط' : 'محايد'} | RSI: ${tf.rsi} | BB: ${tf.bbPosition ? (tf.bbPosition * 100).toFixed(0) + '%' : 'N/A'}`
  ).join('\n') || '   بيانات غير متوفرة';

  // تفاصيل Backtest المحسّن
  const backtestSection = backtest ? `
📉 Backtest (${backtest.dataYears ? backtest.dataYears.toFixed(1) + ' سنة' : '3 سنوات'}):
- إشارات تم اختبارها: ${backtest.occurrences || 0} مرة
- معدل الفوز: ${backtest.winRate !== undefined ? backtest.winRate + '%' : 'N/A'}
- متوسط العائد لكل صفقة: ${backtest.avgReturn !== undefined ? backtest.avgReturn + '%' : 'N/A'}
- أسوأ خسارة: ${backtest.worstCase !== undefined ? backtest.worstCase + '%' : 'N/A'}
- أداء آخر 3 أشهر: ${backtest.recentWinRate !== undefined ? backtest.recentWinRate + '%' : 'N/A'}
- أقصى خسائر متتالية: ${backtest.maxConsecLosses || 'N/A'}
- مقارنة بالسوق (BTC+ETH): ${backtest.marketWinRate !== undefined ? backtest.marketWinRate + '%' : 'N/A'}
- الحكم التاريخي: ${backtest.verdictAr || 'محايد'}` : '📉 Backtest: غير متوفر';

  const prompt = `حلل هذه العملة بعمق كامل كمدير صندوق تحوط عالمي — السوق الفوري (Spot) فقط:

🪙 العملة: ${symbol}
💲 السعر: ${p > 0 ? '$' + p.toFixed(p < 1 ? 6 : 2) : 'غير متوفر'}
📊 التغير 24س: ${parseFloat(marketData.change24h || 0).toFixed(2)}%
📈 التغير 7أيام: ${parseFloat(marketData.change7d || 0).toFixed(2)}%
💰 الحجم 24س: ${marketData.volume24h ? '$' + (marketData.volume24h / 1e6).toFixed(1) + 'M' : 'N/A'}
🏆 الترتيب: #${marketData.rank || 'N/A'}
⏱️ الإطار: ${type === 'daily' ? 'يومي' : 'شهري'} (${tfLabels})
${scanConfidence ? `🎯 ثقة المسح الأولي: ${scanConfidence}% (يجب أن يكون التحليل العميق في نفس النطاق ±15%)` : ''}

📊 MTF Analysis (${tfLabels}):
- الاتجاه السائد: ${mtf.dominantTrend || 'غير محدد'}
- فريمات صاعدة: ${mtf.bullishCount || 0}/${(mtf.timeframes || []).length}
- تناسق الفريمات: ${mtf.alignment ? (mtf.alignment * 100).toFixed(0) + '%' : 'N/A'}
- تفاصيل كل إطار:
${tfDetails}

🔗 On-Chain:
- الخوف والطمع: ${fg ? fg.value + '/100 — ' + fg.classificationAr + ' (' + fg.signal + ')' : 'غير متوفر'}
- Funding Rate: ${fr ? fr.rate.toFixed(4) + '% — ' + fr.signalAr : 'غير متوفر'}
- هيمنة BTC: ${dom ? dom.btcDominance + '% — ' + dom.signal : 'غير متوفر'}
- عناوين BTC النشطة: ${btcChain?.activeAddresses ? btcChain.activeAddresses.toLocaleString() + ' — ' + btcChain.signal : 'غير متوفر'}
- Mempool: ${mempool ? mempool.signal : 'غير متوفر'}
${backtestSection}

أجب بـ JSON فقط — لا نص قبله أو بعده:
{
  "symbol": "${symbol}",
  "market": "spot",
  "recommendation": "long|short|wait|avoid",
  "confidence": <0-100 — متوافق مع ثقة المسح>,
  "entry": <سعر الدخول أو null>,
  "target": <الهدف أو null>,
  "stopLoss": <وقف الخسارة أو null>,
  "trailingStop": "50% من المكسب",
  "riskReward": <R/R أو null>,
  "timeframe": "${type}",
  "analysis": {
    "trend": "<تحليل الاتجاه مع ذكر الإطارات>",
    "momentum": "<تحليل الزخم>",
    "mtfSignal": "<تفسير MTF ${tfLabels}>",
    "onChainSignal": "<تفسير On-Chain>",
    "backtestInsight": "<تفسير Backtest مع الإحصائيات الحقيقية>",
    "sentiment": "<مزاج السوق>",
    "catalysts": "<محفزات>",
    "risks": "<مخاطر>"
  },
  "summary": "<ملخص 2-3 جمل واضحة>"
}`;

  const resp = await callClaude(HAIKU, SYSTEM_FAHD, prompt);
  const result = parseJSON(resp);

  if (!result || result.confidence === 0) {
    logger.warn(`🐆 الفهد — deepAnalysis فشل للـ ${symbol}, retry بـ Sonnet...`);
    const resp2 = await callClaude(SONNET, SYSTEM_FAHD, prompt).catch(() => null);
    if (resp2) return parseJSON(resp2) || result;
  }
  return result;
}

// ==================== CHART ANALYSIS ====================
async function analyzeChart(imageB64, context = '') {
  const prompt = `حلل هذا الشارت للسوق الفوري (Spot). ${context ? 'معلومات إضافية: ' + context : ''}

أجب بـ JSON فقط — لا نص قبله أو بعده:
{
  "symbol": "<رمز العملة أو null>",
  "market": "spot",
  "timeframe": "<الإطار الزمني>",
  "recommendation": "enter|avoid|wait",
  "confidence": <0-100>,
  "direction": "long|short|neutral",
  "currentPrice": <السعر الحالي أو null>,
  "suggestedEntry": <سعر الدخول المقترح أو null>,
  "suggestedTarget": <الهدف المقترح أو null>,
  "suggestedStop": <وقف الخسارة المقترح أو null>,
  "riskReward": <نسبة المخاطرة/العائد أو null>,
  "patterns": ["<نمط 1>", "<نمط 2>"],
  "keyLevels": {
    "support": [<مستوى دعم 1>, <مستوى دعم 2>],
    "resistance": [<مستوى مقاومة 1>, <مستوى مقاومة 2>]
  },
  "technicalSummary": "<تحليل فني مفصّل>",
  "decision": "<ادخل الآن|لا تدخل|انتظر تأكيداً>",
  "reasoning": "<مبرر القرار>"
}`;
  const resp = await callClaude(SONNET, SYSTEM_CHART, prompt, imageB64);
  return parseJSON(resp);
}

// ==================== LESSON ====================
async function analyzeLesson(trade, outcome, cancelReason = null) {
  const system = `أنت "الفهد 🐆" — تستخلص دروساً قابلة للتطبيق من كل صفقة لتحسين استراتيجيتك في السوق الفوري.`;
  const prompt = `${cancelReason ? 'أمر ملغى:' : 'صفقة مكتملة:'}
العملة: ${trade.symbol} (Spot) | الاتجاه: ${trade.direction}
الدخول: $${trade.entryPrice} ${trade.exitPrice ? '| الخروج: $' + trade.exitPrice : ''}
النتيجة: ${outcome}${trade.pnlPercent ? ' (' + trade.pnlPercent.toFixed(2) + '%)' : ''}
ثقة الفهد: ${trade.confidence}%
${cancelReason ? 'سبب الإلغاء: ' + cancelReason : 'سبب الإغلاق: ' + (trade.closeReason || 'N/A')}

JSON فقط:
{
  "lesson": "<الدرس الأساسي>",
  "whatWorked": "<ما نجح>",
  "whatFailed": "<ما أخفق>",
  "strategyAdjustment": "<تعديل مقترح>",
  "entryTimingFeedback": "<تقييم توقيت الدخول>",
  "nextTimeApproach": "<المقاربة المستقبلية>"
}`;
  const resp = await callClaude(HAIKU, system, prompt);
  return parseJSON(resp) || { lesson: 'تم الحفظ', strategyAdjustment: '' };
}

// ==================== MORNING BRIEFING ====================
async function generateMorningBriefing(scanResult, benchmarks) {
  const system = `أنت "الفهد 🐆" — تقدم ملخصاً صباحياً موجزاً واحترافياً للسوق الفوري.`;
  const fg = scanResult.onChain?.fearGreed;
  const dom = scanResult.onChain?.btcDominance;
  const prompt = `ملخص صباحي موجز للمتداول (3-4 جمل فقط):

BTC: $${benchmarks?.btc?.price?.toFixed(0) || 'N/A'} (${benchmarks?.btc?.change24h?.toFixed(2) || 'N/A'}%)
ETH: $${benchmarks?.eth?.price?.toFixed(0) || 'N/A'} (${benchmarks?.eth?.change24h?.toFixed(2) || 'N/A'}%)
الخوف والطمع: ${fg ? fg.value + '/100 — ' + fg.classificationAr : 'N/A'}
هيمنة BTC: ${dom ? dom.btcDominance + '%' : 'N/A'}
فرص Spot اليوم (65%+): ${scanResult.opportunities?.length || 0} عملة

اكتب الملخص بالعربية مباشرة — لا JSON.`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== QUICK SCAN SUMMARY ====================
async function quickScanSummary(opportunities, onChain) {
  if (!opportunities.length) return 'لا توجد فرص تلبي معايير الاستراتيجية حالياً في السوق الفوري.';
  const system = `أنت "الفهد 🐆" — تقدم ملخصاً موجزاً لأفضل فرص السوق الفوري. اكتب بالعربية مباشرة دون JSON.`;
  const fg = onChain?.fearGreed;
  const top3 = opportunities.slice(0, 3);
  const prompt = `لخص أفضل فرص Spot في 4-5 أسطر:
${fg ? 'الخوف والطمع: ' + fg.value + '/100 — ' + fg.classificationAr : ''}
${top3.map((o, i) => `${i+1}. ${o.symbol} ${o.direction==='long'?'شراء':'بيع'} | $${o.price?.toFixed(4)} | ثقة: ${o.confidence}% | MTF: ${((o.mtfAlignment||0)*100).toFixed(0)}%`).join('\n')}

اذكر: أبرز فرصة، السياق العام، تحذير مخاطر.`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== FREE CHAT ====================
async function freeChatWithFahd(message, history = []) {
  const system = `أنت "الفهد 🐆" — تتحاور مع المتداول بصدق واحترافية. تستمع لملاحظاته وتتعلم منها. تركز على السوق الفوري (Spot). اكتب بالعربية.`;
  const messages = [...history, { role: 'user', content: message }];
  try {
    const resp = await axios.post(API,
      { model: HAIKU, max_tokens: 1000, system, messages },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 25000 }
    );
    return resp.data.content[0]?.text || '';
  } catch (error) {
    throw new Error(`فشل رد الفهد: ${error.message}`);
  }
}

// ==================== FEEDBACK ====================
async function analyzeFeedback(feedbackData) {
  const system = `أنت "الفهد 🐆" — تحلل تغذية راجعة من المتداول وتتعلم منها لتحسين أدائك في السوق الفوري. اكتب بالعربية.`;
  const t = feedbackData.trade;
  const prompt = `تغذية راجعة:
${t ? `الصفقة: ${t.symbol} (Spot) ${t.direction==='long'?'شراء':'بيع'}
دخول: $${t.entryPrice} | خروج: $${t.exitPrice}
النتيجة: ${t.outcome} (${t.pnlPercent?.toFixed(2)}%)
توصية الفهد: ${t.fahdRecommendation} | قرار المتداول: ${t.userAction}` : ''}
ملاحظة المتداول: ${feedbackData.userNote}

JSON فقط:
{
  "acknowledgment": "<رد صادق>",
  "analysis": "<تحليل الموقف>",
  "whereIWasRight": "<ما كان صحيحاً>",
  "whereIWasWrong": "<ما أخطأت فيه>",
  "lesson": "<الدرس>",
  "strategyAdjustment": "<تعديل على استراتيجيتي>",
  "userAdvice": "<نصيحة للمتداول>",
  "summary": "<ملخص>"
}`;
  const resp = await callClaude(HAIKU, system, prompt);
  return parseJSON(resp) || { acknowledgment: resp, lesson: '', strategyAdjustment: '' };
}

module.exports = {
  deepAnalysis, analyzeChart, analyzeLesson,
  generateMorningBriefing, quickScanSummary,
  freeChatWithFahd, analyzeFeedback
};
