/**
 * feedback.js — التغذية الراجعة 🐆 الفهد v2
 */
const { Feedback, Lesson } = require('./database');
const { analyzeFeedback, freeChatWithFahd } = require('./agent');
const { logger } = require('./logger');

const chatStates = new Map();
const feedbackStates = new Map();

function getState(userId) { return feedbackStates.get(userId) || null; }
function setState(userId, state) { feedbackStates.set(userId, state); }
function clearState(userId) { feedbackStates.delete(userId); chatStates.delete(userId); }

function getChatHistory(userId) { return chatStates.get(userId) || []; }
function addChatHistory(userId, role, content) {
  const h = getChatHistory(userId);
  h.push({ role, content });
  chatStates.set(userId, h.slice(-10));
}

async function handleFeedbackState(bot, userId, text) {
  const state = getState(userId);
  if (!state) return false;

  if (state.mode === 'feedback_trade') {
    if (state.step === 'symbol') {
      setState(userId, { ...state, step: 'direction', trade: { symbol: text.toUpperCase() } });
      await bot.sendMessage(userId, `العملة: ${text.toUpperCase()}\n\nما كان اتجاهك؟`, {
        reply_markup: { inline_keyboard: [[
          { text: 'شراء Long', callback_data: 'fb_long' },
          { text: 'بيع Short', callback_data: 'fb_short' }
        ]] }
      });
      return true;
    }
    if (state.step === 'entry') {
      const price = parseFloat(text);
      if (!price) { await bot.sendMessage(userId, 'سعر غير صالح. ارسل رقماً.'); return true; }
      setState(userId, { ...state, step: 'exit', trade: { ...state.trade, entryPrice: price } });
      await bot.sendMessage(userId, `سعر الدخول: $${price}\n\nما سعر الخروج؟`);
      return true;
    }
    if (state.step === 'exit') {
      const price = parseFloat(text);
      if (!price) { await bot.sendMessage(userId, 'سعر غير صالح.'); return true; }
      const pnl = state.trade.direction === 'long'
        ? ((price - state.trade.entryPrice) / state.trade.entryPrice * 100)
        : ((state.trade.entryPrice - price) / state.trade.entryPrice * 100);
      setState(userId, { ...state, step: 'fahd_rec', trade: { ...state.trade, exitPrice: price, pnlPercent: pnl } });
      await bot.sendMessage(userId, `الخروج: $${price} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%)\n\nما كانت توصية الفهد؟`, {
        reply_markup: { inline_keyboard: [[
          { text: 'شراء', callback_data: 'fb_rec_long' },
          { text: 'بيع', callback_data: 'fb_rec_short' },
          { text: 'انتظر', callback_data: 'fb_rec_wait' },
          { text: 'تجنب', callback_data: 'fb_rec_avoid' }
        ]] }
      });
      return true;
    }
    if (state.step === 'note') {
      const loadMsg = await bot.sendMessage(userId, 'الفهد يحلل تجربتك...');
      const outcome = state.trade.pnlPercent >= 0 ? 'win' : 'loss';
      const feedbackData = {
        trade: { ...state.trade, outcome, targetHit: outcome === 'win', userAction: state.trade.direction },
        userNote: text
      };
      const analysis = await analyzeFeedback(feedbackData);

      await saveFeedback(userId, 'trade_feedback', feedbackData, analysis);
      await bot.deleteMessage(userId, loadMsg.message_id).catch(() => {});

      let resp = `الفهد — رد على تغذيتك الراجعة\n\n`;
      resp += `ردي: ${analysis.acknowledgment || 'N/A'}\n\n`;
      if (analysis.whereIWasWrong) resp += `ما اخطات فيه: ${analysis.whereIWasWrong}\n\n`;
      resp += `الدرس: ${analysis.lesson || 'N/A'}\n\n`;
      if (analysis.strategyAdjustment) resp += `تعديل على استراتيجيتي: ${analysis.strategyAdjustment}\n\n`;
      resp += `نصيحتي لك: ${analysis.userAdvice || 'N/A'}`;

      await bot.sendMessage(userId, resp);
      clearState(userId);
      return true;
    }
  }

  if (state.mode === 'free_chat') {
    const loadMsg = await bot.sendMessage(userId, 'الفهد يفكر...');
    try {
      const history = getChatHistory(userId);
      const response = await freeChatWithFahd(text, history);
      addChatHistory(userId, 'user', text);
      addChatHistory(userId, 'assistant', response);
      await bot.deleteMessage(userId, loadMsg.message_id).catch(() => {});
      await bot.sendMessage(userId, `الفهد:\n\n${response}\n\nارسل /endchat لانهاء المحادثة`);
    } catch (e) {
      await bot.editMessageText('فشل الرد. حاول مجدداً.', { chat_id: userId, message_id: loadMsg.message_id }).catch(() => {});
    }
    return true;
  }

  return false;
}

async function saveFeedback(userId, type, data, analysis) {
  try {
    await new Feedback({
      userId, type,
      trade: data.trade,
      userNote: data.userNote,
      fahdResponse: analysis.acknowledgment || '',
      fahdLesson: analysis.lesson || '',
      fahdAdjustment: analysis.strategyAdjustment || ''
    }).save();
  } catch (e) { logger.debug('حفظ feedback فشل:', e.message); }
}

async function getFeedbackHistory(userId, limit = 5) {
  return await Feedback.find({ userId }).sort({ createdAt: -1 }).limit(limit);
}

module.exports = { getState, setState, clearState, handleFeedbackState, getFeedbackHistory };
