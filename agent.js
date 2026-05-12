/**
 * agent.js — محرك الذكاء 🐆 الفهد v3
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

// التاريخ الحالي لتمريره للـ prompts
function getCurrentDate() {
  const now = new Date();
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

const SYSTEM_FAHD = `أنت "الفهد 🐆" — وكيل ذكاء اصطناعي متخصص في تداول السوق الفوري (Spot) للعملات الرقمية بمستوى صناديق التحوط العالمية.

قواعد صارمة:
1. السوق الفوري (Spot) فقط — لا Futures ولا مشتقات
2. توافق الثقة بين المسح والتحليل العميق ±15%
3. الحد الأدنى للتوصية: 65%
4. الرد بـ JSON صارم فقط — بدون أي نص خارج JSON
5. التاريخ الحالي: \${getCurrentDate()} — استخدمه دائماً

تنسيق النص — ممنوع منعاً باتاً:
- ممنوع استخدام ## أو ### أو # للعناوين
- ممنوع استخدام ** أو __ للتمييز
- ممنوع استخدام \`\`\` للكود
- ممنوع استخدام جداول Markdown | --- |
- استخدم الأرقام والإيموجي للتنظيم فقط`;

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

  // Z-Score من بيانات المسح
  const zScore = marketData.zScore !== undefined ? marketData.zScore : 0;
  const zSignal = marketData.zInterpret?.signal || 'N/A';
  const zAction = marketData.zInterpret?.action || 'N/A';

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

📐 Z-Score (انحراف السعر عن المتوسط 20 يوم):
- القيمة: ${zScore} | الإشارة: ${zSignal} | التوصية: ${zAction}

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
    "zScoreAnalysis": "<تفسير Z-Score وتأثيره على قرار الدخول>",
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

// ==================== SMART MONEY CONCEPTS ====================
async function analyzeSmartMoney(symbol, marketData) {
  const system = `أنت "الفهد 🐆" — محلل Smart Money متخصص. اكتب بالعربية مباشرة.
التاريخ الحالي: ${getCurrentDate()}
ممنوع: ## و ** و \`\`\` والجداول. استخدم الأرقام والإيموجي للتنظيم.`;
  const p = parseFloat(marketData.price) || 0;
  const mtf = marketData.mtf || {};
  const onChain = marketData.onChain || {};
  const prompt = `حلل Smart Money Concepts لـ ${symbol} (Spot فقط):

السعر: $${p > 0 ? p.toFixed(p < 1 ? 6 : 4) : 'N/A'}
MTF: ${mtf.dominantTrend || 'محايد'} | تناسق: ${mtf.alignment ? (mtf.alignment*100).toFixed(0)+'%' : 'N/A'}
الخوف والطمع: ${onChain.fearGreed?.value || 'N/A'}/100
هيمنة BTC: ${onChain.btcDominance?.btcDominance || 'N/A'}%

قدّم تحليلاً شاملاً يشمل:
1. مناطق السيولة الرئيسية (Liquidity Pools) فوق وتحت السعر
2. Order Blocks صاعدة وهابطة مع المستويات
3. Fair Value Gaps (FVG) المفتوحة
4. هل الأموال المؤسسية تتجمع أم تتوزع؟
5. مناطق الاصطياد المحتملة (Stop Hunt Zones)
6. الخلاصة: التوصية بناءً على Smart Money`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== AI FORECAST ====================
async function generateAIForecast(symbol, marketData, backtest) {
  const system = `أنت "الفهد 🐆" — نموذج توقع AI للأسواق. اكتب بالعربية مباشرة.
التاريخ الحالي: ${getCurrentDate()}
ممنوع: ## و ** و \`\`\` والجداول.`;
  const p = parseFloat(marketData.price) || 0;
  const today = getCurrentDate();
  const prompt = `بناءً على البيانات التالية لـ ${symbol} في ${today}، قدّم توقعاً احتمالياً دقيقاً:

السعر الحالي: $${p > 0 ? p.toFixed(p < 1 ? 6 : 4) : 'N/A'}
التغير 24س: ${parseFloat(marketData.change24h || 0).toFixed(2)}%
التغير 7 أيام: ${parseFloat(marketData.change7d || 0).toFixed(2)}%
التغير 30 يوم: ${parseFloat(marketData.change30d || 0).toFixed(2)}%
Backtest معدل الفوز: ${backtest?.winRate || 'N/A'}% (${backtest?.occurrences || 0} إشارة)
الاتجاه السائد: ${marketData.mtf?.dominantTrend || 'محايد'}

توقع الأسبوع القادم:
- السيناريو المتفائل (احتمال %): هدف $...
- السيناريو المحايد (احتمال %): نطاق $...-$...
- السيناريو المتشائم (احتمال %): مستوى دعم $...

توقع الشهر القادم:
- الاتجاه المتوقع مع مستويات رئيسية
- أهم عوامل الخطر والمحفزات

⚠️ هذا نموذج احتمالي وليس ضماناً.`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== FULL TRADING PLAN ====================
async function generateTradingPlan(symbol, analysis, portfolioSize = 10000) {
  const system = `أنت "الفهد 🐆" — مخطط صفقات محترف. اكتب بالعربية.
التاريخ الحالي: ${getCurrentDate()}
ممنوع: ## و ** و \`\`\` والجداول. استخدم الأرقام والإيموجي فقط.`;
  const riskPercent = 2;
  const riskAmount = portfolioSize * riskPercent / 100;
  const today = getCurrentDate();
  const prompt = `ضع خطة تداول احترافية كاملة لـ ${symbol} (Spot) — ${today}:

التوصية: ${analysis?.recommendation || 'N/A'}
الثقة: ${analysis?.confidence || 'N/A'}%
دخول: $${analysis?.entry || 'N/A'}
هدف: $${analysis?.target || 'N/A'}
وقف: $${analysis?.stopLoss || 'N/A'}
R/R: ${analysis?.riskReward || 'N/A'}:1
حجم المحفظة: $${portfolioSize.toFixed(0)}
المخاطرة: ${riskPercent}% = $${riskAmount.toFixed(0)}

Position Sizing:
- حجم الصفقة بالدولار والوحدات
- نسبة المحفظة المستخدمة

إدارة المخاطر:
- وقف الخسارة الأولي
- Trailing Stop بعد تحقيق +5%
- نقطة التعادل (Breakeven)

خطة الخروج (3 أهداف):
- الهدف الأول 50% من المركز
- الهدف الثاني 30% من المركز  
- الهدف الثالث 20% من المركز

شروط الإلغاء:
- متى لا تدخل الصفقة؟`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== MACRO CORRELATION ====================
async function analyzeMacroCorrelation(onChainData) {
  const system = `أنت "الفهد 🐆" — محلل اقتصادي كلي. اكتب بالعربية.
التاريخ الحالي: ${getCurrentDate()}
ممنوع: ## و ** و \`\`\` والجداول. استخدم الأرقام والإيموجي فقط.`;
  const fg = onChainData?.fearGreed;
  const dom = onChainData?.btcDominance;
  const today = getCurrentDate();
  const prompt = `حلل ارتباط BTC بالعوامل الكلية الحالية في ${today}:

مؤشر الخوف والطمع: ${fg?.value || 'N/A'}/100 — ${fg?.classificationAr || ''}
هيمنة BTC: ${dom?.btcDominance || 'N/A'}%
إجمالي السوق: $${dom?.totalMarketCap ? (dom.totalMarketCap/1e12).toFixed(2)+'T' : 'N/A'}
عناوين BTC النشطة: ${onChainData?.btcOnChain?.activeAddresses?.toLocaleString() || 'N/A'}
ضغط الشبكة: ${onChainData?.mempool?.signal || 'N/A'}

1. ارتباط BTC بالسيولة العالمية M2 حالياً
2. تأثير سياسة الفيدرالي المتوقعة على BTC
3. مؤشرات السيولة المؤسسية — دخول أم خروج؟
4. المرحلة الحالية من دورة السوق
5. التوصية الاستراتيجية بناءً على العوامل الكلية`;
  return await callClaude(HAIKU, system, prompt);
}

// ==================== QUANT ANALYSIS ====================
async function generateQuantAnalysis(symbol, backtest, mtf, zScoreData = null) {
  const system = `أنت "الفهد 🐆" — محلل كمي. بالعربية. موجز ومنظم.
التاريخ: ${getCurrentDate()}. ممنوع ## و ** و \`\`\` والجداول.`;
  const hasData = backtest && backtest.occurrences > 0;
  const zScore = zScoreData?.zScore || 0;
  const zSignal = zScoreData?.zInterpret?.signal || 'N/A';

  const prompt = 'تحليل كمي متقدم لـ ' + symbol + ':\n\n' +
    'Backtest (' + (backtest?.dataYears?.toFixed(1) || '?') + ' سنة):\n' +
    '- إشارات: ' + (backtest?.occurrences || 0) + ' | فوز: ' + (backtest?.winRate || 0) + '%\n' +
    '- متوسط عائد: ' + (backtest?.avgReturn || 0) + '% | أسوأ خسارة: ' + (backtest?.worstCase || 0) + '%\n' +
    '- آخر 3 أشهر: ' + (backtest?.recentWinRate || 0) + '% | خسائر متتالية: ' + (backtest?.maxConsecLosses || 0) + '\n' +
    '- مقارنة بالسوق: ' + (backtest?.marketWinRate || 0) + '%\n\n' +
    'MTF: ' + (mtf?.dominantTrend || 'محايد') + ' | تناسق: ' + (mtf?.alignment ? (mtf.alignment*100).toFixed(0)+'%' : 'N/A') + '\n' +
    'Z-Score: ' + zScore + ' — ' + zSignal + '\n\n' +
    'قدّم بإيجاز:\n' +
    '1. EV لكل صفقة\n' +
    '2. Sharpe Ratio تقريبي\n' +
    '3. Maximum Drawdown المتوقع\n' +
    '4. احتمال الربح الشهر القادم (مع Z-Score)\n' +
    '5. Alpha مقارنةً بـ BTC+ETH\n' +
    '6. هل للإشارة Statistical Edge حقيقي؟';

  return await callClaude(HAIKU, system, prompt);
}

// ==================== MONTHLY TRADING PLAN ====================
async function generateMonthlyPlan(opportunities, onChain, benchmarks, portfolioSize = 10000) {
  const system = `أنت "الفهد 🐆" — مخطط استثماري شهري بمستوى صناديق التحوط. اكتب بالعربية.`;
  const fg = onChain?.fearGreed;
  const dom = onChain?.btcDominance;
  const top5 = opportunities.slice(0, 5);
  const prompt = `ضع مخططاً تداولياً شهرياً احترافياً:

حالة السوق:
BTC: $${benchmarks?.btc?.price?.toFixed(0) || 'N/A'} (${benchmarks?.btc?.change30d?.toFixed(1) || 'N/A'}% شهري)
ETH: $${benchmarks?.eth?.price?.toFixed(0) || 'N/A'} (${benchmarks?.eth?.change30d?.toFixed(1) || 'N/A'}% شهري)
الخوف والطمع: ${fg?.value || 'N/A'}/100 — ${fg?.classificationAr || ''}
هيمنة BTC: ${dom?.btcDominance || 'N/A'}%
حجم المحفظة: $${portfolioSize.toFixed(0)}

أفضل الفرص الشهرية:
const oppsList = top5.map((o,i) => (i+1)+'. '+o.symbol+' | ثقة: '+o.confidence+'% | MTF: '+(((o.mtfAlignment||0)*100).toFixed(0))+'%').join('\n');
')}

المطلوب:
1. تقييم المرحلة الشهرية للسوق
2. توزيع رأس المال على الفرص (Position Sizing شهري)
3. الأهداف الشهرية لكل صفقة مع SL/TP
4. إدارة المخاطر الشهرية (حد الخسارة الشهري)
5. مؤشرات قياس الأداء الشهري (KPIs)
6. خطة B إذا تغيرت ظروف السوق`;
  return await callClaude(HAIKU, system, prompt);
}

module.exports = {
  deepAnalysis, analyzeChart, analyzeLesson,
  generateMorningBriefing, quickScanSummary,
  freeChatWithFahd, analyzeFeedback,
  analyzeSmartMoney, generateAIForecast,
  generateTradingPlan, analyzeMacroCorrelation,
  generateQuantAnalysis, generateMonthlyPlan
};
