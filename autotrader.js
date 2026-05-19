/**
 * autotrader.js — التداول الآلي 🐆 الفهد v2
 * تنفيذ تلقائي فوري عند استيفاء الشروط
 */
const { User, Trade, Alert } = require('./database');
const { scanMarket, getVerifiedPrice, getTopCoins, getMTFAnalysis, runBacktest, getFullOnChainData } = require('./market');
const { deepAnalysis, quickScanSummary } = require('./agent');
const { openTrade, checkCapitalProtection } = require('./portfolio');
const { formatScan, formatTrade } = require('./formatters');
const logger = { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a), debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a) };

let botInstance = null;
function setBot(bot) { botInstance = bot; }

// ==================== EXECUTE TRADES FROM SCAN ====================
async function executeTradesFromScan(userId, scanResult, type, isManual) {
  type = type || 'daily';
  isManual = isManual || false;
  const user = await User.findOne({ telegramId: userId });
  if (!user) return { executed: 0, reason: 'مستخدم غير موجود' };

  // التنفيذ اليدوي يتجاوز شرط autoEnabled دائماً
  if (!isManual) {
    const autoEnabled = type === 'daily' ? user.settings.autoTradeDaily : user.settings.autoTradeMonthly;
    if (!autoEnabled) return { executed: 0, reason: 'التداول الآلي ' + (type === 'daily' ? 'اليومي' : 'الشهري') + ' غير مفعّل' };
  }

  const capCheck = await checkCapitalProtection(userId, user);
  if (capCheck.blocked) return { executed: 0, reason: capCheck.reason };

  const openTrades = await Trade.find({ userId, status: { $in: ['open', 'pending_entry'] }, type });
  const maxTrades = type === 'daily' ? 2 : 3;
  const slots = maxTrades - openTrades.length;
  if (slots <= 0) return { executed: 0, reason: 'وصلت للحد الاقصى من الصفقات' };

  const threshold = user.settings.confidenceThreshold || 65;
  const eligible = (scanResult.opportunities || []).filter(o => o.confidence >= threshold);
  if (!eligible.length) return { executed: 0, reason: 'لا توجد فرص تستوفي معايير الاستراتيجية' };

  const executed = [];
  for (let i = 0; i < Math.min(slots, eligible.length, type === 'daily' ? 2 : 3); i++) {
    const opp = eligible[i];
    if (type === 'daily' && openTrades.find(t => t.symbol === opp.symbol)) continue;

    try {
      const [mtf, btData] = await Promise.allSettled([
        getMTFAnalysis(opp.symbol, type),
        runBacktest(opp.symbol, opp.direction, opp.confidence)
      ]);

      const mtfResult = mtf.status === 'fulfilled' ? mtf.value : {};
      const backtestResult = btData.status === 'fulfilled' ? btData.value : {};

      const fullAnalysis = await deepAnalysis(opp.symbol, {
        ...opp, onChain: scanResult.onChain, mtf: mtfResult, backtest: backtestResult
      }, type);

      if (!fullAnalysis) continue;
      // التنفيذ اليدوي: عتبة أقل (55%) وnسمح بـ wait
      const effectiveThreshold = isManual
        ? Math.max(55, (threshold || 65) - 15) // يدوي: threshold - 15%
        : Math.min(threshold, opp.scanConfidence || opp.confidence || threshold);
      if (fullAnalysis.confidence < effectiveThreshold) {
        logger.warn('🐆 رفض ' + opp.symbol + ': ثقة ' + fullAnalysis.confidence + '% < ' + effectiveThreshold + '%');
        continue;
      }
      // التنفيذ اليدوي يقبل 'wait' — التلقائي يرفضه
      if (fullAnalysis.recommendation === 'avoid') {
        logger.warn('🐆 رفض ' + opp.symbol + ': توصية avoid');
        continue;
      }
      if (!isManual && fullAnalysis.recommendation === 'wait') {
        logger.warn('🐆 رفض ' + opp.symbol + ': توصية wait (تلقائي)');
        continue;
      }
      // Backtest=0: إذا البيانات أقل من 30 يوم — نسمح بالتنفيذ بثقة مخفّضة
      // إذا البيانات كافية ولكن لا إشارات — نمنع
      if (backtestResult && backtestResult.occurrences === 0) {
        const dataYears = backtestResult.dataYears || 0;
        const dataDays = Math.round(dataYears * 365);
        if (dataDays >= 30) {
          // بيانات كافية لكن لا إشارات — تخطي
          logger.warn('🐆 تخطي ' + opp.symbol + ': Backtest = 0 رغم ' + dataDays + ' يوم بيانات');
          continue;
        }
        // بيانات ناقصة — نسمح بخفض الثقة 10%
        logger.info('🐆 ' + opp.symbol + ': Backtest محدود (' + dataDays + ' يوم) — تنفيذ بثقة مخفّضة');
        fullAnalysis.confidence = Math.max(0, (fullAnalysis.confidence || 0) - 10);
        if (fullAnalysis.confidence < effectiveThreshold) {
        logger.warn('🐆 رفض ' + opp.symbol + ': ثقة ' + fullAnalysis.confidence + '% < ' + effectiveThreshold + '%');
        continue;
      }
      }

      const trade = await openTrade(userId, {
        symbol: opp.symbol,
        direction: 'long', // Spot فقط — لا short
        confidence: fullAnalysis.confidence,
        type,
        analysis: fullAnalysis,
        mtfAlignment: mtfResult.alignment || 0,
        backtestSummary: backtestResult ? `نجاح ${backtestResult.winRate}% (${backtestResult.occurrences} مرة) | عائد متوسط ${backtestResult.avgReturn}%` : '',
        onChainSnapshot: JSON.stringify(scanResult.onChain || {}).substring(0, 200)
      });

      executed.push({ trade, analysis: fullAnalysis });
      logger.info('🐆 تنفيذ: ' + opp.symbol + ' ' + fullAnalysis.recommendation + ' ثقة ' + fullAnalysis.confidence + '%');
    } catch (e) {
      logger.warn(`🐆 تخطي ${opp.symbol}: ${e.message}`);
    }
  }

  return { executed: executed.length, trades: executed };
}

// ==================== DAILY AUTO TRADE ====================
async function runDailyAutoTrade() {
  logger.info('🐆 الفهد v2: التداول اليومي الآلي 10:15 UTC');
  const users = await User.find({ isActive: true, isBanned: false, 'settings.autoTradeDaily': true });
  if (!users.length) return;

  const scanResult = await scanMarket('daily');
  await notifyExceptionalOpportunities(scanResult.opportunities, scanResult.onChain);

  for (const user of users) {
    try {
      const result = await executeTradesFromScan(user.telegramId, scanResult, 'daily');
      if (botInstance) {
        if (result.executed > 0) {
          for (const { trade, analysis } of result.trades) {
            const msg = formatTrade(trade, true);
            await botInstance.sendMessage(user.telegramId, msg);
          }
        } else {
          const summary = await quickScanSummary(scanResult.opportunities.slice(0, 3), scanResult.onChain);
          const msg = formatScan(scanResult.opportunities, scanResult.totalScanned, summary, scanResult.onChain);
          await botInstance.sendMessage(user.telegramId, msg);
        }
      }
    } catch (e) { logger.error(`🐆 تداول يومي ${user.telegramId}: ${e.message}`); }
  }
}

// ==================== MONTHLY AUTO TRADE ====================
async function runMonthlyAutoTrade() {
  logger.info('🐆 الفهد v2: التداول الشهري الآلي الاثنين 10:10 UTC');
  const users = await User.find({ isActive: true, isBanned: false, 'settings.autoTradeMonthly': true });
  if (!users.length) return;

  const scanResult = await scanMarket('monthly');

  for (const user of users) {
    try {
      const result = await executeTradesFromScan(user.telegramId, scanResult, 'monthly');
      if (botInstance && result.executed > 0) {
        for (const { trade } of result.trades) {
          await botInstance.sendMessage(user.telegramId, formatTrade(trade, true));
        }
      }
    } catch (e) { logger.error(`🐆 تداول شهري ${user.telegramId}: ${e.message}`); }
  }
}

// ==================== EXCEPTIONAL ALERTS 85%+ ====================
async function notifyExceptionalOpportunities(opportunities, onChain) {
  const exceptional = opportunities.filter(o => o.confidence >= 85);
  if (!exceptional.length) return;
  const users = await User.find({ isActive: true, isBanned: false, 'settings.alertsEnabled': true });
  for (const opp of exceptional.slice(0, 2)) {
    const msg = `الفهد — تنبيه استثنائي Spot!\n\nفرصة نادرة بثقة ${opp.confidence}%\n\n${opp.symbol} ${opp.direction === 'long' ? 'شراء' : 'بيع'}\nالسعر: ${opp.price?.toFixed(4)}\nهدف: ${opp.target?.toFixed(4)}\nوقف: ${opp.stopLoss?.toFixed(4)}\nMTF: ${((opp.mtfAlignment || 0) * 100).toFixed(0)}% تناسق\n\nفرصة استثنائية — تصرف بحكمة`;
    for (const user of users) {
      try { await botInstance?.sendMessage(user.telegramId, msg); } catch {}
    }
  }
  logger.info(`🚨 الفهد: ${exceptional.length} تنبيه استثنائي`);
}

// ==================== PRICE ALERTS ====================
async function checkPriceAlerts(bot) {
  const alerts = await Alert.find({ isActive: true });
  for (const alert of alerts) {
    try {
      const { price } = await getVerifiedPrice(alert.symbol);
      const triggered = alert.direction === 'above' ? price >= alert.targetPrice : price <= alert.targetPrice;
      if (triggered) {
        await Alert.updateOne({ _id: alert._id }, { isActive: false, triggeredAt: new Date() });
        const msg = `الفهد — تنبيه سعر\n\n${alert.symbol}\nالسعر: $${(price || 0).toFixed(4)}\nهدفك: $${(alert.targetPrice || 0).toFixed(4)}\n${alert.direction === 'above' ? 'وصل للاعلى' : 'وصل للادنى'}`;
        await bot.sendMessage(alert.userId, msg);
      }
    } catch {}
  }
}

module.exports = { runDailyAutoTrade, runMonthlyAutoTrade, checkPriceAlerts, executeTradesFromScan, setBot };
