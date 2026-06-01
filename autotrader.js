/**
 * autotrader.js — التداول الآلي 🐆 الفهد v2
 * تنفيذ تلقائي فوري عند استيفاء الشروط
 */
const { User, Trade, Alert } = require('./database');
const { scanMarket, getVerifiedPrice, getTopCoins, getMTFAnalysis, runBacktest, getFullOnChainData } = require('./market');
const { deepAnalysis, quickScanSummary } = require('./agent');
const { openTrade, checkCapitalProtection, checkAutoStrictening, getPerformanceMetrics } = require('./portfolio');
const { formatScan, formatTrade } = require('./formatters');
const logger = { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a), debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a) };

let botInstance = null;
function setBot(bot) { 
  botInstance = bot;
  logger.info('🐆 autotrader: botInstance مُعيَّن ✅');
}

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

  const threshold = user.settings.confidenceThreshold || 60;
  const riskMultiplier = user.settings.riskMultiplier || 1.0;
  const strictMode = user.settings.strictMode || false;

  // في وضع التشديد — رفع الحد الفعلي
  const effectiveThresholdMin = strictMode ? Math.min(threshold + 5, 85) : threshold;
  const eligible = (scanResult.opportunities || []).filter(o => o.confidence >= effectiveThresholdMin);
  if (!eligible.length) return { executed: 0, reason: 'لا توجد فرص تستوفي معايير الاستراتيجية' + (strictMode ? ' (وضع التشديد نشط)' : '') };

  // قيد إعادة الدخول: لا نفس العملة مرتين خلال 24 ساعة
  const window24h = new Date(Date.now() - 24 * 3600 * 1000);
  const recentSymbols = new Set();
  const recentTrades24h = await Trade.find({
    userId, openedAt: { $gte: window24h }
  });
  recentTrades24h.forEach(t => recentSymbols.add(t.symbol));

  const rejections = []; // لتقرير أسباب الرفض
  const executed = [];
  for (let i = 0; i < Math.min(slots, eligible.length, type === 'daily' ? 2 : 3); i++) {
    const opp = eligible[i];
    if (type === 'daily' && openTrades.find(t => t.symbol === opp.symbol)) continue;

    // قيد إعادة الدخول 24 ساعة
    if (recentSymbols.has(opp.symbol)) {
      logger.warn('🐆 رفض ' + opp.symbol + ': إعادة دخول خلال 24 ساعة');
      rejections.push({ symbol: opp.symbol, reason: 'إعادة دخول خلال 24 ساعة' });
      continue;
    }

    try {
      // جلب السعر الحالي الحقيقي من OKX/Binance أولاً
      var livePrice = null;
      try {
        var livePD = await getVerifiedPrice(opp.symbol);
        if (livePD && livePD.price > 0) {
          livePrice = livePD.price;
          // تحديث change24h بالقيمة الحقيقية للمهلة الديناميكية
          if (livePD.change24h !== undefined) opp.change24h = livePD.change24h;
        }
      } catch(e) { logger.debug('livePrice فشل: ' + e.message); }

      const [mtf, btData] = await Promise.allSettled([
        getMTFAnalysis(opp.symbol, type),
        runBacktest(opp.symbol, opp.direction, opp.confidence)
      ]);

      const mtfResult = mtf.status === 'fulfilled' ? mtf.value : {};
      const backtestResult = btData.status === 'fulfilled' ? btData.value : {};

      // فحص RSI من MTF الحقيقي قبل deepAnalysis
      var maxRSI = 0;
      if (mtfResult && mtfResult.tfDetails) {
        mtfResult.tfDetails.forEach(function(tf) {
          if ((tf.rsi || 0) > maxRSI) maxRSI = tf.rsi;
        });
      }
      if (maxRSI >= 80) {
        logger.warn('🐆 رفض ' + opp.symbol + ': RSI max ' + maxRSI.toFixed(1) + ' >= 80');
        rejections.push({ symbol: opp.symbol, reason: 'RSI ' + maxRSI.toFixed(0) + ' — تشبع شرائي' });
        continue;
      }

      const fullAnalysis = await deepAnalysis(opp.symbol, {
        ...opp, onChain: scanResult.onChain, mtf: mtfResult, backtest: backtestResult,
        currentPrice: livePrice
      }, type);

      if (!fullAnalysis) continue;

      // عتبة موحدة — يدوي وتلقائي نفس المعيار (فقط bypass لـ autoEnabled)
      const effectiveThreshold = Math.min(threshold, opp.scanConfidence || opp.confidence || threshold);
      if (fullAnalysis.confidence < (effectiveThreshold - 10)) {
        logger.warn('🐆 رفض ' + opp.symbol + ': ثقة ' + fullAnalysis.confidence + '% < ' + (effectiveThreshold-10) + '%');
        rejections.push({ symbol: opp.symbol, reason: 'ثقة التحليل ' + fullAnalysis.confidence + '% أقل من الحد' });
        continue;
      }
      // التنفيذ اليدوي يقبل 'wait' — التلقائي يرفضه
      if (fullAnalysis.recommendation === 'avoid') {
        logger.warn('🐆 رفض ' + opp.symbol + ': توصية avoid من التحليل العميق');
        rejections.push({ symbol: opp.symbol, reason: 'توصية تجنّب من التحليل العميق' });
        continue;
      }
      // 'wait' مقبول يدوياً فقط إذا MTF 100% وثقة > 70%
      if (fullAnalysis.recommendation === 'wait') {
        var mtfAlignment = (mtfResult && mtfResult.alignment) || 0;
        var conf = fullAnalysis.confidence || 0;
        if (!isManual || mtfAlignment < 0.99 || conf < 70) {
          logger.warn('🐆 رفض ' + opp.symbol + ': توصية wait (MTF:' + (mtfAlignment*100).toFixed(0) + '% ثقة:' + conf + '%)');
          rejections.push({ symbol: opp.symbol, reason: 'انتظار تأكيد (MTF ' + (mtfAlignment*100).toFixed(0) + '%)' });
          continue;
        }
        logger.info('🐆 قبول ' + opp.symbol + ': wait مع MTF 100% وثقة ' + conf + '%');
      }
      // فحص Z-Score — تشبع شرائي شديد يمنع التنفيذ
      var zScore = opp.zScore !== undefined ? opp.zScore : 0;
      if (zScore > 2.5) {
        logger.warn('🐆 رفض ' + opp.symbol + ': Z-Score ' + zScore.toFixed(2) + ' > 2.5');
        rejections.push({ symbol: opp.symbol, reason: 'Z-Score ' + zScore.toFixed(2) + ' — تمدد سعري' });
        continue;
      }
      if (zScore > 1.8) {
        fullAnalysis.confidence = Math.max(0, (fullAnalysis.confidence || 0) - 8);
        if (fullAnalysis.confidence < effectiveThreshold) continue;
      }

      // فحص RSI — تشبع شرائي من بيانات MTF
      var maxRSI = 0;
      if (mtfResult && mtfResult.tfDetails) {
        mtfResult.tfDetails.forEach(function(tf) { if ((tf.rsi||0) > maxRSI) maxRSI = tf.rsi; });
      }
      if (maxRSI >= 80) {
        logger.warn('🐆 رفض ' + opp.symbol + ': RSI ' + maxRSI.toFixed(1) + ' >= 80 تشبع شرائي');
        continue;
      }
      if (maxRSI >= 70) {
        logger.info('🐆 تحذير ' + opp.symbol + ': RSI ' + maxRSI.toFixed(1) + ' — خفض ثقة 5%');
        fullAnalysis.confidence = Math.max(0, (fullAnalysis.confidence || 0) - 5);
        if (fullAnalysis.confidence < effectiveThreshold) continue;
      }

      // Backtest=0: نخفّض الثقة فقط ولا نمنع التنفيذ
      if (backtestResult && backtestResult.occurrences === 0) {
        var dataDays = Math.round((backtestResult.dataYears || 0) * 365);
        var penalty = dataDays >= 180 ? 8 : dataDays >= 30 ? 5 : 3;
        fullAnalysis.confidence = Math.max(0, (fullAnalysis.confidence || 0) - penalty);
        logger.info('🐆 ' + opp.symbol + ': Backtest=0 (' + dataDays + 'يوم) -' + penalty + '% → ' + fullAnalysis.confidence + '%');
        if (fullAnalysis.confidence < effectiveThreshold) {
          rejections.push({ symbol: opp.symbol, reason: 'ثقة منخفضة بعد Backtest = 0' });
          continue;
        }
      }

      // استخدام السعر الحي المُجلب — لحظي وحقيقي
      var currentPrice = livePrice || opp.price;

      const trade = await openTrade(userId, {
        symbol: opp.symbol,
        direction: 'long',
        confidence: fullAnalysis.confidence,
        type,
        analysis: fullAnalysis,
        currentPrice: currentPrice,
        change24h: opp.change24h || 0,
        mtfAlignment: mtfResult.alignment || 0,
        backtestSummary: backtestResult ? 'نجاح ' + (backtestResult.winRate||0) + '% (' + (backtestResult.occurrences||0) + ' مرة) | عائد متوسط ' + (backtestResult.avgReturn||0) + '%' : '',
        onChainSnapshot: JSON.stringify(scanResult.onChain || {}).substring(0, 200)
      });

      executed.push({ trade, analysis: fullAnalysis });
      recentSymbols.add(opp.symbol); // منع إعادة الدخول في نفس الجولة
      logger.info('🐆 تنفيذ: ' + opp.symbol + ' ' + fullAnalysis.recommendation + ' ثقة ' + fullAnalysis.confidence + '%');
    } catch (e) {
      logger.warn(`🐆 تخطي ${opp.symbol}: ${e.message}`);
    }
  }

  return { 
    executed: executed.length, 
    trades: executed,
    rejections,
    rejectionSummary: rejections.length > 0 
      ? rejections.map(r => `❌ ${r.symbol}: ${r.reason}`).join('\n')
      : null
  };
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
        // تحقق التشديد التلقائي بعد كل دورة تداول
        await checkAutoStrictening(user.telegramId, botInstance).catch(e => logger.debug('AutoStrict:', e.message));
        logger.info('🐆 botInstance متاح — إرسال النتائج لـ ' + user.telegramId);

        if (result.executed > 0) {
          for (const { trade, analysis } of result.trades) {
            const msg = formatTrade(trade, true);
            await botInstance.sendMessage(user.telegramId, msg);
          }
        } else {
          // إرسال نتائج المسح دائماً — حتى لو لم تُنفَّذ صفقات
          logger.info('🐆 إرسال نتائج المسح لـ ' + user.telegramId + ': ' + (result.reason || 'لا صفقات'));
          const summary = await quickScanSummary(scanResult.opportunities.slice(0, 3), scanResult.onChain);
          const msg = formatScan(scanResult.opportunities, scanResult.totalScanned, summary, scanResult.onChain);

          // أزرار تطابق /scan اليدوي — الـ Scheduler يرسل نفس الأزرار
          const opps = scanResult.opportunities || [];
          const top5 = opps.slice(0, 5);
          const extraCount = opps.length - top5.length;
          const analyzeButtons = top5.map(o => ([{
            text: 'تحليل ' + o.symbol + ' (' + o.confidence + '%)',
            callback_data: 'analyze_' + o.symbol.replace('/USDT','').replace('/','')
          }]));
          const actionRow = [];
          if (extraCount > 0) {
            // توحيد callback_data مع handler في bot.js
            actionRow.push({ text: '✅ عرض ' + extraCount + ' فرصة إضافية', callback_data: 'show_more_opps' });
            actionRow.push({ text: '❌ لا، يكفي', callback_data: 'dismiss_more_opps' });
            // حفظ الفرص الإضافية باستخدام telegramId
            // الفرص الإضافية محفوظة في bot.js عبر pendingScanOpps
          }
          actionRow.push({ text: '⚡ تنفيذ الصفقات الآن', callback_data: 'execute_now' });

          const keyboard = opps.length > 0 ? {
            inline_keyboard: [
              ...analyzeButtons,
              actionRow.length > 1 ? [actionRow[0], actionRow[1]] : [],
              [actionRow[actionRow.length - 1]]
            ].filter(row => row.length > 0)
          } : undefined;

          await botInstance.sendMessage(user.telegramId, msg, keyboard ? { reply_markup: keyboard } : {});
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
