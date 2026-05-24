/**
 * scheduler.js — الجدول الزمني 🐆 الفهد v2
 * جميع التوقيتات بـ UTC
 * 10:00 UTC = ملخص صباحي (بعد اغلاق شمعة 09:00 UTC)
 * 10:15 UTC = تداول يومي آلي
 * 10:10 UTC الاثنين = تداول شهري آلي
 * كل ساعة = مراقبة + تنبيهات
 * 17:00 UTC = تقرير مسائي
 * الجمعة 17:00 UTC = تقرير اسبوعي
 */
const cron = require('node-cron');
const { User, Trade } = require('./database');
const { scanMarket, getTopCoins, getFullOnChainData, getPerformanceBenchmarks, saveDailyPrices } = require('./market');
const { generateMorningBriefing, quickScanSummary } = require('./agent');
const { monitorOpenTrades, getPortfolioSnapshot, getPerformanceStats } = require('./portfolio');
const { runDailyAutoTrade, runMonthlyAutoTrade, checkPriceAlerts } = require('./autotrader');
const { formatMorningBriefing, formatDailyReport, formatWeeklyReport } = require('./formatters');
const logger = { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a), debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a) };

let botInstance = null;

function initScheduler(bot) {
  botInstance = bot;
  logger.info('🐆 الفهد v2: تهيئة الجدول الزمني...');

  // ملخص صباحي 10:00 UTC = 13:00 KSA (بعد اغلاق شمعة 09:00 UTC)
  // Railway يعمل بـ UTC — هذا صحيح
  cron.schedule('0 10 * * 1-5', async () => {
    logger.info('الفهد: ملخص صباحي 10:00 UTC (13:00 KSA)');
    try { await sendMorningBriefing(bot); }
    catch (e) { logger.error('خطأ الملخص الصباحي:', e.message); }
  });

  // تداول يومي كل 4 ساعات الاثنين-الجمعة
  // 06:00 | 10:15 | 14:00 | 18:00 UTC
  cron.schedule('15 10 * * 1-5', async () => {
    logger.info('الفهد: تداول يومي 10:15 UTC (13:15 KSA)');
    try { await runDailyAutoTrade(); }
    catch (e) { logger.error('خطأ التداول اليومي 10:15:', e.message); }
  });

  // جولة ثانية 06:00 UTC (09:00 KSA)
  cron.schedule('0 6 * * 1-5', async () => {
    logger.info('الفهد: تداول يومي 06:00 UTC (09:00 KSA)');
    try { await runDailyAutoTrade(); }
    catch (e) { logger.error('خطأ التداول اليومي 06:00:', e.message); }
  });

  // جولة ثالثة 14:00 UTC (17:00 KSA)
  cron.schedule('0 14 * * 1-5', async () => {
    logger.info('الفهد: تداول يومي 14:00 UTC (17:00 KSA)');
    try { await runDailyAutoTrade(); }
    catch (e) { logger.error('خطأ التداول اليومي 14:00:', e.message); }
  });

  // جولة رابعة 18:00 UTC (21:00 KSA)
  cron.schedule('0 18 * * 1-5', async () => {
    logger.info('الفهد: تداول يومي 18:00 UTC (21:00 KSA)');
    try { await runDailyAutoTrade(); }
    catch (e) { logger.error('خطأ التداول اليومي 18:00:', e.message); }
  });

  // تداول شهري كل اثنين 10:10 UTC
  cron.schedule('10 10 * * 1', async () => {
    logger.info('الفهد: تداول شهري الاثنين 10:10 UTC');
    try { await runMonthlyAutoTrade(); }
    catch (e) { logger.error('خطأ التداول الشهري:', e.message); }
  });

  // مراقبة ساعية الاثنين-الجمعة
  cron.schedule('0 * * * 1-5', async () => {
    try {
      await monitorOpenTrades(bot);
      await checkPriceAlerts(bot);
    } catch (e) { logger.error('خطأ المراقبة الساعية:', e.message); }
  });

  // تنبيهات أسعار كل 30 دقيقة
  cron.schedule('*/30 * * * *', async () => {
    try { await checkPriceAlerts(bot); }
    catch (e) { logger.debug('خطأ تنبيهات:', e.message); }
  });

  // تقرير مسائي 17:00 UTC الاثنين-الجمعة
  cron.schedule('0 17 * * 1-5', async () => {
    logger.info('الفهد: تقرير مسائي 17:00 UTC');
    try { await sendEveningReport(bot); }
    catch (e) { logger.error('خطأ التقرير المسائي:', e.message); }
  });

  // تقرير اسبوعي الجمعة 17:00 UTC
  cron.schedule('30 17 * * 5', async () => {
    logger.info('الفهد: تقرير اسبوعي الجمعة 17:30 UTC');
    try { await sendWeeklyReport(bot); }
    catch (e) { logger.error('خطأ التقرير الاسبوعي:', e.message); }
  });

  // تحديث Top 100 كل 6 ساعات
  cron.schedule('0 */6 * * *', async () => {
    try { await getTopCoins(); logger.info('الفهد: تحديث Top 100'); }
    catch (e) { logger.warn('خطأ تحديث:', e.message); }
  });

  // ==================== حفظ الأسعار اليومي 00:05 UTC ====================
  // يبني قاعدة بيانات تاريخية تدريجياً من CMC Free للـ Backtest
  cron.schedule('5 0 * * *', async () => {
    logger.info('🐆 الفهد: حفظ الأسعار اليومي 00:05 UTC');
    try {
      const coins = await getTopCoins();
      if (coins.length > 0) {
        const saved = await saveDailyPrices(coins);
        logger.info(`🐆 PriceHistory: تم حفظ ${saved} عملة`);
      }
    } catch (e) { logger.error('خطأ حفظ الأسعار:', e.message); }
  });

  logger.info('🐆 الفهد v3: الجدول الزمني جاهز');

  // حفظ أولي عند بدء التشغيل (إذا لم يُحفظ اليوم بعد)
  setTimeout(async () => {
    try {
      const coins = await getTopCoins();
      if (coins.length > 0) {
        await saveDailyPrices(coins);
        logger.info('🐆 PriceHistory: حفظ أولي عند بدء التشغيل');
      }
    } catch (e) { logger.warn('PriceHistory init:', e.message); }
  }, 10000); // بعد 10 ثوان من البدء
}

async function sendMorningBriefing(bot) {
  const users = await User.find({ isActive: true, isBanned: false });
  const [scanResult, benchmarks] = await Promise.allSettled([
    scanMarket('daily'),
    getPerformanceBenchmarks()
  ]);
  const scan = scanResult.status === 'fulfilled' ? scanResult.value : { opportunities: [], onChain: null, totalScanned: 0 };
  const bench = benchmarks.status === 'fulfilled' ? benchmarks.value : null;
  const briefing = await generateMorningBriefing(scan, bench);

  // أزرار تحليل سريع للفرص الأبرز في الملخص الصباحي
  const top3 = (scan.opportunities || []).slice(0, 3);
  const morningKeyboard = top3.length > 0 ? {
    inline_keyboard: [
      ...top3.map(o => ([{
        text: 'تحليل ' + o.symbol + ' (' + o.confidence + '%)',
        callback_data: 'analyze_' + o.symbol.replace('/USDT','').replace('/','')
      }])),
      [{ text: '🔍 مسح شامل', callback_data: 'manual_scan' }, { text: '⚡ تنفيذ الآن', callback_data: 'execute_now' }]
    ]
  } : undefined;

  for (const user of users) {
    try {
      const msg = formatMorningBriefing(briefing, scan, bench);
      await bot.sendMessage(user.telegramId, msg, morningKeyboard ? { reply_markup: morningKeyboard } : {});
    } catch (e) { logger.warn(`ملخص صباحي ${user.telegramId}: ${e.message}`); }
  }
}

async function sendEveningReport(bot) {
  const users = await User.find({ isActive: true, isBanned: false });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const onChain = await getFullOnChainData('BTC').catch(() => null);

  for (const user of users) {
    try {
      const [snapshot, closedToday, scanResult] = await Promise.allSettled([
        getPortfolioSnapshot(user.telegramId),
        Trade.find({ userId: user.telegramId, status: 'closed', closedAt: { $gte: today } }),
        scanMarket('daily')
      ]);
      const snap = snapshot.status === 'fulfilled' ? snapshot.value : null;
      const closed = closedToday.status === 'fulfilled' ? closedToday.value : [];
      const scan = scanResult.status === 'fulfilled' ? scanResult.value : { opportunities: [] };

      let summary = '';
      if (scan.opportunities?.length > 0) {
        summary = await quickScanSummary(scan.opportunities.slice(0, 3), scan.onChain);
      }

      if (!snap) continue;
      const stats = { totalReturn: ((snap.totalValue - snap.initialBalance) / snap.initialBalance * 100) };
      const msg = formatDailyReport(stats, snap, closed, summary, onChain);
      await bot.sendMessage(user.telegramId, msg);
    } catch (e) { logger.warn(`تقرير ${user.telegramId}: ${e.message}`); }
  }
}

async function sendWeeklyReport(bot) {
  const users = await User.find({ isActive: true, isBanned: false });
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const benchmarks = await getPerformanceBenchmarks().catch(() => null);

  for (const user of users) {
    try {
      const [stats, snapshot, weekTrades] = await Promise.allSettled([
        getPerformanceStats(user.telegramId),
        getPortfolioSnapshot(user.telegramId),
        Trade.find({ userId: user.telegramId, status: 'closed', closedAt: { $gte: weekAgo } })
      ]);
      if (stats.status !== 'fulfilled' || snapshot.status !== 'fulfilled') continue;
      const wt = weekTrades.status === 'fulfilled' ? weekTrades.value : [];
      const weekData = {
        trades: wt.length,
        wins: wt.filter(t => t.pnl > 0).length,
        losses: wt.filter(t => t.pnl <= 0).length,
        pnl: wt.reduce((s, t) => s + (t.pnl || 0), 0)
      };
      const msg = formatWeeklyReport(stats.value, snapshot.value, weekData, benchmarks);
      await bot.sendMessage(user.telegramId, msg);
    } catch (e) { logger.warn(`اسبوعي ${user.telegramId}: ${e.message}`); }
  }
}

module.exports = { initScheduler };
