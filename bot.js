/**
 * bot.js — البوت الرئيسي 🐆 الفهد v2
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { connectDB, User, Trade, Alert } = require('./database');
const { securityMiddleware, isAdmin, banUser, unbanUser } = require('./security');
const { scanMarket, getVerifiedPrice, getTopCoins, getMTFAnalysis, runBacktest, getHistoricalDaily, getFullOnChainData, getPerformanceBenchmarks } = require('./market');
const { deepAnalysis, analyzeChart, analyzeSmartMoney, generateAIForecast, generateTradingPlan, analyzeMacroCorrelation, generateQuantAnalysis, generateMonthlyPlan } = require('./agent');
const { openTrade, closeTrade, getPortfolioSnapshot, getPerformanceStats, addFunds } = require('./portfolio');
const { runDailyAutoTrade, runMonthlyAutoTrade, executeTradesFromScan, setBot } = require('./autotrader');
const { initScheduler } = require('./scheduler');
const { getState, setState, clearState, handleFeedbackState, getFeedbackHistory } = require('./feedback');
const {
  formatWelcome, formatScan, formatAnalysis, formatChartAnalysis,
  formatTrade, formatPortfolioSnapshot, formatPerformanceStats,
  formatStrategy, formatHelp, MAIN_KEYBOARD, safe, fmtPrice
} = require('./formatters');
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
const logger = { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a), debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a) };

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
setBot(bot);
global.fahdBot = bot; // للتقييم التلقائي

// ==================== STARTUP ====================
async function start() {
  await connectDB();
  try {
    const coins = await getTopCoins();
    logger.info(`🐆 الفهد v2: Top ${coins.length} عملة Spot جاهز — BTC=$${coins.find(c => c.symbol === 'BTC')?.price?.toFixed(0)}`);
  } catch (e) { logger.warn('تحذير: فشل جلب Top 100:', e.message); }
  initScheduler(bot);
  logger.info('🐆 الفهد v2 — بوت التداول الذكي يعمل!');
}

// ==================== HELPERS ====================
async function ensureUser(telegramId, from) {
  let user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) {
    user = new User({
      telegramId: String(telegramId),
      username: from.username,
      firstName: from.first_name,
      isAdmin: isAdmin(telegramId)
    });
    await user.save();
    logger.info(`🐆 مستخدم جديد: ${telegramId} (@${from.username})`);
  }
  return user;
}

async function handle(msg, fn) {
  const userId = String(msg.from?.id);
  const sec = await securityMiddleware(msg);
  if (sec.blocked) {
    if (sec.reason !== 'banned') await bot.sendMessage(userId, 'طلبات كثيرة. الرجاء الانتظار.');
    return;
  }
  try { await fn(); }
  catch (err) {
    logger.error(`خطأ [${userId}]: ${err.message}`);
    await bot.sendMessage(userId, `خطأ: ${safe(err.message)}\nحاول مجدداً.`);
  }
}

// ==================== COMMANDS ====================
bot.onText(/^\/start$|^\/menu$|^\/home$/, async (msg) => {
  await handle(msg, async () => {
    const user = await ensureUser(msg.from.id, msg.from);
    await bot.sendMessage(msg.chat.id, formatWelcome(user), MAIN_KEYBOARD);
  });
});

// مسح الأسواق
bot.onText(/\/scan|مسح الاسواق/, async (msg) => {
  await handle(msg, async () => {
    const loadMsg = await bot.sendMessage(msg.chat.id, 'الفهد يمسح 100 عملة Spot...');
    const scanResult = await scanMarket('daily');
    const { opportunities } = scanResult;
    const summary = opportunities.length > 0
      ? await require('./agent').quickScanSummary(opportunities.slice(0, 3), scanResult.onChain)
      : '';
    const message = formatScan(opportunities, scanResult.totalScanned, summary, scanResult.onChain);
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id);

    const keyboard = opportunities.length > 0 ? {
      inline_keyboard: [
        ...opportunities.slice(0, 3).map(o => ([{
          text: `تحليل ${o.symbol} (${o.confidence}%)`,
          callback_data: `analyze_${o.symbol.replace('/USDT', '').replace('/', '')}`
        }])),
        [{ text: 'تنفيذ الصفقات الان', callback_data: 'execute_now' }]
      ]
    } : undefined;

    await bot.sendMessage(msg.chat.id, message, keyboard ? { reply_markup: keyboard } : {});
  });
});

// تحليل عميق
bot.onText(/\/analyze(?:\s+(\S+))?|تحليل عميق/, async (msg, match) => {
  await handle(msg, async () => {
    const symbol = match?.[1]?.toUpperCase();
    if (!symbol) {
      await bot.sendMessage(msg.chat.id, 'مثال: /analyze BTC\nاو /analyze ETH');
      return;
    }
    const loadMsg = await bot.sendMessage(msg.chat.id, `الفهد يحلل ${symbol} Spot...\nMTF + On-Chain + Backtest`);
    const [coins, mtf, backtest, onChain] = await Promise.allSettled([
      getTopCoins(),
      getMTFAnalysis(symbol + '/USDT', 'daily'),
      runBacktest(symbol + '/USDT', 'long', 70),
      getFullOnChainData(symbol)
    ]);
    const allCoins = coins.status === 'fulfilled' ? coins.value : [];
    const coinData = allCoins.find(c => c.symbol === symbol) || { symbol, rank: 99 };
    let price = coinData.price;
    if (!price) {
      const pd = await getVerifiedPrice(symbol + '/USDT').catch(() => null);
      price = pd?.price || 0;
    }
    const marketData = {
      ...coinData, price,
      mtf: mtf.status === 'fulfilled' ? mtf.value : {},
      backtest: backtest.status === 'fulfilled' ? backtest.value : {},
      onChain: onChain.status === 'fulfilled' ? onChain.value : {}
    };
    const analysis = await deepAnalysis(symbol, marketData, 'daily');
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id);
    await bot.sendMessage(msg.chat.id, formatAnalysis(analysis, symbol), {
      reply_markup: analysis.recommendation === 'long' || analysis.recommendation === 'short' ? {
        inline_keyboard: [[{
          text: `تنفيذ ${analysis.recommendation === 'long' ? 'شراء' : 'بيع'} ${symbol}`,
          callback_data: `open_${symbol}_${analysis.recommendation}_${analysis.confidence}`
        }]]
      } : undefined
    });
  });
});

// تحليل الشارت
bot.onText(/\/chart|تحليل الشارت/, async (msg) => {
  await handle(msg, async () => {
    await bot.sendMessage(msg.chat.id, 'الفهد — تحليل الشارت البصري Spot\n\nارسل صورة الشارت مباشرة');
  });
});

bot.on('photo', async (msg) => {
  await handle(msg, async () => {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const caption = safe(msg.caption || '', 200);
    const loadMsg = await bot.sendMessage(msg.chat.id, 'الفهد يحلل الشارت...');
    const fileLink = await bot.getFileLink(fileId);
    const axios = require('axios');
    const imgResp = await axios.get(fileLink, { responseType: 'arraybuffer', timeout: 15000 });
    const imageB64 = Buffer.from(imgResp.data).toString('base64');
    const analysis = await analyzeChart(imageB64, caption);
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id);
    await bot.sendMessage(msg.chat.id, formatChartAnalysis(analysis));
  });
});

// محفظتي (صورة لحظية)
bot.onText(/\/portfolio|محفظتي/, async (msg) => {
  await handle(msg, async () => {
    const snapshot = await getPortfolioSnapshot(String(msg.from.id));
    await bot.sendMessage(msg.chat.id, formatPortfolioSnapshot(snapshot), {
      reply_markup: { inline_keyboard: [[
        { text: 'سجل الصفقات', callback_data: 'history' },
        { text: 'اضافة رصيد', callback_data: 'add_funds' }
      ]] }
    });
  });
});

// الإحصائيات (تقرير الأداء)
bot.onText(/\/stats|الاحصائيات/, async (msg) => {
  await handle(msg, async () => {
    const [stats, benchmarks] = await Promise.allSettled([
      getPerformanceStats(String(msg.from.id)),
      getPerformanceBenchmarks()
    ]);
    const s = stats.status === 'fulfilled' ? stats.value : null;
    const b = benchmarks.status === 'fulfilled' ? benchmarks.value : null;
    if (!s) { await bot.sendMessage(msg.chat.id, 'فشل جلب الاحصائيات'); return; }
    await bot.sendMessage(msg.chat.id, formatPerformanceStats(s, b));
  });
});

// التداول الآلي
bot.onText(/\/autotrade|التداول الالي/, async (msg) => {
  await handle(msg, async () => {
    const user = await User.findOne({ telegramId: String(msg.from.id) });
    const s = user.settings;
    await bot.sendMessage(msg.chat.id,
      `الفهد — التداول الالي Spot\n\nاليومي: ${s.autoTradeDaily ? 'فعال' : 'موقف'}\nالشهري: ${s.autoTradeMonthly ? 'فعال' : 'موقف'}\n\nالتنفيذ يكون 10:15 UTC يومياً بعد استيفاء جميع الشروط`,
      { reply_markup: { inline_keyboard: [
        [
          { text: `${s.autoTradeDaily ? 'ايقاف' : 'تفعيل'} اليومي`, callback_data: 'toggle_daily' },
          { text: `${s.autoTradeMonthly ? 'ايقاف' : 'تفعيل'} الشهري`, callback_data: 'toggle_monthly' }
        ],
        [{ text: 'تنفيذ يدوي الان', callback_data: 'manual_scan' }]
      ]}}
    );
  });
});

// التنبيهات
bot.onText(/\/alert\s+(\S+)\s+([\d.]+)/, async (msg, match) => {
  await handle(msg, async () => {
    const symbol = match[1].toUpperCase() + '/USDT';
    const targetPrice = parseFloat(match[2]);
    const { price } = await getVerifiedPrice(symbol);
    const direction = targetPrice > price ? 'above' : 'below';
    await new Alert({ userId: String(msg.from.id), symbol, targetPrice, direction }).save();
    await bot.sendMessage(msg.chat.id, `الفهد — تنبيه\n\n${symbol}\nالان: ${fmtPrice(price)}\nعند: ${fmtPrice(targetPrice)}\n${direction === 'above' ? 'صعود' : 'هبوط'}`);
  });
});

bot.onText(/\/alerts/, async (msg) => {
  await handle(msg, async () => {
    const alerts = await Alert.find({ userId: String(msg.from.id), isActive: true });
    if (!alerts.length) { await bot.sendMessage(msg.chat.id, 'لا توجد تنبيهات\n\nمثال: /alert BTC 90000'); return; }
    let txt = 'الفهد — تنبيهاتك\n\n';
    alerts.forEach((a, i) => { txt += `${i + 1}. ${a.symbol} ${a.direction === 'above' ? 'عند ارتفاع' : 'عند انخفاض'} ${fmtPrice(a.targetPrice)}\n`; });
    txt += '\nلحذف: /delalert <رقم>';
    await bot.sendMessage(msg.chat.id, txt);
  });
});

bot.onText(/\/delalert\s+(\d+)/, async (msg, match) => {
  await handle(msg, async () => {
    const alerts = await Alert.find({ userId: String(msg.from.id), isActive: true });
    const idx = parseInt(match[1]) - 1;
    if (idx < 0 || idx >= alerts.length) { await bot.sendMessage(msg.chat.id, 'رقم غير صالح'); return; }
    await Alert.updateOne({ _id: alerts[idx]._id }, { isActive: false });
    await bot.sendMessage(msg.chat.id, `تم حذف تنبيه ${alerts[idx].symbol}`);
  });
});

// التداول اليدوي
bot.onText(/\/trade\s+(\S+)\s+(long|short)/, async (msg, match) => {
  await handle(msg, async () => {
    const symbol = match[1].toUpperCase() + '/USDT';
    const direction = match[2];
    const trade = await openTrade(String(msg.from.id), {
      symbol, direction, confidence: 75, type: 'daily',
      analysis: { summary: 'تنفيذ يدوي' }
    });
    await bot.sendMessage(msg.chat.id, formatTrade(trade, true), {
      reply_markup: { inline_keyboard: [[{ text: 'اغلاق الصفقة', callback_data: `close_${trade.tradeId}` }]] }
    });
  });
});

bot.onText(/\/close\s+(\S+)/, async (msg, match) => {
  await handle(msg, async () => {
    const userId = String(msg.from.id);
    const input = match[1];
    let trade;
    if (input.includes('-')) {
      trade = await Trade.findOne({ userId, tradeId: input, status: { $in: ['open', 'pending_entry'] } });
    } else {
      const trades = await Trade.find({ userId, status: { $in: ['open', 'pending_entry'] } });
      trade = trades[parseInt(input) - 1];
    }
    if (!trade) { await bot.sendMessage(msg.chat.id, 'الصفقة غير موجودة'); return; }
    const result = await closeTrade(userId, trade.tradeId, 'manual');
    const t = result.trade;
    await bot.sendMessage(msg.chat.id, `الفهد — اغلاق صفقة\n\n${t.symbol}\nخروج: ${fmtPrice(t.exitPrice)}\nPnL: $${t.pnl?.toFixed(2)} (${t.pnlPercent?.toFixed(2)}%)`);
  });
});

// سجل الصفقات
bot.onText(/\/history/, async (msg) => {
  await handle(msg, async () => {
    const trades = await Trade.find({ userId: String(msg.from.id), status: { $in: ['closed', 'cancelled'] } }).sort({ closedAt: -1 }).limit(10);
    if (!trades.length) { await bot.sendMessage(msg.chat.id, 'لا يوجد سجل بعد'); return; }
    let txt = 'الفهد — سجل الصفقات\n\n';
    trades.forEach((t, i) => {
      const icon = t.status === 'cancelled' ? 'الغاء' : t.pnl >= 0 ? 'ربح' : 'خسارة';
      txt += `${i + 1}. ${t.symbol} | ${icon}\n`;
      if (t.pnl !== undefined) txt += `   $${t.pnl?.toFixed(2)} (${t.pnlPercent?.toFixed(2)}%)\n`;
      if (t.closeReason) txt += `   السبب: ${t.closeReason}\n`;
      if (t.lessonLearned) txt += `   الدرس: ${safe(t.lessonLearned, 100)}\n`;
      txt += '\n';
    });
    await bot.sendMessage(msg.chat.id, txt);
  });
});

// إضافة رصيد
bot.onText(/\/funds\s+([\d.]+)/, async (msg, match) => {
  await handle(msg, async () => {
    const amount = parseFloat(match[1]);
    const balance = await addFunds(String(msg.from.id), amount);
    await bot.sendMessage(msg.chat.id, `الفهد — تم اضافة الرصيد\n\nالمبلغ: $${amount.toFixed(2)}\nالرصيد الجديد: $${balance.toFixed(2)}`);
  });
});

// الاستراتيجية
bot.onText(/\/strategy|الاستراتيجية/, async (msg) => {
  await handle(msg, async () => {
    const user = await User.findOne({ telegramId: String(msg.from.id) });
    await bot.sendMessage(msg.chat.id, formatStrategy(user));
  });
});

// مساعدة
bot.onText(/\/help|مساعدة/, async (msg) => {
  await handle(msg, async () => {
    await bot.sendMessage(msg.chat.id, formatHelp(), MAIN_KEYBOARD);
  });
});

// تقييمات الصفقات
bot.onText(/\/ratings/, async (msg) => {
  await handle(msg, async () => {
    const userId = String(msg.from.id);
    const ratedTrades = await Trade.find({ userId, rating: { $exists: true, $ne: null } }).sort({ closedAt: -1 }).limit(20);
    if (!ratedTrades.length) {
      await bot.sendMessage(msg.chat.id, 'الفهد — لا توجد تقييمات بعد\n\nستظهر بعد إغلاق الصفقات');
      return;
    }
    const avgRating = ratedTrades.reduce((s, t) => s + t.rating, 0) / ratedTrades.length;
    const stars = '⭐'.repeat(Math.round(avgRating));
    let txt = `الفهد — تقييمات الصفقات\n\n`;
    txt += `متوسط التقييم: ${stars} (${avgRating.toFixed(1)}/5)\n`;
    txt += `عدد التقييمات: ${ratedTrades.length}\n\n`;
    const dist = [1,2,3,4,5].map(r => ({
      stars: r,
      count: ratedTrades.filter(t => t.rating === r).length
    }));
    dist.forEach(d => {
      if (d.count > 0) txt += `${'⭐'.repeat(d.stars)}: ${d.count} صفقة\n`;
    });
    await bot.sendMessage(msg.chat.id, txt);
  });
});

// Feedback
bot.onText(/\/feedback/, async (msg) => {
  await handle(msg, async () => {
    setState(String(msg.from.id), { mode: 'feedback_trade', step: 'symbol' });
    await bot.sendMessage(msg.chat.id, 'الفهد — تغذية راجعة\n\nارسل رمز العملة\nمثال: BTC\n\n/cancel للالغاء');
  });
});

bot.onText(/\/chat(?:\s+(.+))?/, async (msg, match) => {
  await handle(msg, async () => {
    const userId = String(msg.from.id);
    const text = match?.[1];
    if (!text) {
      setState(userId, { mode: 'free_chat' });
      await bot.sendMessage(userId, 'الفهد — محادثة حرة\n\nشاركني ملاحظاتك وتحليلاتك. اتعلم منها.\n\n/endchat لانهاء المحادثة');
      return;
    }
    setState(userId, { mode: 'free_chat' });
    await handleFeedbackState(bot, userId, text);
  });
});

bot.onText(/\/endchat/, async (msg) => {
  const userId = String(msg.from.id);
  clearState(userId);
  await bot.sendMessage(userId, 'الفهد — انتهت المحادثة\n\nشكراً — هذا يساعدني على التطور');
});

bot.onText(/\/cancel/, async (msg) => {
  clearState(String(msg.from.id));
  await bot.sendMessage(msg.chat.id, 'تم الالغاء', MAIN_KEYBOARD);
});

bot.onText(/\/myfeedback/, async (msg) => {
  await handle(msg, async () => {
    const feedbacks = await getFeedbackHistory(String(msg.from.id));
    if (!feedbacks.length) { await bot.sendMessage(msg.chat.id, 'لا توجد تغذية راجعة\n/feedback او /chat'); return; }
    let txt = 'الفهد — سجل التغذية الراجعة\n\n';
    feedbacks.forEach((f, i) => {
      txt += `${i + 1}. ${f.type === 'trade_feedback' ? 'صفقة' : 'محادثة'} | ${new Date(f.createdAt).toLocaleDateString('ar')}\n`;
      if (f.fahdLesson) txt += `   الدرس: ${safe(f.fahdLesson, 100)}\n`;
      txt += '\n';
    });
    await bot.sendMessage(msg.chat.id, txt);
  });
});

// ==================== MESSAGE HANDLER (States) ====================
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const userId = String(msg.from?.id);
  const text = msg.text.trim();
  const state = getState(userId);
  if (!state) return;
  const sec = await securityMiddleware(msg);
  if (sec.blocked) return;
  await handleFeedbackState(bot, userId, text);
});

// ==================== CALLBACKS ====================
bot.on('callback_query', async (query) => {
  const userId = String(query.from.id);
  const data = query.data;
  try {
    await bot.answerCallbackQuery(query.id);

    if (data === 'toggle_daily') {
      const user = await User.findOne({ telegramId: userId });
      const val = !user.settings.autoTradeDaily;
      await User.updateOne({ telegramId: userId }, { $set: { 'settings.autoTradeDaily': val } });
      await bot.sendMessage(userId, `التداول اليومي: ${val ? 'فعال' : 'موقف'}`);
    }

    if (data === 'toggle_monthly') {
      const user = await User.findOne({ telegramId: userId });
      const val = !user.settings.autoTradeMonthly;
      await User.updateOne({ telegramId: userId }, { $set: { 'settings.autoTradeMonthly': val } });
      await bot.sendMessage(userId, `التداول الشهري: ${val ? 'فعال' : 'موقف'}`);
    }

    if (data === 'manual_scan') {
      await bot.sendMessage(userId, 'الفهد يمسح السوق...');
      await runDailyAutoTrade();
    }

    if (data === 'execute_now') {
      const user = await User.findOne({ telegramId: userId });
      const loadMsg2 = await bot.sendMessage(userId, '🐆 الفهد يمسح السوق وينفذ الصفقات المؤهلة...');
      // التنفيذ اليدوي يعمل دائماً — حتى بدون autoTrade مفعّل
      const isManual = true;

      // مسح جديد ومحدث
      const freshScan = await scanMarket('daily');
      logger.info(`🐆 execute_now: ${freshScan.opportunities?.length || 0} فرصة، threshold: ${user.settings.confidenceThreshold}%`);

      let result = { executed: 0, reason: 'لم تبدأ' };

      // محاولة يومي
      if (user.settings.autoTradeDaily) {
        result = await executeTradesFromScan(userId, freshScan, 'daily');
        logger.info(`🐆 execute_now daily: ${result.executed} صفقة — ${result.reason || 'ok'}`);
      }

      // محاولة شهري إذا لم ينجح اليومي
      if (result.executed === 0 && user.settings.autoTradeMonthly) {
        const monthScan = await scanMarket('monthly');
        result = await executeTradesFromScan(userId, monthScan, 'monthly');
        logger.info(`🐆 execute_now monthly: ${result.executed} صفقة — ${result.reason || 'ok'}`);
      }

      await bot.deleteMessage(userId, loadMsg2.message_id).catch(() => {});

      if (result.executed > 0) {
        for (const { trade } of (result.trades || [])) {
          await bot.sendMessage(userId, formatTrade(trade, true));
        }
      } else {
        const reason = result.reason || 'الفرص لا تستوفي معايير التحليل العميق';
        const oppsCount = freshScan.opportunities?.length || 0;
        const threshold = user.settings.confidenceThreshold || 65;
        await bot.sendMessage(userId,
          `🐆 الفهد — لم تُنفَّذ صفقات\n\nالسبب: ${safe(reason)}\n\nالفرص المتاحة: ${oppsCount}\nحد الثقة: ${threshold}%\n\n💡 جرب:\n• تخفيض حد الثقة من /strategy\n• تفعيل التداول الآلي من /autotrade\n• انتظر المسح الصباحي 10:15 UTC`
        );
      }
    }

    if (data.startsWith('analyze_')) {
      const sym = data.replace('analyze_', '').toUpperCase();
      const loadMsg = await bot.sendMessage(userId, `الفهد يحلل ${sym}...`);
      const [coins, mtf, backtest, onChain] = await Promise.allSettled([
        getTopCoins(), getMTFAnalysis(sym + '/USDT', 'daily'),
        runBacktest(sym + '/USDT', 'long', 70), getFullOnChainData(sym)
      ]);
      const allCoins = coins.status === 'fulfilled' ? coins.value : [];
      const coinData = allCoins.find(c => c.symbol === sym) || { symbol: sym, rank: 99 };
      let price = coinData.price;
      if (!price) { const pd = await getVerifiedPrice(sym + '/USDT').catch(() => null); price = pd?.price || 0; }
      const scanRes2 = await scanMarket('daily').catch(() => null);
      const scanOpp2 = scanRes2?.opportunities?.find(o => o.symbol === sym + '/USDT');
      const scanConfidence2 = scanOpp2?.confidence || null;
      const analysis = await deepAnalysis(sym, {
        ...coinData, price,
        scanConfidence: scanConfidence2,
        mtf: mtf.status === 'fulfilled' ? mtf.value : {},
        backtest: backtest.status === 'fulfilled' ? backtest.value : {},
        onChain: onChain.status === 'fulfilled' ? onChain.value : {}
      }, 'daily');
      await bot.deleteMessage(userId, loadMsg.message_id).catch(() => {});
      await bot.sendMessage(userId, formatAnalysis(analysis, sym));
    }

    if (data.startsWith('open_')) {
      const parts = data.split('_');
      const sym = parts[1] + '/USDT';
      const dir = parts[2];
      const conf = parseInt(parts[3]);
      const trade = await openTrade(userId, { symbol: sym, direction: dir, confidence: conf, type: 'daily', analysis: { summary: `تنفيذ من تحليل ${conf}%` } });
      await bot.sendMessage(userId, formatTrade(trade, true));
    }

    if (data.startsWith('close_')) {
      const tradeId = data.replace('close_', '');
      const result = await closeTrade(userId, tradeId, 'manual');
      const t = result.trade;
      await bot.sendMessage(userId, `الفهد — اغلاق\n${t.symbol}\nPnL: $${t.pnl?.toFixed(2)}`);
    }

    if (data === 'history') {
      bot.emit('message', { text: '/history', from: query.from, chat: { id: userId } });
    }

    if (data === 'add_funds') {
      await bot.sendMessage(userId, 'مثال: /funds 5000');
    }

    // Quant callback
    if (data.startsWith('quant_')) {
      const sym = data.replace('quant_', '');
      const loadMsg = await bot.sendMessage(userId, `🐆 تحليل كمي لـ ${sym}...`);
      try {
        const [bt, mtf] = await Promise.allSettled([runBacktest(sym+'/USDT','long',70), getMTFAnalysis(sym+'/USDT','daily')]);
        const analysis = await generateQuantAnalysis(sym, bt.value, mtf.value||{});
        await bot.deleteMessage(userId, loadMsg.message_id).catch(()=>{});
        await bot.sendMessage(userId, `🐆 الفهد — Quant\n${DIVIDER}\n📊 ${sym}\n\n${safe(analysis, 1500)}\n\n⚠️ ليس نصيحة مالية`);
      } catch(e) { await bot.editMessageText('فشل التحليل الكمي', {chat_id: userId, message_id: loadMsg.message_id}).catch(()=>{}); }
    }

    // Forecast callback
    if (data.startsWith('forecast_')) {
      const sym = data.replace('forecast_', '');
      const loadMsg = await bot.sendMessage(userId, `🐆 توقع AI لـ ${sym}...`);
      try {
        const [coins, bt, mtf] = await Promise.allSettled([getTopCoins(), runBacktest(sym+'/USDT','long',70), getMTFAnalysis(sym+'/USDT','daily')]);
        const coinData = (coins.value||[]).find(c=>c.symbol===sym)||{symbol:sym};
        const forecast = await generateAIForecast(sym, {...coinData, mtf: mtf.value||{}}, bt.value);
        await bot.deleteMessage(userId, loadMsg.message_id).catch(()=>{});
        await bot.sendMessage(userId, `🐆 الفهد — AI Forecast\n${DIVIDER}\n🪙 ${sym}\n\n${safe(forecast, 1500)}\n\n⚠️ نموذج احتمالي`);
      } catch(e) { await bot.editMessageText('فشل التوقع', {chat_id: userId, message_id: loadMsg.message_id}).catch(()=>{}); }
    }

    // Smart Money callback
    if (data.startsWith('smartmoney_')) {
      const sym = data.replace('smartmoney_', '');
      const loadMsg = await bot.sendMessage(userId, `🐆 Smart Money لـ ${sym}...`);
      try {
        const [coins, mtf, onChain] = await Promise.allSettled([getTopCoins(), getMTFAnalysis(sym+'/USDT','daily'), getFullOnChainData(sym)]);
        const coinData = (coins.value||[]).find(c=>c.symbol===sym)||{symbol:sym};
        const analysis = await analyzeSmartMoney(sym, {...coinData, mtf: mtf.value||{}, onChain: onChain.value||{}});
        await bot.deleteMessage(userId, loadMsg.message_id).catch(()=>{});
        await bot.sendMessage(userId, `🐆 الفهد — Smart Money\n${DIVIDER}\n🪙 ${sym}\n\n${safe(analysis, 1500)}\n\n⚠️ ليس نصيحة مالية`);
      } catch(e) { await bot.editMessageText('فشل التحليل', {chat_id: userId, message_id: loadMsg.message_id}).catch(()=>{}); }
    }

    // Macro callback
    if (data === 'macro_analysis') {
      const loadMsg = await bot.sendMessage(userId, '🐆 تحليل العوامل الكلية...');
      try {
        const onChain = await getFullOnChainData('BTC').catch(()=>null);
        const analysis = await analyzeMacroCorrelation(onChain);
        await bot.deleteMessage(userId, loadMsg.message_id).catch(()=>{});
        await bot.sendMessage(userId, `🐆 الفهد — تحليل كلي\n${DIVIDER}\n🏦 BTC + الفيدرالي + M2\n\n${safe(analysis, 1500)}\n\n⚠️ ليس نصيحة مالية`);
      } catch(e) { await bot.editMessageText('فشل التحليل', {chat_id: userId, message_id: loadMsg.message_id}).catch(()=>{}); }
    }

    // تقييم الصفقة ⭐
    if (data.startsWith('rate_')) {
      const parts = data.split('_');
      const tradeId = parts[1];
      const rating = parseInt(parts[2]);
      try {
        await Trade.updateOne({ tradeId }, { $set: { rating } });
        const stars = '⭐'.repeat(rating);
        await bot.sendMessage(userId, `الفهد — شكراً على تقييمك\n\n${stars}\n\nهذا يساعد الفهد على التحسين المستمر`);
        logger.info(`🐆 تقييم صفقة: ${tradeId} = ${rating} نجوم`);
      } catch (e) {
        logger.warn(`تقييم فشل: ${e.message}`);
      }
    }

    // Feedback callbacks
    if (data === 'fb_long' || data === 'fb_short') {
      const dir = data === 'fb_long' ? 'long' : 'short';
      const state = getState(userId);
      if (state) {
        setState(userId, { ...state, step: 'entry', trade: { ...state.trade, direction: dir } });
        await bot.sendMessage(userId, `الاتجاه: ${dir === 'long' ? 'شراء' : 'بيع'}\n\nما سعر دخولك؟`);
      }
    }

    if (data.startsWith('fb_rec_')) {
      const rec = data.replace('fb_rec_', '');
      const state = getState(userId);
      if (state) {
        setState(userId, { ...state, step: 'note', trade: { ...state.trade, fahdRecommendation: rec } });
        await bot.sendMessage(userId, `توصية الفهد: ${rec}\n\nشاركني ملاحظتك الشخصية عن هذه الصفقة:`);
      }
    }

  } catch (err) {
    logger.error(`Callback خطأ: ${err.message}`);
    await bot.sendMessage(userId, `خطأ: ${safe(err.message)}`);
  }
});

// ==================== ADMIN ====================
bot.onText(/\/admin_ban\s+(\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  await banUser(match[1], 'حظر من الادمن');
  await bot.sendMessage(msg.chat.id, `تم حظر ${match[1]}`);
});

bot.onText(/\/admin_stats/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const totalUsers = await User.countDocuments();
  const openTrades = await Trade.countDocuments({ status: { $in: ['open', 'pending_entry'] } });
  await bot.sendMessage(msg.chat.id, `الفهد v2 — احصائيات\n\nالمستخدمون: ${totalUsers}\nصفقات مفتوحة: ${openTrades}`);
});

// ==================== ERROR HANDLING ====================
bot.on('polling_error', err => logger.error('Polling:', err.message));
process.on('unhandledRejection', err => logger.error('Rejection:', err));
process.on('uncaughtException', err => logger.error('Exception:', err.message));

start().catch(err => { logger.error('فشل التشغيل:', err); process.exit(1); });

// ==================== ADVANCED ANALYSIS COMMANDS ====================

bot.onText(/\/smartmoney(?:\s+(\S+))?/, async (msg, match) => {
  await handle(msg, async () => {
    const symbol = match?.[1]?.toUpperCase();
    if (!symbol) { await bot.sendMessage(msg.chat.id, '🐆 مثال: /smartmoney BTC'); return; }
    const loadMsg = await bot.sendMessage(msg.chat.id, `🐆 الفهد يحلل Smart Money لـ ${symbol}...`);
    const [coins, mtf, onChain] = await Promise.allSettled([
      getTopCoins(), getMTFAnalysis(symbol + '/USDT', 'daily'), getFullOnChainData(symbol)
    ]);
    const coinData = (coins.value||[]).find(c => c.symbol === symbol) || { symbol };
    const analysis = await analyzeSmartMoney(symbol, {
      ...coinData,
      mtf: mtf.value || {},
      onChain: onChain.value || {}
    });
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id,
      `🐆 الفهد — Smart Money Concepts\n${DIVIDER}\n🪙 ${symbol}\n\n${safe(analysis, 1500)}\n\n${DIVIDER}\n⚠️ تحليل الفهد — ليس نصيحة مالية`
    );
  });
});

bot.onText(/\/forecast(?:\s+(\S+))?/, async (msg, match) => {
  await handle(msg, async () => {
    const symbol = match?.[1]?.toUpperCase();
    if (!symbol) { await bot.sendMessage(msg.chat.id, '🐆 مثال: /forecast BTC'); return; }
    const loadMsg = await bot.sendMessage(msg.chat.id, `🐆 الفهد يبني نموذج التوقع لـ ${symbol}...`);
    const [coins, bt, mtf] = await Promise.allSettled([
      getTopCoins(), runBacktest(symbol + '/USDT', 'long', 70), getMTFAnalysis(symbol + '/USDT', 'daily')
    ]);
    const coinData = (coins.value||[]).find(c => c.symbol === symbol) || { symbol };
    const forecast = await generateAIForecast(symbol, { ...coinData, mtf: mtf.value || {} }, bt.value);
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id,
      `🐆 الفهد — AI Forecast\n${DIVIDER}\n🪙 ${symbol}\n\n${safe(forecast, 1500)}\n\n${DIVIDER}\n⚠️ نموذج احتمالي — ليس ضماناً`
    );
  });
});

bot.onText(/\/macro/, async (msg) => {
  await handle(msg, async () => {
    const loadMsg = await bot.sendMessage(msg.chat.id, '🐆 الفهد يحلل العوامل الكلية...');
    const onChain = await getFullOnChainData('BTC').catch(() => null);
    const analysis = await analyzeMacroCorrelation(onChain);
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id,
      `🐆 الفهد — تحليل كلي\n${DIVIDER}\n🏦 BTC + الفيدرالي + السيولة العالمية\n\n${safe(analysis, 1500)}\n\n${DIVIDER}\n⚠️ تحليل الفهد — ليس نصيحة مالية`
    );
  });
});

bot.onText(/\/quant(?:\s+(\S+))?/, async (msg, match) => {
  await handle(msg, async () => {
    const symbol = match?.[1]?.toUpperCase();
    if (!symbol) { await bot.sendMessage(msg.chat.id, '🐆 مثال: /quant BTC'); return; }
    const loadMsg = await bot.sendMessage(msg.chat.id, `🐆 الفهد يجري تحليل كمي لـ ${symbol}...`);
    const [bt, mtf] = await Promise.allSettled([
      runBacktest(symbol + '/USDT', 'long', 70), getMTFAnalysis(symbol + '/USDT', 'daily')
    ]);
    const analysis = await generateQuantAnalysis(symbol, bt.value, mtf.value || {});
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id,
      `🐆 الفهد — Quant Analysis\n${DIVIDER}\n📊 ${symbol}\n\n${safe(analysis, 1500)}\n\n${DIVIDER}\n⚠️ تحليل الفهد — ليس نصيحة مالية`
    );
  });
});

bot.onText(/\/plan(?:\s+(\S+))?/, async (msg, match) => {
  await handle(msg, async () => {
    const symbol = match?.[1]?.toUpperCase();
    if (!symbol) { await bot.sendMessage(msg.chat.id, '🐆 مثال: /plan BTC'); return; }
    const loadMsg = await bot.sendMessage(msg.chat.id, `🐆 الفهد يضع خطة تداول لـ ${symbol}...`);
    const user = await User.findOne({ telegramId: msg.chat.id.toString() });
    const portfolio = user?.portfolio?.balance || 10000;
    const [coins, bt, mtf, onChain] = await Promise.allSettled([
      getTopCoins(), runBacktest(symbol + '/USDT', 'long', 70),
      getMTFAnalysis(symbol + '/USDT', 'daily'), getFullOnChainData(symbol)
    ]);
    const coinData = (coins.value||[]).find(c => c.symbol === symbol) || { symbol };
    const deepResult = await deepAnalysis(symbol, {
      ...coinData, mtf: mtf.value || {}, onChain: onChain.value || {}, backtest: bt.value || {}
    }, 'daily');
    const plan = await generateTradingPlan(symbol, deepResult, portfolio);
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id,
      `🐆 الفهد — خطة تداول احترافية\n${DIVIDER}\n🪙 ${symbol} | محفظة: $${portfolio.toFixed(0)}\n\n${safe(plan, 1800)}\n\n${DIVIDER}\n⚠️ تحليل الفهد — ليس نصيحة مالية`
    );
  });
});

// /monthly - مخطط تداول شهري
bot.onText(/\/monthly/, async (msg) => {
  await handle(msg, async () => {
    const loadMsg = await bot.sendMessage(msg.chat.id, '🐆 الفهد يضع المخطط الشهري...');
    const user = await User.findOne({ telegramId: msg.chat.id.toString() });
    const portfolio = user?.portfolio?.balance || 10000;
    const [scan, benchmarks] = await Promise.allSettled([
      scanMarket('monthly'), getPerformanceBenchmarks()
    ]);
    const scanData = scan.value || { opportunities: [], onChain: null };
    const bench = benchmarks.value || null;
    const plan = await generateMonthlyPlan(
      scanData.opportunities, scanData.onChain, bench, portfolio
    );
    await bot.deleteMessage(msg.chat.id, loadMsg.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id,
      `🐆 الفهد — المخطط الشهري\n${DIVIDER}\n📅 ${new Date().toLocaleDateString('ar-SA', {month:'long', year:'numeric'})}\n💼 المحفظة: $${portfolio.toFixed(0)}\n\n${safe(plan, 2000)}\n\n${DIVIDER}\n⚠️ تحليل الفهد — ليس نصيحة مالية`
    );
  });
});

// /history - حالة قاعدة البيانات التاريخية
bot.onText(/\/history/, async (msg) => {
  await handle(msg, async () => {
    const stats = await getPriceHistoryStats();
    if (!stats) {
      await bot.sendMessage(msg.chat.id,
        `🐆 الفهد — قاعدة البيانات التاريخية\n${DIVIDER}\n⏳ لا توجد بيانات بعد\n\nسيبدأ الفهد بجمع البيانات تلقائياً كل يوم الساعة 00:05 UTC\n\nبعد 14 يوم ستتوفر بيانات كافية للـ Backtest الحقيقي`
      );
      return;
    }
    const daysNeeded = Math.max(0, 14 - (stats.totalDays || 0));
    const progress = Math.min(100, Math.round((stats.totalDays / 14) * 100));
    const progressBar = '█'.repeat(Math.round(progress/10)) + '░'.repeat(10 - Math.round(progress/10));
    await bot.sendMessage(msg.chat.id,
      `🐆 الفهد — قاعدة البيانات التاريخية\n${DIVIDER}\n` +
      `📊 العملات المُتتبعة: ${stats.totalSymbols}\n` +
      `📅 أيام البيانات: ${stats.totalDays}\n` +
      `📝 إجمالي السجلات: ${stats.totalRecords?.toLocaleString()}\n` +
      `🗓️ التغطية: ${stats.coverage}\n\n` +
      `التقدم نحو Backtest موثوق:\n` +
      `[${progressBar}] ${progress}%\n` +
      `${daysNeeded > 0 ? '⏳ متبقي ' + daysNeeded + ' يوم للـ Backtest الكامل' : '✅ Backtest جاهز!'}\n\n` +
      `${DIVIDER}\n⏰ الحفظ التلقائي: كل يوم 00:05 UTC`
    );
  });
});

// ==================== ADMIN PANEL ====================
// /admin_panel - لوحة التحكم الرئيسية
bot.onText(/\/admin_panel/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ isActive: true, isBanned: false });
  const bannedUsers = await User.countDocuments({ isBanned: true });
  const openTrades = await Trade.countDocuments({ status: { $in: ['open', 'pending_entry'] } });
  const closedToday = await Trade.countDocuments({
    status: 'closed',
    closedAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
  });
  const totalPnL = await Trade.aggregate([
    { $match: { status: 'closed' } },
    { $group: { _id: null, total: { $sum: '$pnl' } } }
  ]);

  let panelMsg = `الفهد v2 — لوحة تحكم المدير\n\n`;
  panelMsg += `المستخدمون:\n`;
  panelMsg += `اجمالي: ${totalUsers} | نشطون: ${activeUsers} | محظورون: ${bannedUsers}\n\n`;
  panelMsg += `الصفقات:\n`;
  panelMsg += `مفتوحة: ${openTrades} | مغلقة اليوم: ${closedToday}\n`;
  panelMsg += `PnL اجمالي النظام: $${(totalPnL[0]?.total || 0).toFixed(2)}\n\n`;
  panelMsg += `الاوامر:\n`;
  panelMsg += `/admin_users — قائمة المستخدمين\n`;
  panelMsg += `/admin_trades — الصفقات المفتوحة\n`;
  panelMsg += `/admin_broadcast نص — رسالة للجميع\n`;
  panelMsg += `/admin_ban ID — حظر\n`;
  panelMsg += `/admin_unban ID — رفع حظر\n`;
  panelMsg += `/admin_toggle_all — إيقاف كل التداول\n`;
  panelMsg += `/admin_report — تقرير شهري`;

  await bot.sendMessage(msg.chat.id, panelMsg);
});

// /admin_users
bot.onText(/\/admin_users/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const users = await User.find({ isBanned: false, isActive: true }).sort({ createdAt: -1 }).limit(20);
  let txt = `الفهد — المستخدمون النشطون (${users.length}):\n\n`;
  for (const u of users) {
    const openCount = await Trade.countDocuments({ userId: u.telegramId, status: { $in: ['open', 'pending_entry'] } });
    txt += `${u.firstName || u.username || u.telegramId}\n`;
    txt += `  رصيد: $${u.portfolio.balance.toFixed(2)} | صفقات مفتوحة: ${openCount}\n`;
    txt += `  يومي: ${u.settings.autoTradeDaily ? 'فعال' : 'موقف'} | شهري: ${u.settings.autoTradeMonthly ? 'فعال' : 'موقف'}\n\n`;
  }
  await bot.sendMessage(msg.chat.id, txt);
});

// /admin_trades
bot.onText(/\/admin_trades/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const trades = await Trade.find({ status: { $in: ['open', 'pending_entry'] } }).sort({ openedAt: -1 });
  if (!trades.length) { await bot.sendMessage(msg.chat.id, 'لا توجد صفقات مفتوحة'); return; }
  let txt = `الفهد — الصفقات المفتوحة (${trades.length}):\n\n`;
  trades.forEach((t, i) => {
    txt += `${i+1}. ${t.symbol} ${t.direction} | ثقة: ${t.confidence}%\n`;
    txt += `   دخول: $${t.entryPrice.toFixed(4)} | المستخدم: ${t.userId}\n\n`;
  });
  await bot.sendMessage(msg.chat.id, txt);
});

// /admin_broadcast
bot.onText(/\/admin_broadcast\s+(.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const text = match[1];
  const users = await User.find({ isActive: true, isBanned: false });
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await bot.sendMessage(u.telegramId, `الفهد — رسالة من الادارة\n\n${text}`);
      sent++;
    } catch { failed++; }
  }
  await bot.sendMessage(msg.chat.id, `تم الارسال: ${sent} | فشل: ${failed}`);
});

// /admin_toggle_all - إيقاف التداول الآلي للجميع
bot.onText(/\/admin_toggle_all/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  await User.updateMany({}, { $set: { 'settings.autoTradeDaily': false, 'settings.autoTradeMonthly': false } });
  await bot.sendMessage(msg.chat.id, 'تم إيقاف التداول الآلي لجميع المستخدمين');
  logger.warn('🛑 المدير: إيقاف كل التداول الآلي');
});

// /admin_report - تقرير شهري للمدير
bot.onText(/\/admin_report/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const monthTrades = await Trade.find({ status: 'closed', closedAt: { $gte: monthAgo } });
  const newUsers = await User.countDocuments({ createdAt: { $gte: monthAgo } });
  const monthPnL = monthTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = monthTrades.filter(t => t.pnl > 0).length;
  const totalUsers = await User.countDocuments({ isActive: true, isBanned: false });
  const avgRating = await Trade.aggregate([
    { $match: { rating: { $exists: true } } },
    { $group: { _id: null, avg: { $avg: '$rating' } } }
  ]);

  let txt = `الفهد v2 — التقرير الشهري\n\n`;
  txt += `المستخدمون: ${totalUsers} (جدد: ${newUsers})\n`;
  txt += `الصفقات: ${monthTrades.length} (فوز: ${wins} | خسارة: ${monthTrades.length - wins})\n`;
  txt += `PnL الشهري: $${monthPnL.toFixed(2)}\n`;
  txt += `معدل الفوز: ${monthTrades.length > 0 ? (wins/monthTrades.length*100).toFixed(1) : 0}%\n`;
  txt += `متوسط التقييم: ${avgRating[0]?.avg?.toFixed(1) || 'N/A'}/5\n`;
  await bot.sendMessage(msg.chat.id, txt);
});

// /admin_unban
bot.onText(/\/admin_unban\s+(\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  await unbanUser(match[1]);
  await bot.sendMessage(msg.chat.id, `تم رفع الحظر عن ${match[1]}`);
});

// /admin_msg - رسالة لمستخدم محدد
bot.onText(/\/admin_msg\s+(\d+)\s+(.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  try {
    await bot.sendMessage(match[1], `الفهد — رسالة خاصة:\n\n${match[2]}`);
    await bot.sendMessage(msg.chat.id, `تم الارسال لـ ${match[1]}`);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `فشل الارسال: ${e.message}`);
  }
});
