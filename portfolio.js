/**
 * portfolio.js — إدارة المحفظة 🐆 الفهد v2
 * يشمل: Trailing Stop، حماية رأس المال، إلغاء الأوامر المعلقة
 */
const crypto = require('crypto');
const { User, Trade, Lesson } = require('./database');
const { getVerifiedPrice } = require('./market');
const { analyzeLesson } = require('./agent');
const logger = { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a), debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a) };

// ==================== OPEN TRADE ====================
async function openTrade(userId, tradeData) {
  const user = await User.findOne({ telegramId: userId });
  if (!user) throw new Error('المستخدم غير موجود');

  const { symbol, direction, confidence, type, analysis, mtfAlignment, backtestSummary, onChainSnapshot } = tradeData;

  // فحص حدود الصفقات
  const openTrades = await Trade.find({ userId, status: { $in: ['pending_entry', 'open'] }, type });
  const maxTrades = type === 'daily' ? 2 : 3;
  if (openTrades.length >= maxTrades) throw new Error(`الحد الأقصى للصفقات ${type === 'daily' ? 'اليومية' : 'الشهرية'} (${maxTrades}) مكتمل`);

  if (type === 'daily' && openTrades.find(t => t.symbol === symbol)) {
    throw new Error(`يوجد مركز مفتوح على ${symbol}`);
  }

  // حماية رأس المال
  const capCheck = await checkCapitalProtection(userId, user);
  if (capCheck.blocked) throw new Error(`حماية رأس المال: ${capCheck.reason}`);

  const sizePercent = type === 'daily' ? user.settings.dailyRiskPercent : user.settings.monthlyRiskPercent;
  const sizeUSDT = (user.portfolio.balance * sizePercent) / 100;

  const priceData = await getVerifiedPrice(symbol);
  const entryPrice = priceData.price;
  const quantity = sizeUSDT / entryPrice;

  const stopLossPercent = user.settings.dailyStopLoss || 3;
  const targetPercent = type === 'daily' ? 12 : 25;

  const targetPrice = direction === 'long' ? entryPrice * (1 + targetPercent / 100) : entryPrice * (1 - targetPercent / 100);
  const stopLoss = direction === 'long' ? entryPrice * (1 - stopLossPercent / 100) : entryPrice * (1 + stopLossPercent / 100);

  const maxDays = type === 'daily' ? user.settings.dailyMaxDays || 11 : 30;
  const expiresAt = new Date(Date.now() + maxDays * 24 * 3600 * 1000);
  const entryDeadline = new Date(Date.now() + (type === 'daily' ? 24 : 48) * 3600 * 1000);

  // الأوامر المعلقة
  const pendingOrders = [
    { orderId: crypto.randomUUID(), type: 'entry', price: entryPrice, percent: 100, status: 'pending', expiryHours: type === 'daily' ? 24 : 48 },
    { orderId: crypto.randomUUID(), type: 'sl', price: stopLoss, percent: 100, status: 'pending' },
    { orderId: crypto.randomUUID(), type: 'tp', price: targetPrice, percent: 100, status: 'pending' }
  ];

  // دخول/خروج جزئي للشهري
  let partialEntries = [], partialExits = [];
  if (type === 'monthly') {
    partialEntries = [
      { percent: 40, price: entryPrice, executed: true, executedAt: new Date(), expiryHours: 48 },
      { percent: 30, price: direction === 'long' ? entryPrice * 0.97 : entryPrice * 1.03, executed: false, expiryHours: 72 },
      { percent: 30, price: direction === 'long' ? entryPrice * 0.94 : entryPrice * 1.06, executed: false, expiryHours: 72 }
    ];
    partialExits = [
      { percent: 40, price: direction === 'long' ? entryPrice * 1.12 : entryPrice * 0.88, executed: false },
      { percent: 50, price: direction === 'long' ? entryPrice * 1.20 : entryPrice * 0.80, executed: false },
      { percent: 10, price: targetPrice, executed: false }
    ];
  }

  const trade = new Trade({
    userId, tradeId: crypto.randomUUID(), type, symbol, direction,
    market: 'spot', entryPrice, targetPrice, stopLoss,
    currentStopLoss: stopLoss, highestPrice: entryPrice,
    sizePercent, sizeUSDT, quantity,
    pendingOrders, partialEntries, partialExits,
    confidence, analysisSnapshot: analysis?.summary || '',
    backtestSummary: backtestSummary || '',
    onChainSnapshot: onChainSnapshot || '',
    mtfAlignment: mtfAlignment || 0,
    status: 'open', openedAt: new Date(),
    entryDeadline, expiresAt
  });

  await trade.save();
  await updatePeakBalance(userId, user.portfolio.balance);
  await User.updateOne({ telegramId: userId }, {
    $inc: { 'portfolio.balance': -sizeUSDT, 'stats.totalTrades': 1 },
    $set: { 'portfolio.lastUpdated': new Date() }
  });

  logger.info(`🐆 الفهد v2: صفقة Spot — ${symbol} ${direction} @ $${entryPrice}`);
  return trade;
}

// ==================== CLOSE TRADE ====================
async function closeTrade(userId, tradeId, reason = 'manual') {
  const trade = await Trade.findOne({ userId, tradeId, status: { $in: ['open', 'pending_entry'] } });
  if (!trade) throw new Error('الصفقة غير موجودة');

  const priceData = await getVerifiedPrice(trade.symbol);
  const exitPrice = priceData.price;

  let pnl, pnlPercent;
  if (trade.direction === 'long') {
    pnl = (exitPrice - trade.entryPrice) * trade.quantity;
    pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  } else {
    pnl = (trade.entryPrice - exitPrice) * trade.quantity;
    pnlPercent = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
  }

  await Trade.updateOne({ tradeId }, {
    $set: { status: 'closed', exitPrice, pnl, pnlPercent, closeReason: reason, closedAt: new Date() }
  });

  const returnAmount = trade.sizeUSDT + pnl;
  const outcome = pnl >= 0 ? 'win' : 'loss';

  const statsUpdate = {
    $inc: { 'portfolio.balance': returnAmount, 'stats.totalPnL': pnl, 'stats.monthlyPnL': pnl },
    $set: { 'portfolio.lastUpdated': new Date() }
  };

  if (outcome === 'win') {
    statsUpdate.$inc['stats.winningTrades'] = 1;
    statsUpdate.$set['stats.consecutiveLosses'] = 0;
    if (pnl > 0) statsUpdate.$set['stats.bestTrade'] = Math.max(pnl, (await User.findOne({ telegramId: userId }))?.stats?.bestTrade || 0);
  } else {
    statsUpdate.$inc['stats.losingTrades'] = 1;
    statsUpdate.$inc['stats.consecutiveLosses'] = 1;
  }

  await User.updateOne({ telegramId: userId }, statsUpdate);

  const updatedUser = await User.findOne({ telegramId: userId });
  await updatePeakBalance(userId, updatedUser.portfolio.balance);

  // تعلم ذاتي
  try {
    const lesson = await analyzeLesson({ ...trade.toObject(), exitPrice, pnl, pnlPercent, closeReason: reason }, outcome);
    await Trade.updateOne({ tradeId }, { $set: { lessonLearned: lesson.lesson || '' } });
    await saveLessonToDB(userId, trade.tradeId, trade.symbol, outcome, lesson);
    await checkSelfLearning(userId);
  } catch (e) { logger.warn('🐆 درس فشل:', e.message); }

  logger.info(`🐆 الفهد v2: إغلاق ${trade.symbol} PnL=$${(pnl || 0).toFixed(2)} (${(pnlPercent || 0).toFixed(2)}%)`);
  return { trade: { ...trade.toObject(), exitPrice, pnl, pnlPercent, closeReason: reason }, outcome };
}

// ==================== TRAILING STOP ====================
async function updateTrailingStop(trade, currentPrice) {
  if (trade.direction !== 'long') return null;
  const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
  if (pnlPercent < 5) return null;

  const profit = currentPrice - trade.entryPrice;
  const newStop = trade.entryPrice + (profit * 0.5);

  if (newStop > (trade.currentStopLoss || trade.stopLoss)) {
    await Trade.updateOne(
      { tradeId: trade.tradeId },
      { $set: { currentStopLoss: newStop, highestPrice: Math.max(currentPrice, trade.highestPrice || currentPrice) } }
    );
    logger.info(`🐆 Trailing Stop: ${trade.symbol} → $${(newStop || 0).toFixed(6)}`);
    return newStop;
  }
  return null;
}

// ==================== MONITOR ====================
async function monitorOpenTrades(bot = null) {
  const trades = await Trade.find({ status: { $in: ['open', 'pending_entry'] } });
  if (!trades.length) return;
  logger.info(`🐆 مراقبة ${trades.length} صفقة`);

  for (const trade of trades) {
    try {
      const now = new Date();

      // تحقق من انتهاء صلاحية الأمر المعلق
      if (trade.status === 'open' && trade.entryDeadline && now > trade.entryDeadline) {
        const result = await cancelExpiredOrder(trade, bot);
        if (result) continue;
      }

      // تحقق من انتهاء المدة
      if (trade.expiresAt && now > trade.expiresAt) {
        const { trade: closedTrade } = await closeTrade(trade.userId, trade.tradeId, 'timeout');
        if (bot) await notifyTradeClose(bot, trade.userId, closedTrade, 'timeout');
        continue;
      }

      const { price } = await getVerifiedPrice(trade.symbol);

      // تحديث Trailing Stop
      const newStop = await updateTrailingStop(trade, price);
      if (newStop && bot) {
        await bot.sendMessage(trade.userId,
          `📈 الفهد — تحديث Trailing Stop\n${trade.symbol}\nوقف جديد: $${(newStop || 0).toFixed(6)} (50% من المكسب محمي)`
        );
      }

      // فحص الهدف والوقف
      const currentStop = trade.currentStopLoss || trade.stopLoss;
      let shouldClose = false, closeReason = '';

      if (trade.direction === 'long') {
        if (price >= trade.targetPrice) { shouldClose = true; closeReason = 'target'; }
        if (price <= currentStop) { shouldClose = true; closeReason = price <= trade.stopLoss ? 'stop_loss' : 'trailing_stop'; }
      } else {
        if (price <= trade.targetPrice) { shouldClose = true; closeReason = 'target'; }
        if (price >= currentStop) { shouldClose = true; closeReason = 'stop_loss'; }
      }

      if (shouldClose) {
        const { trade: ct } = await closeTrade(trade.userId, trade.tradeId, closeReason);
        if (bot) await notifyTradeClose(bot, trade.userId, ct, closeReason);
      }

    } catch (error) {
      logger.warn(`🐆 خطأ مراقبة ${trade.symbol}: ${error.message}`);
    }
  }
}

// ==================== CANCEL EXPIRED ORDERS ====================
async function cancelExpiredOrder(trade, bot = null) {
  try {
    const lesson = await analyzeLesson(trade.toObject(), 'cancelled', 'انتهت صلاحية أمر الدخول — السعر ابتعد');
    await Trade.updateOne({ tradeId: trade.tradeId }, {
      $set: { status: 'cancelled', closeReason: 'entry_expired', closedAt: new Date(), lessonLearned: lesson.lesson || '' }
    });
    await User.updateOne({ telegramId: trade.userId }, {
      $inc: { 'portfolio.balance': trade.sizeUSDT, 'stats.cancelledOrders': 1 }
    });
    await saveLessonToDB(trade.userId, trade.tradeId, trade.symbol, 'cancelled', lesson);

    if (bot) {
      const msg = `⏰ الفهد — أمر منتهي الصلاحية\n\n${trade.symbol}\nانتهت مهلة الدخول — السعر ابتعد عن نقطة الدخول\nتم إلغاء الصفقة وإعادة الرصيد\n\nالدرس: ${lesson.lesson || 'N/A'}`;
      await bot.sendMessage(trade.userId, msg);
    }
    logger.info(`🐆 إلغاء منتهي: ${trade.symbol}`);
    return true;
  } catch (e) {
    logger.error(`🐆 خطأ في إلغاء ${trade.symbol}: ${e.message}`);
    return false;
  }
}

// ==================== CAPITAL PROTECTION ====================
async function checkCapitalProtection(userId, user) {
  const peak = user.portfolio.peakBalance || user.portfolio.initialBalance;
  const current = user.portfolio.balance;
  const openTrades = await Trade.find({ userId, status: { $in: ['open', 'pending_entry'] } });
  let openValue = 0;
  for (const t of openTrades) {
    try {
      const { price } = await getVerifiedPrice(t.symbol);
      const pnl = t.direction === 'long' ? (price - t.entryPrice) * t.quantity : (t.entryPrice - price) * t.quantity;
      openValue += t.sizeUSDT + pnl;
    } catch { openValue += t.sizeUSDT; }
  }
  const totalValue = current + openValue;
  const drawdown = ((peak - totalValue) / peak) * 100;
  if (drawdown >= 20) {
    await User.updateOne({ telegramId: userId }, {
      $set: { 'settings.autoTradeDaily': false, 'settings.autoTradeMonthly': false }
    });
    logger.warn(`🛡️ حماية رأس المال: ${userId} — انخفاض ${(drawdown || 0).toFixed(1)}%`);
    return { blocked: true, reason: `انخفاض ${(drawdown || 0).toFixed(1)}% من الذروة — تم إيقاف التداول الآلي`, drawdown };
  }
  return { blocked: false, drawdown };
}

async function updatePeakBalance(userId, balance) {
  const user = await User.findOne({ telegramId: userId });
  if (user && balance > (user.portfolio.peakBalance || 0)) {
    await User.updateOne({ telegramId: userId }, { $set: { 'portfolio.peakBalance': balance } });
  }
}

// ==================== SELF LEARNING ====================
async function checkSelfLearning(userId) {
  const user = await User.findOne({ telegramId: userId });
  if (!user) return;
  const { consecutiveLosses } = user.stats;
  const lossThreshold = user.portfolio.initialBalance * 0.1;
  const totalLoss = user.stats.totalLossFromPeak || 0;
  let triggered = false;

  if (consecutiveLosses >= 3) {
    await User.updateOne({ telegramId: userId }, {
      $set: {
        'settings.confidenceThreshold': Math.min(user.settings.confidenceThreshold + 5, 90),
        'settings.dailyRiskPercent': parseFloat((user.settings.dailyRiskPercent * 0.8).toFixed(1)),
        'stats.consecutiveLosses': 0
      }
    });
    logger.info(`🧠 تعلم ذاتي: ${userId} — رفع الثقة + تقليل الحجم`);
    triggered = true;
  }
  if (totalLoss >= lossThreshold) {
    await User.updateOne({ telegramId: userId }, {
      $set: { 'settings.autoTradeDaily': false, 'settings.autoTradeMonthly': false, 'stats.totalLossFromPeak': 0 }
    });
    logger.warn(`🛑 تعلم ذاتي: ${userId} — إيقاف التداول الآلي`);
    triggered = true;
  }
  return triggered;
}

async function saveLessonToDB(userId, tradeId, symbol, outcome, lesson) {
  try {
    const { Lesson } = require('./database');
    await new Lesson({
      userId, tradeId, symbol, outcome,
      lesson: lesson.lesson || '',
      strategyAdjustment: lesson.strategyAdjustment || ''
    }).save();
  } catch (e) { logger.debug('حفظ درس فشل:', e.message); }
}

// ==================== PORTFOLIO STATS ====================
async function getPortfolioSnapshot(userId) {
  const user = await User.findOne({ telegramId: userId });
  if (!user) throw new Error('المستخدم غير موجود');
  const openTrades = await Trade.find({ userId, status: { $in: ['open', 'pending_entry'] } });
  let openPnL = 0;
  const tradesWithPnL = [];
  for (const t of openTrades) {
    try {
      const { price } = await getVerifiedPrice(t.symbol);
      const pnl = t.direction === 'long' ? (price - t.entryPrice) * t.quantity : (t.entryPrice - price) * t.quantity;
      const pnlPercent = t.direction === 'long' ? ((price - t.entryPrice) / t.entryPrice) * 100 : ((t.entryPrice - price) / t.entryPrice) * 100;
      openPnL += pnl;
      tradesWithPnL.push({ ...t.toObject(), currentPrice: price, currentPnL: pnl, currentPnLPercent: pnlPercent });
    } catch { tradesWithPnL.push(t.toObject()); }
  }
  const totalValue = user.portfolio.balance + openPnL;
  const peak = user.portfolio.peakBalance || user.portfolio.initialBalance;
  const drawdown = ((peak - totalValue) / peak * 100).toFixed(1);
  const capitalUsed = openTrades.reduce((s, t) => s + t.sizeUSDT, 0);
  const capitalUsedPercent = ((capitalUsed / user.portfolio.balance) * 100).toFixed(1);
  return {
    balance: user.portfolio.balance,
    initialBalance: user.portfolio.initialBalance,
    peakBalance: peak,
    openPnL, totalValue, drawdown,
    capitalUsed, capitalUsedPercent,
    openTrades: tradesWithPnL,
    settings: user.settings
  };
}

async function getPerformanceStats(userId) {
  const user = await User.findOne({ telegramId: userId });
  if (!user) throw new Error('المستخدم غير موجود');
  const closedTrades = await Trade.find({ userId, status: 'closed' }).sort({ closedAt: -1 });
  const totalReturn = ((user.portfolio.balance - user.portfolio.initialBalance) / user.portfolio.initialBalance * 100);
  const winRate = user.stats.totalTrades > 0 ? (user.stats.winningTrades / user.stats.totalTrades * 100).toFixed(1) : 0;
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const monthlyTrades = closedTrades.filter(t => t.closedAt > monthAgo);
  const monthlyPnL = monthlyTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const prevMonthTrades = closedTrades.filter(t => t.closedAt > new Date(monthAgo - 30 * 24 * 3600 * 1000) && t.closedAt <= monthAgo);
  const prevMonthPnL = prevMonthTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  return {
    totalTrades: user.stats.totalTrades,
    winningTrades: user.stats.winningTrades,
    losingTrades: user.stats.losingTrades,
    cancelledOrders: user.stats.cancelledOrders || 0,
    winRate, totalPnL: user.stats.totalPnL,
    totalReturn, monthlyPnL, prevMonthPnL,
    consecutiveLosses: user.stats.consecutiveLosses,
    bestTrade: user.stats.bestTrade || 0,
    recentTrades: closedTrades.slice(0, 10),
    confidenceThreshold: user.settings.confidenceThreshold,
    autoTradeDaily: user.settings.autoTradeDaily,
    autoTradeMonthly: user.settings.autoTradeMonthly
  };
}

async function notifyTradeClose(bot, userId, trade, reason) {
  const icons = { target: '🎯', stop_loss: '🛑', trailing_stop: '📉', timeout: '⏰', manual: '✋', capital_protection: '🛡️' };
  const icon = icons[reason] || '🔒';
  const pnlSign = trade.pnl >= 0 ? '+' : '';
  const msg = `${icon} الفهد — إغلاق تلقائي\n\n${trade.symbol}\nالخروج: $${trade.exitPrice?.toFixed(6)}\nPnL: ${pnlSign}$${trade.pnl?.toFixed(2)} (${pnlSign}${trade.pnlPercent?.toFixed(2)}%)\nالسبب: ${reason}\n${trade.lessonLearned ? '\nالدرس: ' + trade.lessonLearned : ''}`;
  try { await bot.sendMessage(userId, msg); } catch (e) {}
}

async function addFunds(userId, amount) {
  if (amount <= 0 || amount > 1000000) throw new Error('مبلغ غير صالح');
  await User.updateOne({ telegramId: userId }, {
    $inc: { 'portfolio.balance': amount, 'portfolio.initialBalance': amount },
    $set: { 'portfolio.lastUpdated': new Date() }
  });
  const user = await User.findOne({ telegramId: userId });
  await updatePeakBalance(userId, user.portfolio.balance);
  return user.portfolio.balance;
}

module.exports = {
  openTrade, closeTrade, monitorOpenTrades,
  cancelExpiredOrder, updateTrailingStop,
  getPortfolioSnapshot, getPerformanceStats,
  checkCapitalProtection, checkSelfLearning,
  addFunds, notifyTradeClose
};
