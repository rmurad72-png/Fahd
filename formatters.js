/**
 * formatters.js — تنسيق رسائل 🐆 الفهد v3
 * إصلاح: النقطة العشرية + RTL كامل + تصميم محسّن
 */

const FAHD = '🐆 الفهد';
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';

// علامات اتجاه النص لضمان عرض صحيح في تيليغرام
const RTL_MARK = '\u200F';   // Right-to-Left Mark
const LTR_MARK = '\u200E';   // Left-to-Right Mark
const LTR_ISO  = '\u2066';   // LTR Isolate — يعزل الأرقام
const POP_ISO  = '\u2069';   // Pop Directional Isolate

// تغليف الأرقام والبيانات الإنجليزية لضمان اتجاه صحيح
function n(val) {
  return `${LTR_ISO}${val}${POP_ISO}`;
}

// دالة safe المُصلحة — لا تحذف النقطة العشرية
function safe(text, maxLen = 500) {
  if (text === null || text === undefined) return 'N/A';
  if (typeof text === 'number') return text.toString();
  return String(text)
    // إزالة رموز Markdown فقط — النقطة محمية
    .replace(/[*_`\[\]()~>#+=|{}!\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLen);
}

function fmtPrice(num, dec = 4) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  const val = parseFloat(num);
  if (val === 0) return n('$0');
  const d = val < 0.001 ? 8 : val < 0.01 ? 6 : val < 1 ? 4 : val < 100 ? 3 : 2;
  return n('$' + (val || 0).toFixed(Math.max(d, dec)));
}

function fmtPct(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  const val = parseFloat(num);
  return n((val >= 0 ? '+' : '') + (val || 0).toFixed(2) + '%');
}

function fmtNum(num) {
  if (!num || isNaN(num)) return 'N/A';
  return parseFloat(num).toLocaleString('en-US');
}

function recIcon(rec) {
  return { long: 'شراء', short: 'بيع', wait: 'انتظر', avoid: 'تجنب', enter: 'ادخل الان' }[rec] || 'انتظر';
}

function confBar(conf) {
  const n = Math.round((conf || 0) / 10);
  return '█'.repeat(n) + '░'.repeat(10 - n) + ` ${conf || 0}%`;
}

// ==================== WELCOME ====================
function formatWelcome(user) {
  return `${FAHD} — بوت تداول ذكي
بمستوى صناديق التحوط العالمية
${DIVIDER}

💼 محفظتك الافتراضية: $${(user.portfolio && user.portfolio.balance || 0).toFixed(2)}
🤖 التحليل بـ Claude AI
📊 مسح أكبر 100 عملة Spot بدون Stablecoins
🎯 حد الثقة: ${user.settings?.confidenceThreshold || 65}%

👇 اختر من القائمة`;
}

// ==================== SCAN ====================
function formatScan(opportunities, totalScanned, summary, onChain) {
  const fg = onChain?.fearGreed;
  const dom = onChain?.btcDominance;

  let msg = `${FAHD} — مسح السوق الفوري\n${DIVIDER}\n`;
  msg += `📊 فحص ${totalScanned} عملة Spot`;
  msg += ` | ${opportunities.length} فرصة فوق 65%\n\n`;

  if (fg || dom) {
    msg += `🔗 On-Chain:\n`;
    if (fg) msg += `   الخوف والطمع: ${fg.value}/100 — ${fg.classificationAr}\n`;
    if (dom !== undefined && dom !== null) msg += `   هيمنة BTC: ${typeof dom === 'object' ? (dom.btcDominance || dom.value || 'N/A') : dom}% — ${typeof dom === 'object' ? safe(dom.signal) : ''}\n`;
    msg += '\n';
  }

  if (!opportunities.length) {
    msg += `⚠️ لا توجد فرص تستوفي معايير الاستراتيجية الآن\n`;
    msg += `الفهد يراقب السوق كل ساعة تلقائياً`;
    return msg;
  }

  msg += `⭐ افضل الفرص:\n\n`;
  opportunities.slice(0, 5).forEach((o, i) => {
    const dir = o.direction === 'long' ? 'شراء' : 'بيع';
    const dirIcon = o.direction === 'long' ? '📈' : '📉';
    msg += `${i + 1}. ${o.symbol} ${dirIcon} ${dir}\n`;
    msg += `   السعر: ${fmtPrice(o.price)} | ثقة: ${o.confidence}%\n`;
    msg += `   هدف: ${fmtPrice(o.target)} | وقف: ${fmtPrice(o.stopLoss)}\n`;
    msg += `   R/R: ${o.riskReward?.toFixed(1)}:1 | MTF: ${((o.mtfAlignment || 0) * 100).toFixed(0)}%\n\n`;
  });

  if (summary) {
    msg += `${FAHD}:\n${safe(summary, 600)}`;
  }
  return msg;
}

// ==================== ANALYSIS ====================
function formatAnalysis(analysis, symbol) {
  if (!analysis) return `${FAHD} — فشل تحليل ${symbol}. حاول مجدداً.`;

  const conf = analysis.confidence || 0;
  const rec = recIcon(analysis.recommendation);
  const recEmoji = { long: '🟢', short: '🔴', wait: '🟡', avoid: '⛔' }[analysis.recommendation] || '🟡';
  const hasPrice = analysis.entry && analysis.entry > 0;

  let msg = `${FAHD} — تحليل عميق Spot\n`;
  msg += `${DIVIDER}\n`;
  msg += `🪙 العملة: ${symbol}\n`;
  msg += `${recEmoji} التوصية: ${rec}\n`;
  msg += `🎯 الثقة: ${confBar(conf)}\n`;
  msg += `🏪 السوق: Spot فقط\n`;

  if (hasPrice) {
    msg += `\n💲 مستويات الدخول:\n`;
    msg += `   دخول: ${fmtPrice(analysis.entry, 6)}\n`;
    msg += `   هدف: ${fmtPrice(analysis.target, 6)}\n`;
    msg += `   وقف: ${fmtPrice(analysis.stopLoss, 6)}\n`;
    msg += `   Trailing Stop: 50% من المكسب تلقائياً\n`;
    msg += `   R/R: ${parseFloat(analysis.riskReward || 0).toFixed(1)}:1\n`;
  }

  const a = analysis.analysis || {};
  msg += `\n📊 التحليل الشامل:\n`;
  msg += `   الاتجاه: ${safe(a.trend)}\n`;
  msg += `   الزخم: ${safe(a.momentum)}\n`;
  msg += `   MTF: ${safe(a.mtfSignal)}\n`;
  msg += `   On-Chain: ${safe(a.onChainSignal)}\n`;
  msg += `   Backtest: ${safe(a.backtestInsight)}\n`;
  msg += `   المخاطر: ${safe(a.risks)}\n`;

  msg += `\n💡 خلاصة ${FAHD}:\n${safe(analysis.summary, 400)}`;
  msg += `\n\n${DIVIDER}`;
  msg += `\n⚠️ تحليل ${FAHD} — ليس نصيحة مالية`;
  return msg;
}

// ==================== CHART ====================
function formatChartAnalysis(analysis) {
  if (!analysis) return `${FAHD} — فشل تحليل الشارت. حاول مجدداً.`;

  const conf = analysis.confidence || 0;
  const dec = { enter: '✅ ادخل الان', avoid: '❌ لا تدخل', wait: '⏳ انتظر تاكيدا' }[analysis.recommendation] || '⏳ انتظر';
  const dirText = analysis.direction === 'long' ? '📈 صاعد' : analysis.direction === 'short' ? '📉 هابط' : '↔️ محايد';

  let msg = `${FAHD} — تحليل الشارت البصري Spot\n`;
  msg += `${DIVIDER}\n`;
  msg += `${analysis.symbol ? '🪙 العملة: ' + analysis.symbol + '\n' : ''}`;
  msg += `${analysis.timeframe ? '⏱️ الإطار: ' + analysis.timeframe + '\n' : ''}`;
  msg += `\n🎯 القرار: ${dec}\n`;
  msg += `📊 الثقة: ${confBar(conf)}\n`;
  msg += `📈 الاتجاه: ${dirText}\n`;

  if (analysis.currentPrice) {
    msg += `💲 السعر الحالي: ${fmtPrice(analysis.currentPrice)}\n`;
  }

  if (analysis.suggestedEntry) {
    msg += `\n💡 المستويات المقترحة:\n`;
    msg += `   دخول: ${fmtPrice(analysis.suggestedEntry)}\n`;
    msg += `   هدف: ${fmtPrice(analysis.suggestedTarget)}\n`;
    msg += `   وقف: ${fmtPrice(analysis.suggestedStop)}\n`;
    if (analysis.riskReward) msg += `   R/R: ${parseFloat(analysis.riskReward).toFixed(1)}:1\n`;
  }

  if (analysis.patterns?.length) {
    const cleanPatterns = analysis.patterns
      .filter(p => p && p.length > 2)
      .map(p => safe(p, 50))
      .join(' | ');
    if (cleanPatterns) msg += `\n🕯️ الأنماط: ${cleanPatterns}\n`;
  }

  if (analysis.keyLevels) {
    const sup = (analysis.keyLevels.support || []).filter(Boolean).map(s => fmtPrice(s)).join(', ');
    const res = (analysis.keyLevels.resistance || []).filter(Boolean).map(r => fmtPrice(r)).join(', ');
    if (sup) msg += `\n🟢 دعم: ${sup}\n`;
    if (res) msg += `🔴 مقاومة: ${res}\n`;
  }

  msg += `\n📝 التحليل الفني:\n${safe(analysis.technicalSummary || analysis.reasoning, 600)}`;
  msg += `\n\n${DIVIDER}`;
  msg += `\n⚠️ تحليل ${FAHD} — ليس نصيحة مالية`;
  return msg;
}

// ==================== TRADE ====================
function formatTrade(trade, isNew = true) {
  const dir = trade.direction === 'long' ? '📈 شراء Long' : '📉 بيع Short';
  const title = isNew ? `${FAHD} — صفقة جديدة Spot` : `${FAHD} — تفاصيل الصفقة`;

  let msg = `${title}\n${DIVIDER}\n`;
  msg += `🪙 ${trade.symbol} | ${dir}\n`;
  msg += `🏪 السوق: Spot فقط\n\n`;
  msg += `💲 الأسعار:\n`;
  msg += `   دخول: ${fmtPrice(trade.entryPrice, 6)}\n`;
  msg += `   هدف: ${fmtPrice(trade.targetPrice, 6)}\n`;
  msg += `   وقف: ${fmtPrice(trade.stopLoss, 6)}\n`;
  msg += `   Trailing Stop: 50% من المكسب تلقائياً\n\n`;
  msg += `📊 تفاصيل:\n`;
  msg += `   الحجم: $${trade.sizeUSDT?.toFixed(2)}\n`;
  msg += `   ثقة ${FAHD}: ${confBar(trade.confidence)}\n`;
  msg += `   MTF: ${((trade.mtfAlignment || 0) * 100).toFixed(0)}% تناسق\n`;
  if (trade.entryDeadline) {
    const remaining = Math.max(0, Math.round((new Date(trade.entryDeadline) - Date.now()) / 3600000));
    msg += `   مهلة الدخول: ${remaining} ساعة\n`;
  }
  if (trade.expiresAt) {
    msg += `   تنتهي: ${new Date(trade.expiresAt).toLocaleDateString('ar')}\n`;
  }
  if (trade.backtestSummary) msg += `\n📉 Backtest: ${safe(trade.backtestSummary, 150)}\n`;
  if (trade.analysisSnapshot) msg += `\n💡 ${safe(trade.analysisSnapshot, 200)}\n`;
  msg += `${DIVIDER}`;
  return msg;
}

// ==================== PORTFOLIO SNAPSHOT ====================
function formatPortfolioSnapshot(snap) {
  const totalReturn = ((snap.totalValue - snap.initialBalance) / snap.initialBalance * 100);
  const returnIcon = totalReturn >= 0 ? '📈' : '📉';

  let msg = `${FAHD} — محفظتي الان\n`;
  msg += `${DIVIDER}\n`;
  msg += `📊 الصورة اللحظية للمحفظة\n\n`;
  msg += `💰 الرصيد النقدي: $${(snap.balance || 0).toFixed(2)}\n`;
  msg += `💼 القيمة الكاملة: $${(snap.totalValue || 0).toFixed(2)}\n`;
  msg += `${returnIcon} العائد الكلي: ${fmtPct(totalReturn)}\n`;
  msg += `💵 PnL مفتوح: $${snap.openPnL >= 0 ? '+' : ''}${(snap.openPnL || 0).toFixed(2)}\n`;
  msg += `📉 رأس المال المستخدم: ${snap.capitalUsedPercent}%\n`;
  msg += `⚠️ Drawdown من الذروة: ${snap.drawdown}%\n`;

  if (snap.openTrades?.length) {
    msg += `\n🔄 الصفقات المفتوحة (${snap.openTrades.length}):\n`;
    snap.openTrades.forEach((t, i) => {
      const pnlIcon = (t.currentPnLPercent || 0) >= 0 ? '✅' : '❌';
      msg += `\n${i + 1}. ${t.symbol} ${t.direction === 'long' ? 'شراء' : 'بيع'}\n`;
      msg += `   PnL: ${pnlIcon} $${(t.currentPnL || 0) >= 0 ? '+' : ''}${(t.currentPnL || 0).toFixed(2)} (${fmtPct(t.currentPnLPercent)})\n`;
      if (t.currentStopLoss && t.currentStopLoss !== t.stopLoss) {
        msg += `   Trailing Stop: ${fmtPrice(t.currentStopLoss)}\n`;
      }
      msg += `   هدف: ${fmtPrice(t.targetPrice)} | وقف: ${fmtPrice(t.currentStopLoss || t.stopLoss)}\n`;
      if (t.expiresAt) {
        const h = Math.max(0, Math.round((new Date(t.expiresAt) - Date.now()) / 3600000));
        msg += `   متبقي: ${h} ساعة\n`;
      }
    });
  } else {
    msg += `\n✅ لا توجد صفقات مفتوحة حالياً\n`;
  }

  msg += `\n${DIVIDER}\n`;
  msg += `⚙️ الإعدادات:\n`;
  msg += `   حد الثقة: ${snap.settings?.confidenceThreshold || 65}%\n`;
  msg += `   يومي: ${snap.settings?.autoTradeDaily ? 'فعال ✅' : 'موقف ⏸️'} | شهري: ${snap.settings?.autoTradeMonthly ? 'فعال ✅' : 'موقف ⏸️'}`;
  return msg;
}

// ==================== PERFORMANCE STATS ====================
function formatPerformanceStats(stats, benchmarks) {
  const winRate = parseFloat(stats.winRate || 0);
  const totalReturn = stats.totalReturn || 0;
  const perf = winRate >= 60 ? '🏆 ممتاز' : winRate >= 50 ? '✅ جيد' : winRate >= 40 ? '⚠️ متوسط' : '❌ يحتاج تحسين';

  let msg = `${FAHD} — تقرير الاداء التاريخي\n`;
  msg += `${DIVIDER}\n`;
  msg += `🏪 السوق الفوري Spot فقط\n\n`;
  msg += `📊 التقييم: ${perf}\n\n`;

  msg += `💰 الاداء الكلي:\n`;
  msg += `   العائد الاجمالي: ${fmtPct(totalReturn)}\n`;
  msg += `   PnL محقق: $${(stats.totalPnL || 0).toFixed(2)}\n`;
  msg += `   هذا الشهر: $${(stats.monthlyPnL || 0) >= 0 ? '+' : ''}${(stats.monthlyPnL || 0).toFixed(2)}\n`;
  msg += `   الشهر الماضي: $${(stats.prevMonthPnL || 0) >= 0 ? '+' : ''}${(stats.prevMonthPnL || 0).toFixed(2)}\n\n`;

  msg += `📈 احصائيات الصفقات:\n`;
  msg += `   اجمالي: ${stats.totalTrades || 0} صفقة\n`;
  msg += `   فوز: ${stats.winningTrades || 0} ✅ | خسارة: ${stats.losingTrades || 0} ❌ | ملغاة: ${stats.cancelledOrders || 0} ⏱️\n`;
  msg += `   معدل الفوز: ${winRate}%\n`;
  msg += `   افضل صفقة: +$${(stats.bestTrade || 0).toFixed(2)}\n`;
  msg += `   خسائر متتالية: ${stats.consecutiveLosses || 0}\n\n`;

  if (benchmarks) {
    msg += `⚔️ ${FAHD} vs السوق (30 يوم):\n`;
    msg += `   الفهد 🐆: ${fmtPct(totalReturn)}\n`;
    if (benchmarks.btc?.change30d !== undefined) {
      const diff = totalReturn - benchmarks.btc.change30d;
      msg += `   BTC: ${fmtPct(benchmarks.btc.change30d)} | الفرق: ${fmtPct(diff)} ${diff >= 0 ? '🏆' : '📉'}\n`;
    }
    if (benchmarks.eth?.change30d !== undefined) {
      const diff2 = totalReturn - benchmarks.eth.change30d;
      msg += `   ETH: ${fmtPct(benchmarks.eth.change30d)} | الفرق: ${fmtPct(diff2)} ${diff2 >= 0 ? '🏆' : '📉'}\n`;
    }
    if (benchmarks.totalMarketCap) {
      msg += `   اجمالي السوق: $${(benchmarks.totalMarketCap / 1e12).toFixed(2)}T\n`;
    }
  }

  if (stats.recentTrades?.length) {
    msg += `\n📋 آخر 5 صفقات:\n`;
    stats.recentTrades.slice(0, 5).forEach((t, i) => {
      const icon = t.status === 'cancelled' ? '⏱️' : t.pnl >= 0 ? '✅' : '❌';
      msg += `   ${i+1}. ${t.symbol} ${icon} $${Math.abs(t.pnl || 0).toFixed(2)}\n`;
    });
  }

  msg += `${DIVIDER}`;
  return msg;
}

// ==================== MORNING BRIEFING ====================
function formatMorningBriefing(briefing, scan, benchmarks) {
  const fg = scan?.onChain?.fearGreed;
  const dom = scan?.onChain?.btcDominance;
  const opps = (scan?.opportunities || []).slice(0, 5);

  let msg = FAHD + ' — صباح الخير\n' + DIVIDER + '\n\n';

  // أسعار BTC/ETH
  var btcData = benchmarks && (benchmarks.BTC || benchmarks.btc);
  var ethData = benchmarks && (benchmarks.ETH || benchmarks.eth);
  if (btcData) msg += '₿ BTC: ' + fmtPrice(btcData.price, 0) + ' (' + fmtPct(btcData.change24h) + ')\n';
  if (ethData) msg += 'Ξ ETH: ' + fmtPrice(ethData.price, 0) + ' (' + fmtPct(ethData.change24h) + ')\n';

  // مؤشرات السوق
  if (fg) msg += '😰 الخوف والطمع: ' + fg.value + '/100 — ' + (fg.classificationAr || '') + '\n';
  if (dom) msg += '🏦 هيمنة BTC: ' + (typeof dom === 'number' ? dom.toFixed(1) : dom) + '%\n';

  msg += '\n';

  // الفرص — بالتفصيل
  if (opps.length > 0) {
    msg += '🔍 أفضل فرص Spot اليوم:\n';
    opps.forEach(function(o, i) {
      var conf = Math.round(o.confidence || 0);
      msg += (i+1) + '. ' + o.symbol + ' — ثقة ' + conf + '%';
      if (o.price) msg += ' — $' + fmtPrice(o.price);
      msg += '\n';
    });
    msg += '\n';
  } else {
    msg += '🔍 لا توجد فرص تستوفي المعايير اليوم\n\n';
  }

  // ملخص AI
  if (briefing) msg += '📋 ملخص ' + FAHD + ':\n' + safe(briefing, 500);

  return msg;
}

// ==================== DAILY REPORT ====================
function formatDailyReport(stats, snapshot, closedToday, summary, onChain) {
  const date = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const fg = onChain?.fearGreed;

  let msg = `${FAHD} — التقرير المسائي\n${DIVIDER}\n`;
  msg += `📅 ${date}\n\n`;
  if (fg) msg += `🔗 On-Chain: ${fg.value}/100 — ${fg.classificationAr}\n\n`;
  msg += `💼 المحفظة:\n`;
  msg += `   القيمة: $${(snapshot?.totalValue || 0).toFixed(2)}\n`;
  msg += `   PnL مفتوح: $${(snapshot?.openPnL || 0) >= 0 ? '+' : ''}${(snapshot?.openPnL || 0).toFixed(2)}\n\n`;

  if (closedToday?.length) {
    msg += `📊 صفقات اليوم (${closedToday.length}):\n`;
    closedToday.forEach(t => {
      const icon = t.pnl >= 0 ? '✅' : '❌';
      msg += `   ${icon} ${t.symbol}: $${t.pnl?.toFixed(2)} (${fmtPct(t.pnlPercent)})\n`;
    });
    msg += '\n';
  }

  if (summary) msg += `${FAHD}:\n${safe(summary, 400)}`;
  msg += `\n${DIVIDER}`;
  return msg;
}

// ==================== WEEKLY REPORT ====================
function formatWeeklyReport(stats, snapshot, weekData, benchmarks) {
  let msg = `${FAHD} — التقرير الاسبوعي\n${DIVIDER}\n\n`;
  msg += `💼 القيمة: $${(snapshot?.totalValue || 0).toFixed(2)}\n`;
  msg += `📈 العائد الكلي: ${fmtPct(stats?.totalReturn || 0)}\n\n`;
  msg += `📊 هذا الاسبوع:\n`;
  msg += `   صفقات: ${weekData?.trades || 0} | فوز: ${weekData?.wins || 0} ✅ | خسارة: ${weekData?.losses || 0} ❌\n`;
  msg += `   PnL: $${(weekData?.pnl || 0) >= 0 ? '+' : ''}${(weekData?.pnl || 0).toFixed(2)}\n\n`;

  if (benchmarks) {
    msg += `⚔️ ${FAHD} vs السوق (7 ايام):\n`;
    msg += `   الفهد 🐆: ${fmtPct(stats?.totalReturn || 0)}\n`;
    if (benchmarks.btc) msg += `   BTC: ${fmtPct(benchmarks.btc.change7d)}\n`;
    if (benchmarks.eth) msg += `   ETH: ${fmtPct(benchmarks.eth.change7d)}\n`;
  }

  msg += `\n🏆 معدل الفوز الكلي: ${stats?.winRate || 0}%\n`;
  msg += `${DIVIDER}\n`;
  msg += `التقرير القادم الجمعة — ${FAHD}`;
  return msg;
}

// ==================== STRATEGY ====================
function formatStrategy(user) {
  const s = user.settings;
  let msg = `${FAHD} — الاستراتيجية الحالية\n${DIVIDER}\n\n`;
  msg += `🎯 حد الثقة: ${s.confidenceThreshold || 65}%\n\n`;
  msg += `📅 اليومي:\n`;
  msg += `   حجم الصفقة: ${s.dailyRiskPercent || 3}% من المحفظة\n`;
  msg += `   هدف: متحرك 5-20% (Trailing Stop 50%)\n`;
  msg += `   وقف: ${s.dailyStopLoss || 3}% + Trailing تلقائي\n`;
  msg += `   المدة: ${s.dailyMaxDays || 11} يوم\n`;
  msg += `   انتهاء الدخول: 24 ساعة\n\n`;
  msg += `📆 الشهري:\n`;
  msg += `   حجم اجمالي: ${s.monthlyRiskPercent || 15}% من المحفظة\n`;
  msg += `   دخول: 40% + 30% + 30%\n`;
  msg += `   خروج: 40% + 50% + 10%\n`;
  msg += `   المدة: 30 يوم\n`;
  msg += `   انتهاء الدخول: 48-72 ساعة\n\n`;
  msg += `🧠 التحليل:\n`;
  msg += `   MTF: 1H+4H+1D (يومي) | 1D+3D+1W (شهري)\n`;
  msg += `   On-Chain: Fear&Greed + Funding + Dominance + Mempool\n`;
  msg += `   Backtest: 3 سنوات على العملة والسوق\n\n`;
  msg += `🤖 التعلم الذاتي:\n`;
  msg += `   3 خسائر متتالية او 10% خسارة = تشديد تلقائي\n`;
  msg += `${DIVIDER}`;
  return msg;
}

// ==================== HELP ====================
function formatHelp() {
  let msg = `${FAHD} — دليل الاستخدام\n${DIVIDER}\n\n`;
  msg += `🔍 التحليل والمسح:\n`;
  msg += `   /scan — مسح 100 عملة Spot\n`;
  msg += `   /analyze BTC — تحليل عميق\n`;
  msg += `   /chart — تحليل الشارت (ارسل صورة)\n\n`;
  msg += `💼 المحفظة:\n`;
  msg += `   /portfolio — الصورة اللحظية\n`;
  msg += `   /stats — الاحصائيات والاداء\n`;
  msg += `   /history — سجل الصفقات\n\n`;
  msg += `🤖 التداول:\n`;
  msg += `   /autotrade — التداول الالي\n`;
  msg += `   /trade BTC long — تنفيذ يدوي\n`;
  msg += `   /close 1 — اغلاق صفقة\n\n`;
  msg += `🔔 التنبيهات:\n`;
  msg += `   /alert ETH 3000 — انشاء تنبيه\n`;
  msg += `   /alerts — قائمة التنبيهات\n`;
  msg += `   /delalert 1 — حذف تنبيه\n\n`;
  msg += `🔬 تحليل متقدم:\n`;
  msg += `   /smartmoney BTC — Smart Money\n`;
  msg += `   /forecast BTC — AI Forecast\n`;
  msg += `   /quant BTC — تحليل كمي\n`;
  msg += `   /macro — BTC + الفيدرالي + M2\n`;
  msg += `   /plan BTC — خطة تداول كاملة\n`;
  msg += `   /monthly — مخطط شهري\n\n`;
  msg += `🧠 التعلم:\n`;
  msg += `   /feedback — تغذية راجعة منظمة\n`;
  msg += `   /chat — محادثة حرة مع الفهد\n`;
  msg += `   /myfeedback — سجل التغذية\n`;
  msg += `   /ratings — تقييمات الصفقات\n\n`;
  msg += `📊 قاعدة البيانات:\n`;
  msg += `   /history — قاعدة البيانات التاريخية\n`;
  msg += `   /trades — سجل الصفقات\n\n`;
  msg += `⚙️ اخرى:\n`;
  msg += `   /funds 5000 — اضافة رصيد\n`;
  msg += `   /strategy — الاستراتيجية\n`;
  msg += `${DIVIDER}\n`;
  msg += `⚠️ ${FAHD} — ليس نصيحة مالية`;
  return msg;
}

const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '🔍 مسح الاسواق' }, { text: '💼 محفظتي' }],
      [{ text: '🧠 تحليل عميق' }, { text: '📈 تحليل الشارت' }],
      [{ text: '📊 الاحصائيات' }, { text: '🤖 التداول الالي' }],
      [{ text: '⚙️ الاستراتيجية' }, { text: '❓ مساعدة' }]
    ],
    resize_keyboard: true,
    persistent: true
  }
};

// ==================== نظام البطاقات المنظمة ====================
const CARD_TOP    = '┌─────────────────────────────┐';
const CARD_MID    = '├─────────────────────────────┤';
const CARD_BOT    = '└─────────────────────────────┘';

// بطاقة قصيرة لكل فرصة في المسح
function formatOpportunityCard(opp, index) {
  const dir = opp.direction === 'long' ? '📈 شراء' : '📉 بيع';
  const conf = Math.round(opp.confidence || 0);
  const confBar = '█'.repeat(Math.round(conf/10)) + '░'.repeat(10-Math.round(conf/10));
  const zScore = opp.zScore !== undefined ? opp.zScore : null;
  const zEmoji = opp.zInterpret?.emoji || '⚪';

  let card = `${DIVIDER}\n`;
  card += `${index}. 🪙 ${opp.symbol} ${dir}\n`;
  card += `💲 ${fmtPrice(opp.price)} | 🎯 ${confBar} ${conf}%\n`;
  card += `🎯 هدف: ${fmtPrice(opp.target)} | 🛑 وقف: ${fmtPrice(opp.stopLoss)}\n`;
  card += `⚖️ R/R: ${opp.riskReward?.toFixed(1) || 'N/A'}:1 | MTF: ${((opp.mtfAlignment||0)*100).toFixed(0)}%`;
  if (zScore !== null) card += `\n📐 Z-Score: ${zEmoji} ${zScore} — ${opp.zInterpret?.signal || ''}`;
  return card;
}

// تقسيم نص طويل لرسائل منفصلة ≤ 3800 حرف
function splitIntoMessages(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];
  const messages = [];
  let current = '';
  const NL = '\n'; for (const line of text.split(NL)) {
    if ((current + NL + line).length > maxLen) {
      if (current.trim()) messages.push(current.trim());
      current = line;
    } else {
      current += (current ? NL : '') + line;
    }
  }
  if (current.trim()) messages.push(current.trim());
  return messages;
}

// إرسال رسائل متعددة منظمة
async function sendCards(bot, chatId, sections) {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || !section.trim()) continue;
    await bot.sendMessage(chatId, section);
    if (i < sections.length - 1) await new Promise(r => setTimeout(r, 250));
  }
}

// ==================== نظام الرسائل المنظمة ====================
const D = '━━━━━━━━━━━━━━━━━━━━'; // فاصل قصير
const D2 = '─────────────────────'; // فاصل أخف

// إرسال سلسلة رسائل منظمة بتأخير بينها
async function sendSequence(bot, chatId, messages) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !msg.trim()) continue;
    await bot.sendMessage(chatId, msg);
    if (i < messages.length - 1) await new Promise(r => setTimeout(r, 350));
  }
}

// تقسيم نص طويل لرسائل ≤ 3800 حرف عند السطر
function splitMsg(text, maxLen) {
  maxLen = maxLen || 3800;
  if (!text || text.length <= maxLen) return [text || ''];
  var parts = [];
  var current = '';
  var lines = text.split(String.fromCharCode(10));
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var candidate = current ? current + String.fromCharCode(10) + line : line;
    if (candidate.length > maxLen) {
      if (current.trim()) parts.push(current.trim());
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length ? parts : [text.substring(0, maxLen)];
}

// بطاقة فرصة واحدة من المسح
function fmtOpportunityCard(opp, index) {
  const dir = opp.direction === 'long' ? '📈 شراء' : '📉 بيع';
  const conf = Math.round(opp.confidence || 0);
  const filled = Math.round(conf / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const z = opp.zScore !== undefined ? `
Z: ${opp.zInterpret?.emoji || ''} ${opp.zScore} — ${opp.zInterpret?.signal || ''}` : '';
  return `${D}
${index}. 🪙 ${opp.symbol} ${dir}
💲 ${fmtPrice(opp.price)} | ${bar} ${conf}%
🎯 ${fmtPrice(opp.target)} | 🛑 ${fmtPrice(opp.stopLoss)}
⚖️ R/R: ${opp.riskReward?.toFixed(1) || 'N/A'}:1 | MTF: ${((opp.mtfAlignment||0)*100).toFixed(0)}%${z}`;
}

// تنسيق التحليل العميق كرسائل منفصلة
function fmtAnalysisCards(analysis, symbol) {
  var NL = String.fromCharCode(10);
  var rec = analysis.recommendation || 'wait';
  var recMap = {long: '🟢 شراء', short: '🔴 بيع', wait: '🟡 انتظر', avoid: '⛔ تجنب'};
  var recText = recMap[rec] || '🟡 انتظر';
  var conf = analysis.confidence || 0;
  var filled = Math.round(conf / 10);
  var bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  var a = analysis.analysis || {};

  var card1 = '🐆 الفهد — تحليل عميق Spot' + NL + D + NL +
    '🪙 ' + symbol + NL + recText + ' | ' + bar + ' ' + conf + '%' + NL +
    '🏪 Spot فقط' + NL + D + NL +
    '💲 دخول: ' + fmtPrice(analysis.entry) + NL +
    '🎯 هدف: ' + fmtPrice(analysis.target) + NL +
    '🛑 وقف: ' + fmtPrice(analysis.stopLoss) + NL +
    '⚖️ R/R: ' + (analysis.riskReward ? (analysis.riskReward || 0).toFixed(1) : 'N/A') + ':1';

  var card2 = '📊 التحليل الشامل' + NL + D + NL +
    '📈 الاتجاه: ' + safe(a.trend, 200) + NL +
    '⚡ الزخم: ' + safe(a.momentum, 150) + NL +
    '📡 MTF: ' + safe(a.mtfSignal, 150) + NL +
    '🔗 On-Chain: ' + safe(a.onChainSignal, 150);

  var card3 = '📉 Backtest + المخاطر' + NL + D + NL +
    '🔬 ' + safe(a.backtestInsight, 200) + NL +
    '⚠️ المخاطر: ' + safe(a.risks, 150) + NL +
    '💡 المحفزات: ' + safe(a.catalysts, 150) + NL + D + NL +
    '📝 ' + safe(analysis.summary, 300) + NL + D + NL +
    '⚠️ تحليل الفهد — ليس نصيحة مالية';

  return [card1, card2, card3];
}

// تنسيق رسائل التحليل الطويلة كسلسلة منظمة
function fmtLongAnalysis(title, icon, text) {
  var NL = String.fromCharCode(10);
  var header = '🐆 الفهد — ' + title + NL + D + NL + icon;
  var parts = splitMsg(text, 3500);
  var messages = [];
  for (var i = 0; i < parts.length; i++) {
    var msg = i === 0 ? header + NL + NL + parts[i] : '(' + (i+1) + '/' + parts.length + ')' + NL + parts[i];
    if (i === parts.length - 1) msg += NL + D + NL + '⚠️ تحليل الفهد — ليس نصيحة مالية';
    messages.push(msg);
  }
  return messages;
}

module.exports = {
  formatWelcome, formatScan, formatAnalysis, formatChartAnalysis,
  formatTrade, formatPortfolioSnapshot, formatPerformanceStats,
  formatMorningBriefing, formatDailyReport, formatWeeklyReport,
  sendSequence, splitMsg, fmtOpportunityCard, fmtAnalysisCards, fmtLongAnalysis,
  formatOpportunityCard, splitIntoMessages, sendCards,
  formatStrategy, formatHelp, safe, fmtPrice, fmtPct, MAIN_KEYBOARD, FAHD, DIVIDER
};
