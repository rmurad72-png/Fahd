/**
 * security.js — الحماية السيبرانية الذاتية 🐆 الفهد v2
 */
const crypto = require('crypto');
const { User } = require('./database');
const { logger } = require('./logger');

const rateLimits = new Map();
const RATE_CONFIG = {
  windowMs: 60 * 1000,
  maxRequests: 30,
  banAfterViolations: 5,
  tempBanMs: 10 * 60 * 1000
};

let anomalyModel = {
  avgReqPerMin: 5,
  stdDev: 3,
  totalRequests: 0,
  lastUpdated: Date.now()
};

const DANGEROUS_PATTERNS = [
  /eval\s*\(/i, /require\s*\(/i, /<script/i,
  /javascript:/i, /SELECT.+FROM/i, /DROP\s+TABLE/i,
  /\$where/i, /\.\.\//g, /\x00/g
];

async function securityMiddleware(msg) {
  const userId = String(msg.from?.id);
  const text = msg.text || '';
  const now = Date.now();

  try {
    const user = await User.findOne({ telegramId: userId });
    if (user?.isBanned) return { blocked: true, reason: 'banned' };

    const rateCheck = checkRateLimit(userId, now);
    if (rateCheck.blocked) {
      await User.updateOne({ telegramId: userId }, { $inc: { 'security.suspiciousCount': 1 } });
      return { blocked: true, reason: rateCheck.reason };
    }

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(text)) {
        await User.updateOne({ telegramId: userId }, { $inc: { 'security.suspiciousCount': 2 } });
        logger.warn(`🔐 الفهد: مدخل خطير من ${userId}`);
        return { blocked: true, reason: 'dangerous_input' };
      }
    }

    updateAnomalyModel();
    await User.updateOne(
      { telegramId: userId },
      { $set: { lastActivity: new Date() }, $inc: { 'security.requestCount': 1 } },
      { upsert: false }
    );

    return { blocked: false };
  } catch (error) {
    logger.error('🔐 خطأ في security:', error.message);
    return { blocked: false };
  }
}

function checkRateLimit(userId, now) {
  if (!rateLimits.has(userId)) {
    rateLimits.set(userId, { count: 1, windowStart: now, violations: 0, tempBanUntil: 0 });
    return { blocked: false };
  }
  const limit = rateLimits.get(userId);
  if (limit.tempBanUntil > now) return { blocked: true, reason: 'temp_banned' };
  if (now - limit.windowStart > RATE_CONFIG.windowMs) {
    limit.count = 1; limit.windowStart = now;
    return { blocked: false };
  }
  limit.count++;
  if (limit.count > RATE_CONFIG.maxRequests) {
    limit.violations++;
    if (limit.violations >= RATE_CONFIG.banAfterViolations) {
      limit.tempBanUntil = now + RATE_CONFIG.tempBanMs;
      return { blocked: true, reason: 'repeated_violations' };
    }
    return { blocked: true, reason: 'rate_exceeded' };
  }
  return { blocked: false };
}

function updateAnomalyModel() {
  anomalyModel.totalRequests++;
  if (anomalyModel.totalRequests % 1000 === 0) {
    const counts = Array.from(rateLimits.values()).map(l => l.count);
    if (counts.length > 0) {
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance = counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length;
      anomalyModel.avgReqPerMin = mean;
      anomalyModel.stdDev = Math.sqrt(variance);
      anomalyModel.lastUpdated = Date.now();
    }
  }
}

async function banUser(userId, reason) {
  await User.updateOne({ telegramId: userId }, { $set: { isBanned: true, banReason: reason } });
  logger.warn(`🔴 الفهد: حظر ${userId} — ${reason}`);
}

async function unbanUser(userId) {
  await User.updateOne({ telegramId: userId }, { $set: { isBanned: false, banReason: null } });
}

function isAdmin(userId) {
  return String(userId) === String(process.env.ADMIN_TELEGRAM_ID);
}

function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[*_`\[\]()~>#+=|{}.!\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 800);
}

module.exports = { securityMiddleware, banUser, unbanUser, isAdmin, sanitizeText };
