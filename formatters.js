/**
 * formatters.js — تنسيق رسائل 🐆 الفهد v2
 * بدون Markdown entities المشكلة — نص نظيف
 */

function safe(text, maxLen = 500) {
  if (!text && text !== 0) return 'N/A';
  return String(text).replace(/[*_`\[\]()~>#+=|{}.!\\]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, maxLen);
}
function fmtPrice(num, dec = 4) {
  if (!num || isNaN(num)) return 'N/A';
  const n = parseFloat(num);
  return '$' + n.toFixed(n < 0.01 ? 8 : n < 1 ? 6 : dec);
}
function fmtPct(num) { return num !== undefined && !isNaN(num) ? (num >= 0 ? '+' : '') + parseFloat(num).toFixed(2) + '%' : 'N/A'; }
function fmtNum(num) { return num !== undefined && !isNaN(num) ? parseFloat(num).toLocaleString() : 'N/A'; }

// ==================== WELCOME ====================
function formatWelcome(user) {
  return `الفهد — بوت تداول ذكي للسوق الفوري Spot
بمستوى صناديق التحوط العالمية

محفظتك الافتراضية: $${user.portfolio.balance.toFixed(2)}
التحليل بـ Claude AI
مسح أكبر 100 عملة Spot بدون Stablecoins

اختر من القائمة`;
}

// ==================== SCAN ====================
function formatScan(opportunities, totalScanned, summary, onChain) {
  const fg = onChain?.fearGreed;
  const dom = onChain?.btcDominance;
  let msg = `الفهد — مسح السوق الفوري Spot\n`;
  msg += `فحص ${totalScanned} عملة | ${opportunities.length} فرصة فوق 65%\n\n`;
  if (fg) msg += `الخوف والطمع: ${fg.value}/100 — ${fg.classificationAr}\n`;
  if (dom) msg += `هيمنة BTC: ${dom.btcDominance}% — ${safe(dom.signal)}\n`;
  if (!opportunities.length) {
    msg += `\nلا توجد فرص تستوفي معايير الاستراتيجية الآن\nالمراقبة مستمرة كل ساعة`;
    return msg;
  }
  msg += `\nافضل الفرص:\n\n`;
  opportunities.slice(0, 5).forEach((o, i) => {
    msg += `${i + 1}. ${o.symbol} ${o.direction === 'long' ? 'شراء' : 'بيع'}\n`;
    msg += `   السعر: ${fmtPrice(o.price)} | ثقة: ${o.confidence}%\n`;
    msg += `   هدف: ${fmtPrice(o.target)} | وقف: ${fmtPrice(o.stopLoss)}\n`;
    msg += `   R/R: ${o.riskReward?.toFixed(1)}:1 | MTF: ${((o.mtfAlignment || 0) * 100).toFixed(0)}%\n\n`;
  });
  if (summary) msg += `تحليل الفهد:\n${safe(summary, 600)}`;
  return msg;
}

// ==================== ANALYSIS ====================
function formatAnalysis(analysis, symbol) {
  if (!analysis || analysis.error) return `الفهد — فشل تحليل ${symbol}. حاول مجدداً.`;
  const rec = { long: 'شراء', short: 'بيع', wait: 'انتظر', avoid: 'تجنب' }[analysis.recommendation] || 'انتظر';
  const hasPrice = analysis.entry && analysis.entry > 0;
  let msg = `الفهد — تحليل عميق Spot: ${symbol}\n\n`;
  msg += `التوصية: ${rec}\n`;
  msg += `الثقة: ${analysis.confidence || 0}%\n`;
  msg += `السوق: Spot فقط\n`;
  if (hasPrice) {
    msg += `\nالاسعار:\n`;
    msg += `دخول: ${fmtPrice(analysis.entry, 6)}\n`;
    msg += `هدف: ${fmtPrice(analysis.target, 6)}\n`;
    msg += `وقف: ${fmtPrice(analysis.stopLoss, 6)}\n`;
    msg += `Trailing Stop: 50% من المكسب\n`;
    msg += `R/R: ${parseFloat(analysis.riskReward || 0).toFixed(1)}:1\n`;
  }
  msg += `\nالتحليل:\n`;
  msg += `الاتجاه: ${safe(analysis.analysis?.trend)}\n`;
  msg += `الزخم: ${safe(analysis.analysis?.momentum)}\n`;
  msg += `MTF: ${safe(analysis.analysis?.mtfSignal)}\n`;
  msg += `On-Chain: ${safe(analysis.analysis?.onChainSignal)}\n`;
  msg += `Backtest: ${safe(analysis.analysis?.backtestInsight)}\n`;
  msg += `المخاطر: ${safe(analysis.analysis?.risks)}\n`;
  msg += `\nخلاصة الفهد:\n${safe(analysis.summary, 400)}`;
  return msg;
}

// ==================== CHART ====================
function formatChartAnalysis(analysis) {
  if (!analysis) return 'الفهد — فشل تحليل الشارت. حاول مجدداً.';
  const dec = { enter: 'ادخل الان', avoid: 'لا تدخل', wait: 'انتظر تاكيدا' }[analysis.recommendation] || 'انتظر';
  let msg = `الفهد — تحليل الشارت البصري Spot\n\n`;
  msg += `القرار: ${dec}\n`;
  msg += `الثقة: ${analysis.confidence || 0}%\n`;
  msg += `الاتجاه: ${analysis.direction === 'long' ? 'صاعد' : analysis.direction === 'short' ? 'هابط' : 'محايد'}\n`;
  if (analysis.suggestedEntry) {
    msg += `\nمستويات مقترحة:\n`;
    msg += `دخول: ${fmtPrice(analysis.suggestedEntry)}\n`;
    msg += `هدف: ${fmtPrice(analysis.suggestedTarget)}\n`;
    msg += `وقف: ${fmtPrice(analysis.suggestedStop)}\n`;
  }
  if (analysis.patterns?.length) msg += `\nالانماط: ${analysis.patterns.map(safe).join(' | ')}\n`;
  msg += `\n${safe(analysis.technicalSummary || analysis.reasoning, 500)}`;
  msg += `\nتحليل الفهد — ليس نصيحة مالية`;
  return msg;
}

// ==================== TRADE ====================
function formatTrade(trade, isNew = true) {
  const dir = trade.direction === 'long' ? 'شراء Long' : 'بيع Short';
  let msg = `${isNew ? 'الفهد — صفقة جديدة Spot' : 'الفهد — حالة الصفقة'}\n\n`;
  msg += `${trade.symbol} | ${dir}\n`;
  msg += `دخول: ${fmtPrice(trade.entryPrice, 6)}\n`;
  msg += `هدف: ${fmtPrice(trade.targetPrice, 6)}\n`;
  msg += `وقف: ${fmtPrice(trade.stopLoss, 6)}\n`;
  msg += `Trailing Stop: 50% من المكسب تلقائياً\n`;
  msg += `الحجم: $${trade.sizeUSDT?.toFixed(2)}\n`;
  msg += `ثقة الفهد: ${trade.confidence}%\n`;
  msg += `MTF: ${((trade.mtfAlignment || 0) * 100).toFixed(0)}% تناسق\n`;
  if (trade.entryDeadline) msg += `مهلة الدخول: ${new Date(trade.entryDeadline).toLocaleString('ar')}\n`;
  if (trade.expiresAt) msg += `تنتهي: ${new Date(trade.expiresAt).toLocaleString('ar')}\n`;
  if (trade.backtestSummary) msg += `\nBacktest: ${safe(trade.backtestSummary, 200)}`;
  return msg;
}

// ==================== PORTFOLIO SNAPSHOT ====================
function formatPortfolioSnapshot(snap) {
  const totalReturn = ((snap.totalValue - snap.initialBalance) / snap.initialBalance * 100);
  const returnIcon = totalReturn >= 0 ? 'ربح' : 'خسارة';

  let msg = `الفهد — محفظتي الان (Spot)\n`;
  msg += `الصورة اللحظية للمحفظة\n\n`;
  msg += `الرصيد النقدي: $${snap.balance.toFixed(2)}\n`;
  msg += `القيمة الكاملة: $${snap.totalValue.toFixed(2)}\n`;
  msg += `العائد الكلي: ${fmtPct(totalReturn)} (${returnIcon})\n`;
  msg += `PnL مفتوح: $${snap.openPnL >= 0 ? '+' : ''}${snap.openPnL.toFixed(2)}\n`;
  msg += `رأس المال المستخدم: ${snap.capitalUsedPercent}%\n`;
  msg += `الـ Drawdown من الذروة: ${snap.drawdown}%\n\n`;

  if (snap.openTrades.length) {
    msg += `الصفقات المفتوحة الان (${snap.openTrades.length}):\n`;
    snap.openTrades.forEach((t, i) => {
      const pnlIcon = (t.currentPnLPercent || 0) >= 0 ? 'ربح' : 'خسارة';
      msg += `\n${i + 1}. ${t.symbol} ${t.direction === 'long' ? 'شراء' : 'بيع'}\n`;
      msg += `   السعر الحالي vs الدخول: ${fmtPct(t.currentPnLPercent)} (${pnlIcon})\n`;
      msg += `   PnL: $${(t.currentPnL || 0) >= 0 ? '+' : ''}${(t.currentPnL || 0).toFixed(2)}\n`;
      if (t.currentStopLoss && t.currentStopLoss !== t.stopLoss) {
        msg += `   Trailing Stop محدث: ${fmtPrice(t.currentStopLoss)}\n`;
      }
      msg += `   الهدف: ${fmtPrice(t.targetPrice)} | الوقف: ${fmtPrice(t.currentStopLoss || t.stopLoss)}\n`;
      if (t.expiresAt) {
        const remaining = Math.max(0, Math.round((new Date(t.expiresAt) - Date.now()) / 3600000));
        msg += `   متبقي: ${remaining} ساعة\n`;
      }
    });
  } else {
    msg += `لا توجد صفقات مفتوحة حاليا\n`;
  }

  msg += `\nاعدادات التداول:\n`;
  msg += `حد الثقة: ${snap.settings.confidenceThreshold}%\n`;
  msg += `يومي: ${snap.settings.autoTradeDaily ? 'فعال' : 'موقف'} | شهري: ${snap.settings.autoTradeMonthly ? 'فعال' : 'موقف'}`;
  return msg;
}

// ==================== PERFORMANCE STATS ====================
function formatPerformanceStats(stats, benchmarks) {
  const winRate = parseFloat(stats.winRate);
  const perf = winRate >= 60 ? 'ممتاز' : winRate >= 50 ? 'جيد' : winRate >= 40 ? 'متوسط' : 'يحتاج تحسين';
  const totalReturn = stats.totalReturn || 0;

  let msg = `الفهد — تقرير الاداء التاريخي\n`;
  msg += `السوق الفوري Spot فقط\n\n`;

  msg += `التقييم العام: ${perf}\n\n`;

  msg += `الاداء الكلي:\n`;
  msg += `العائد الاجمالي: ${fmtPct(totalReturn)}\n`;
  msg += `PnL محقق: $${(stats.totalPnL || 0).toFixed(2)}\n`;
  msg += `هذا الشهر: $${(stats.monthlyPnL || 0) >= 0 ? '+' : ''}${(stats.monthlyPnL || 0).toFixed(2)}\n`;
  msg += `الشهر الماضي: $${(stats.prevMonthPnL || 0) >= 0 ? '+' : ''}${(stats.prevMonthPnL || 0).toFixed(2)}\n\n`;

  msg += `احصائيات الصفقات:\n`;
  msg += `اجمالي: ${stats.totalTrades} صفقة\n`;
  msg += `فوز: ${stats.winningTrades} | خسارة: ${stats.losingTrades} | ملغاة: ${stats.cancelledOrders || 0}\n`;
  msg += `معدل الفوز: ${stats.winRate}%\n`;
  msg += `افضل صفقة: +$${(stats.bestTrade || 0).toFixed(2)}\n`;
  msg += `خسائر متتالية حالية: ${stats.consecutiveLosses}\n\n`;

  if (benchmarks) {
    msg += `الفهد vs السوق (30 يوم):\n`;
    msg += `الفهد: ${fmtPct(totalReturn)}\n`;
    if (benchmarks.btc?.change30d !== undefined) {
      const btcR = benchmarks.btc.change30d;
      msg += `BTC: ${fmtPct(btcR)}\n`;
      const diff = totalReturn - btcR;
      msg += `الفارق vs BTC: ${fmtPct(diff)} ${diff >= 0 ? '(الفهد يتفوق)' : '(BTC يتفوق)'}\n`;
    }
    if (benchmarks.eth?.change30d !== undefined) {
      const ethR = benchmarks.eth.change30d;
      msg += `ETH: ${fmtPct(ethR)}\n`;
      const diff2 = totalReturn - ethR;
      msg += `الفارق vs ETH: ${fmtPct(diff2)} ${diff2 >= 0 ? '(الفهد يتفوق)' : '(ETH يتفوق)'}\n`;
    }
    if (benchmarks.totalMarketCap) {
      msg += `اجمالي سوق الكريبتو: $${(benchmarks.totalMarketCap / 1e12).toFixed(2)}T\n`;
    }
  }

  if (stats.recentTrades?.length) {
    msg += `\nاخر 5 صفقات:\n`;
    stats.recentTrades.slice(0, 5).forEach((t, i) => {
      const icon = t.status === 'cancelled' ? 'الغاء' : t.pnl >= 0 ? 'ربح' : 'خسارة';
      msg += `${i + 1}. ${t.symbol} | ${icon} $${Math.abs(t.pnl || 0).toFixed(2)}\n`;
    });
  }

  return msg;
}

// ==================== MORNING BRIEFING ====================
function formatMorningBriefing(briefing, scan, benchmarks) {
  const fg = scan?.onChain?.fearGreed;
  let msg = `الفهد — صباح الخير\n\n`;
  if (benchmarks?.btc) msg += `BTC: ${fmtPrice(benchmarks.btc.price, 0)} (${fmtPct(benchmarks.btc.change24h)})\n`;
  if (benchmarks?.eth) msg += `ETH: ${fmtPrice(benchmarks.eth.price, 0)} (${fmtPct(benchmarks.eth.change24h)})\n`;
  if (fg) msg += `الخوف والطمع: ${fg.value}/100 — ${fg.classificationAr}\n`;
  msg += `فرص Spot اليوم: ${scan?.opportunities?.length || 0} عملة فوق 65%\n\n`;
  msg += `ملخص الفهد:\n${safe(briefing, 600)}`;
  return msg;
}

// ==================== DAILY REPORT ====================
function formatDailyReport(stats, snapshot, closedToday, summary, onChain) {
  const date = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const fg = onChain?.fearGreed;
  let msg = `الفهد — التقرير المسائي\n${date}\n\n`;
  if (fg) msg += `On-Chain: ${fg.value}/100 — ${fg.classificationAr}\n\n`;
  msg += `المحفظة:\n`;
  msg += `القيمة: $${snapshot.totalValue.toFixed(2)}\n`;
  msg += `PnL مفتوح: $${snapshot.openPnL.toFixed(2)}\n\n`;
  if (closedToday.length) {
    msg += `صفقات اليوم (${closedToday.length}):\n`;
    closedToday.forEach(t => {
      msg += `${t.symbol}: ${t.pnl >= 0 ? 'ربح' : 'خسارة'} $${Math.abs(t.pnl || 0).toFixed(2)} (${fmtPct(t.pnlPercent)})\n`;
    });
    msg += '\n';
  }
  if (summary) msg += `تحليل الفهد:\n${safe(summary, 400)}`;
  return msg;
}

// ==================== WEEKLY REPORT ====================
function formatWeeklyReport(stats, snapshot, weekData, benchmarks) {
  let msg = `الفهد — التقرير الاسبوعي\n\n`;
  msg += `القيمة: $${snapshot.totalValue.toFixed(2)}\n`;
  msg += `العائد الكلي: ${fmtPct(stats.totalReturn)}\n\n`;
  msg += `هذا الاسبوع:\n`;
  msg += `صفقات: ${weekData.trades} | فوز: ${weekData.wins} | خسارة: ${weekData.losses}\n`;
  msg += `PnL اسبوعي: $${weekData.pnl.toFixed(2)}\n\n`;
  if (benchmarks) {
    msg += `الفهد vs السوق (7 ايام):\n`;
    msg += `الفهد: ${fmtPct(stats.totalReturn)}\n`;
    if (benchmarks.btc) msg += `BTC: ${fmtPct(benchmarks.btc.change7d)}\n`;
    if (benchmarks.eth) msg += `ETH: ${fmtPct(benchmarks.eth.change7d)}\n`;
  }
  msg += `\nمعدل الفوز الكلي: ${stats.winRate}%\n`;
  msg += `التقرير القادم الجمعة — الفهد`;
  return msg;
}

// ==================== STRATEGY ====================
function formatStrategy(user) {
  const s = user.settings;
  let msg = `الفهد — الاستراتيجية الحالية\n\n`;
  msg += `حد الثقة: ${s.confidenceThreshold}%\n\n`;
  msg += `اليومي:\n`;
  msg += `حجم الصفقة: ${s.dailyRiskPercent}% من المحفظة\n`;
  msg += `هدف: متحرك 5-20% (Trailing Stop 50% من المكسب)\n`;
  msg += `وقف: ${s.dailyStopLoss}% + Trailing تلقائي\n`;
  msg += `المدة: ${s.dailyMaxDays} يوم\n`;
  msg += `انتهاء الدخول: 24 ساعة\n\n`;
  msg += `الشهري:\n`;
  msg += `حجم اجمالي: ${s.monthlyRiskPercent}% من المحفظة\n`;
  msg += `دخول: 40% + 30% + 30%\n`;
  msg += `خروج: 40% + 50% + 10%\n`;
  msg += `المدة: 30 يوم\n`;
  msg += `انتهاء الدخول: 48-72 ساعة\n\n`;
  msg += `التحليل:\n`;
  msg += `MTF: 1H+4H+1D (يومي) | 1D+3D+1W (شهري)\n`;
  msg += `On-Chain: Fear&Greed + Funding + BTC Dominance + Mempool\n`;
  msg += `Backtest: 3 سنوات على العملة والسوق العام\n\n`;
  msg += `التعلم الذاتي:\n`;
  msg += `3 خسائر متتالية او 10% خسارة = تشديد تلقائي`;
  return msg;
}

// ==================== HELP ====================
function formatHelp() {
  return `الفهد — دليل الاستخدام\n\nالتحليل والمسح:\n/scan — مسح 100 عملة Spot\n/analyze BTC — تحليل عميق\n/chart — تحليل الشارت (ارسل صورة)\n\nالمحفظة:\n/portfolio — الصورة اللحظية\n/stats — الاحصائيات والاداء\n/history — سجل الصفقات\n\nالتداول:\n/autotrade — التداول الالي\n/trade BTC long — تنفيذ يدوي\n/close 1 — اغلاق صفقة\n\nالتنبيهات:\n/alert ETH 3000\n/alerts | /delalert 1\n\nالتعلم:\n/feedback — تغذية راجعة منظمة\n/chat — محادثة حرة مع الفهد\n/myfeedback — سجل التغذية\n\nاخرى:\n/funds 5000 — اضافة رصيد\n/strategy — الاستراتيجية\n\nالفهد — ليس نصيحة مالية`;
}

const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: 'مسح الاسواق' }, { text: 'محفظتي' }],
      [{ text: 'تحليل عميق' }, { text: 'تحليل الشارت' }],
      [{ text: 'الاحصائيات' }, { text: 'التداول الالي' }],
      [{ text: 'الاستراتيجية' }, { text: 'مساعدة' }]
    ],
    resize_keyboard: true,
    persistent: true
  }
};

module.exports = {
  formatWelcome, formatScan, formatAnalysis, formatChartAnalysis,
  formatTrade, formatPortfolioSnapshot, formatPerformanceStats,
  formatMorningBriefing, formatDailyReport, formatWeeklyReport,
  formatStrategy, formatHelp, safe, fmtPrice, fmtPct, MAIN_KEYBOARD
};
