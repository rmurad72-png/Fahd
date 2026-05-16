/**
 * security.js — الحماية الشاملة 🐆 الفهد v3
 * يعالج: Rate Limiting + Prompt Injection + Phishing + Bot Flooding + Input Sanitization
 */
const { User } = require('./database');
const logger = {
  info: (...a) => console.log('[INFO]', ...a),
  warn: (...a) => console.warn('[WARN]', ...a),
  error: (...a) => console.error('[ERROR]', ...a),
  debug: (...a) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', ...a)
};

// ==================== RATE LIMITING ====================
const rateLimits = new Map();
const RATE_CONFIG = {
  windowMs: 60 * 1000,       // نافذة دقيقة واحدة
  maxRequests: 20,            // حد أقل للأمان
  banAfterViolations: 3,      // حظر بعد 3 انتهاكات
  tempBanMs: 15 * 60 * 1000  // حظر 15 دقيقة
};

// ==================== PROMPT INJECTION PATTERNS ====================
const INJECTION_PATTERNS = [
  // محاولات تجاوز التعليمات
  /ignore\s+(previous|all|above)\s+instructions/i,
  /تجاهل\s+(التعليمات|الأوامر|السابق)/i,
  /forget\s+(everything|all|your)/i,
  /انسى\s+(كل|تعليماتك|دورك)/i,
  /you\s+are\s+now\s+(a|an)/i,
  /أنت\s+الآن\s+(بوت|ذكاء|نظام)/i,
  /act\s+as\s+(a|an|if)/i,
  /pretend\s+(you|to)/i,
  /roleplay\s+as/i,
  /جديد\s*:\s*أنت/i,
  /new\s+instructions?:/i,
  /system\s*:\s*/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<SYS>>/i,

  // محاولات سرقة البيانات
  /api[_\s]?key/i,
  /مفتاح\s*(api|المفتاح)/i,
  /show\s+me\s+(your|the)\s+(key|token|secret)/i,
  /أظهر\s+(المفتاح|التوكن|السر)/i,
  /what\s+is\s+your\s+(api|token|secret)/i,
  /reveal\s+(your|the)\s+(key|token|password)/i,

  // كود خطير
  /eval\s*\(/i,
  /require\s*\(/i,
  /<script[\s>]/i,
  /javascript:/i,
  /process\.env/i,
  /process\.exit/i,
  /child_process/i,

  // SQL/NoSQL Injection
  /SELECT.+FROM/i,
  /DROP\s+TABLE/i,
  /\$where/i,
  /\$gt.*\$lt/i,
  /\.\.\//g,
  /\x00/g
];

// ==================== PHISHING PATTERNS ====================
const PHISHING_PATTERNS = [
  // روابط مشبوهة
  /https?:\/\/(?!t\.me|telegram\.me|api\.telegram)([\w-]+\.){1,3}[\w]{2,}\/(login|signin|verify|confirm|account|wallet|secure|update|auth)/i,
  // طلب بيانات حساسة
  /أرسل\s*(كلمة|رمز|مفتاح|باسورد|بيانات)\s*(المرور|السر|الدخول|محفظتك)/i,
  /send\s*(your\s*)?(password|seed|phrase|private\s*key|mnemonic)/i,
  /أدخل\s*(seed|phrase|private|مفتاح\s*خاص)/i,
  // انتحال هوية
  /أنا\s*(فهد|الدعم|الإدارة|المشرف)/i,
  /i\s+am\s+(fahd|admin|support|official)/i,
  // وعود مالية
  /ضاعف\s*(أرباحك|رصيدك|محفظتك)/i,
  /double\s+your\s+(money|profit|balance)/i,
  /احصل\s+على\s+\d+.*مجاناً/i,
  /free\s+\$?\d+/i
];

// ==================== SUSPICIOUS URL DETECTION ====================
const SUSPICIOUS_URL_PATTERN = /https?:\/\/([\w-]+\.)+[\w]{2,}/gi;
const SAFE_DOMAINS = new Set([
  't.me', 'telegram.me', 'telegram.org',
  'coingecko.com', 'coinmarketcap.com',
  'tradingview.com', 'binance.com',
  'bybit.com', 'okx.com', 'coinbase.com'
]);

function containsPhishingURL(text) {
  const urls = text.match(SUSPICIOUS_URL_PATTERN) || [];
  for (const url of urls) {
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      if (!SAFE_DOMAINS.has(domain)) return true;
    } catch {}
  }
  return false;
}

// ==================== MAIN SECURITY MIDDLEWARE ====================
async function securityMiddleware(msg) {
  const userId = String(msg.from?.id || '');
  const text = msg.text || msg.caption || '';
  const now = Date.now();

  try {
    // 1. فحص الحظر
    const user = await User.findOne({ telegramId: userId });
    if (user?.isBanned) {
      logger.debug(`🔐 محظور: ${userId}`);
      return { blocked: true, reason: 'banned' };
    }

    // 2. Rate Limiting
    const rateCheck = checkRateLimit(userId, now);
    if (rateCheck.blocked) {
      await User.updateOne(
        { telegramId: userId },
        { $inc: { 'security.suspiciousCount': 1 } }
      );
      logger.warn(`🔐 Rate limit: ${userId} — ${rateCheck.reason}`);
      return { blocked: true, reason: rateCheck.reason };
    }

    // 3. Prompt Injection Detection
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        await User.updateOne(
          { telegramId: userId },
          { $inc: { 'security.suspiciousCount': 3 } }
        );
        logger.warn(`🔐 Prompt Injection محتمل: ${userId} — "${text.substring(0, 50)}"`);
        // حظر مؤقت تلقائي
        const limit = rateLimits.get(userId) || { violations: 0 };
        limit.violations = (limit.violations || 0) + 2;
        limit.tempBanUntil = now + RATE_CONFIG.tempBanMs;
        rateLimits.set(userId, { ...limit, count: 0, windowStart: now });
        return { blocked: true, reason: 'injection_attempt' };
      }
    }

    // 4. Phishing Detection
    for (const pattern of PHISHING_PATTERNS) {
      if (pattern.test(text)) {
        await User.updateOne(
          { telegramId: userId },
          { $inc: { 'security.suspiciousCount': 2 } }
        );
        logger.warn(`🔐 Phishing محتمل: ${userId} — "${text.substring(0, 50)}"`);
        return { blocked: true, reason: 'phishing_attempt' };
      }
    }

    // 5. URL Phishing
    if (containsPhishingURL(text)) {
      logger.warn(`🔐 رابط مشبوه: ${userId}`);
      await User.updateOne(
        { telegramId: userId },
        { $inc: { 'security.suspiciousCount': 1 } }
      );
      return { blocked: true, reason: 'suspicious_url' };
    }

    // 6. تحديث إحصائيات
    await User.updateOne(
      { telegramId: userId },
      { $set: { lastActivity: new Date() }, $inc: { 'security.requestCount': 1 } },
      { upsert: false }
    );

    return { blocked: false };

  } catch (error) {
    logger.error(`🔐 security error: ${error.message}`);
    return { blocked: false }; // fail open للحفاظ على الخدمة
  }
}

// ==================== RATE LIMIT ====================
function checkRateLimit(userId, now) {
  if (!rateLimits.has(userId)) {
    rateLimits.set(userId, { count: 1, windowStart: now, violations: 0, tempBanUntil: 0 });
    return { blocked: false };
  }
  const limit = rateLimits.get(userId);

  // حظر مؤقت نشط
  if (limit.tempBanUntil > now) {
    const remaining = Math.ceil((limit.tempBanUntil - now) / 60000);
    return { blocked: true, reason: `temp_banned_${remaining}min` };
  }

  // إعادة ضبط النافذة
  if (now - limit.windowStart > RATE_CONFIG.windowMs) {
    limit.count = 1;
    limit.windowStart = now;
    return { blocked: false };
  }

  limit.count++;
  if (limit.count > RATE_CONFIG.maxRequests) {
    limit.violations++;
    if (limit.violations >= RATE_CONFIG.banAfterViolations) {
      limit.tempBanUntil = now + RATE_CONFIG.tempBanMs;
      logger.warn(`🔐 حظر مؤقت 15 دقيقة: ${userId}`);
      return { blocked: true, reason: 'repeated_violations' };
    }
    return { blocked: true, reason: 'rate_exceeded' };
  }
  return { blocked: false };
}

// ==================== INPUT SANITIZATION ====================
function sanitizeText(text, maxLen) {
  maxLen = maxLen || 500;
  if (!text) return '';
  return String(text)
    // إزالة رموز Markdown الخطرة فقط — النقطة محمية
    .replace(/[*_`\[\]()~>#+=|{}!\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLen);
}

// تنظيف خاص للـ prompts قبل إرسالها لـ Claude
function sanitizeForClaude(text, maxLen) {
  maxLen = maxLen || 1000;
  if (!text) return '';
  let clean = String(text).trim();

  // إزالة أي محاولات Injection
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, '[محتوى محذوف]');
  }

  // إزالة روابط مشبوهة
  clean = clean.replace(SUSPICIOUS_URL_PATTERN, (url) => {
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      return SAFE_DOMAINS.has(domain) ? url : '[رابط محذوف]';
    } catch { return '[رابط محذوف]'; }
  });

  return clean.substring(0, maxLen);
}

// ==================== ADMIN FUNCTIONS ====================
async function banUser(userId, reason) {
  await User.updateOne(
    { telegramId: String(userId) },
    { $set: { isBanned: true, banReason: reason } }
  );
  rateLimits.delete(String(userId));
  logger.warn(`🔴 حظر دائم: ${userId} — ${reason}`);
}

async function unbanUser(userId) {
  await User.updateOne(
    { telegramId: String(userId) },
    { $set: { isBanned: false, banReason: null } }
  );
  rateLimits.delete(String(userId));
  logger.info(`🟢 رفع حظر: ${userId}`);
}

function isAdmin(userId) {
  if (!process.env.ADMIN_TELEGRAM_ID) return false;
  return String(userId) === String(process.env.ADMIN_TELEGRAM_ID);
}

// ==================== SECURITY REPORT ====================
async function getSecurityReport() {
  try {
    const suspicious = await User.find(
      { 'security.suspiciousCount': { $gt: 0 } },
      { telegramId: 1, username: 1, 'security.suspiciousCount': 1, isBanned: 1 }
    ).sort({ 'security.suspiciousCount': -1 }).limit(10);

    const banned = await User.countDocuments({ isBanned: true });
    const activeLimits = Array.from(rateLimits.entries())
      .filter(([, v]) => v.tempBanUntil > Date.now())
      .length;

    return {
      banned,
      activeTempBans: activeLimits,
      topSuspicious: suspicious,
      totalMonitored: rateLimits.size
    };
  } catch (e) {
    return null;
  }
}

// تنظيف دوري لـ rateLimits (كل ساعة)
setInterval(() => {
  const now = Date.now();
  for (const [userId, limit] of rateLimits.entries()) {
    if (now - limit.windowStart > 60 * 60 * 1000 && limit.tempBanUntil < now) {
      rateLimits.delete(userId);
    }
  }
}, 60 * 60 * 1000);

module.exports = {
  securityMiddleware,
  banUser, unbanUser, isAdmin,
  sanitizeText, sanitizeForClaude,
  getSecurityReport
};
