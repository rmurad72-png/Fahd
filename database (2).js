/**
 * database.js — قاعدة البيانات الفهد v2
 */
const mongoose = require('mongoose');
const logger = { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a), debug: (...a) => console.log('[DEBUG]', ...a) };

const UserSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true, index: true },
  username: String, firstName: String,
  isActive: { type: Boolean, default: true },
  isAdmin: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  banReason: String,
  joinedAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now },
  portfolio: {
    balance: { type: Number, default: 10000 },
    initialBalance: { type: Number, default: 10000 },
    peakBalance: { type: Number, default: 10000 },
    currency: { type: String, default: 'USDT' },
    lastUpdated: { type: Date, default: Date.now }
  },
  settings: {
    autoTradeDaily: { type: Boolean, default: false },
    autoTradeMonthly: { type: Boolean, default: false },
    dailyRiskPercent: { type: Number, default: 3 },
    monthlyRiskPercent: { type: Number, default: 15 },
    confidenceThreshold: { type: Number, default: 65 },
    dailyStopLoss: { type: Number, default: 3 },
    trailingStopPercent: { type: Number, default: 50 },
    dailyMaxDays: { type: Number, default: 11 },
    alertsEnabled: { type: Boolean, default: true }
  },
  stats: {
    totalTrades: { type: Number, default: 0 },
    winningTrades: { type: Number, default: 0 },
    losingTrades: { type: Number, default: 0 },
    cancelledOrders: { type: Number, default: 0 },
    totalPnL: { type: Number, default: 0 },
    bestTrade: { type: Number, default: 0 },
    consecutiveLosses: { type: Number, default: 0 },
    totalLossFromPeak: { type: Number, default: 0 },
    monthlyPnL: { type: Number, default: 0 }
  },
  security: {
    requestCount: { type: Number, default: 0 },
    suspiciousCount: { type: Number, default: 0 },
    lastRequestTime: Date
  }
}, { timestamps: true });

const TradeSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  tradeId: { type: String, required: true, unique: true },
  type: { type: String, enum: ['daily', 'monthly', 'manual'], required: true },
  symbol: { type: String, required: true },
  direction: { type: String, enum: ['long', 'short'], required: true },
  market: { type: String, default: 'spot' },
  entryPrice: { type: Number, required: true },
  targetPrice: { type: Number, required: true },
  stopLoss: { type: Number, required: true },
  currentStopLoss: Number,
  highestPrice: Number,
  exitPrice: Number,
  sizePercent: { type: Number, required: true },
  sizeUSDT: { type: Number, required: true },
  quantity: { type: Number, required: true },
  pendingOrders: [{
    orderId: String,
    type: { type: String, enum: ['entry', 'tp', 'sl'] },
    price: Number, percent: Number,
    status: { type: String, enum: ['pending', 'executed', 'cancelled', 'expired'], default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    executedAt: Date, expiredAt: Date, expiryHours: Number
  }],
  partialEntries: [{
    percent: Number, price: Number,
    executed: { type: Boolean, default: false },
    executedAt: Date,
    expiryHours: { type: Number, default: 48 },
    expired: { type: Boolean, default: false }
  }],
  partialExits: [{
    percent: Number, price: Number,
    executed: { type: Boolean, default: false },
    executedAt: Date
  }],
  status: { type: String, enum: ['pending_entry', 'open', 'closed', 'cancelled'], default: 'pending_entry' },
  closeReason: { type: String, enum: ['target', 'stop_loss', 'trailing_stop', 'timeout', 'manual', 'entry_expired', 'capital_protection'] },
  pnl: Number, pnlPercent: Number,
  confidence: { type: Number, required: true },
  analysisSnapshot: String, backtestSummary: String,
  onChainSnapshot: String, mtfAlignment: Number,
  openedAt: { type: Date, default: Date.now },
  entryDeadline: Date, closedAt: Date, expiresAt: Date,
  lessonLearned: String,
  rating: { type: Number, min: 1, max: 5 }
}, { timestamps: true });

const AlertSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  symbol: { type: String, required: true },
  targetPrice: { type: Number, required: true },
  direction: { type: String, enum: ['above', 'below'], required: true },
  isActive: { type: Boolean, default: true },
  triggeredAt: Date,
  createdAt: { type: Date, default: Date.now }
});

const LessonSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  tradeId: String,
  type: { type: String, enum: ['trade', 'cancelled_order', 'feedback', 'chat'], default: 'trade' },
  symbol: String,
  outcome: { type: String, enum: ['win', 'loss', 'cancelled', 'expired'] },
  lesson: { type: String, required: true },
  strategyAdjustment: String,
  appliedAt: { type: Date, default: Date.now }
});

const FeedbackSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  type: { type: String, enum: ['trade_feedback', 'free_chat'], required: true },
  trade: {
    symbol: String, direction: String,
    entryPrice: Number, exitPrice: Number,
    targetHit: Boolean, fahdRecommendation: String,
    userAction: String, outcome: String, pnlPercent: Number
  },
  userNote: { type: String, required: true },
  fahdResponse: String, fahdLesson: String, fahdAdjustment: String,
  createdAt: { type: Date, default: Date.now }
});

const MarketCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  data: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
});

const User = mongoose.model('User', UserSchema);
const Trade = mongoose.model('Trade', TradeSchema);
const Alert = mongoose.model('Alert', AlertSchema);
const Lesson = mongoose.model('Lesson', LessonSchema);
const Feedback = mongoose.model('Feedback', FeedbackSchema);
const MarketCache = mongoose.model('MarketCache', MarketCacheSchema);

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10
    });
    logger.info('✅ MongoDB Atlas متصل بنجاح — الفهد v2');
  } catch (error) {
    logger.error('❌ فشل الاتصال بـ MongoDB:', error.message);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ MongoDB انقطع — إعادة المحاولة...');
});

module.exports = { connectDB, User, Trade, Alert, Lesson, Feedback, MarketCache };
