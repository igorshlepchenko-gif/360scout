'use strict';
/**
 * 360SCOUT — Cloud Function: fetchWinningSignals v2
 *
 * גרסה פשוטה: שולחת התראה לכל משחק שעבר את הפילטרים:
 *   isValueBet === true  (לפחות EV > 5%)
 *   confidence >= 70
 *   odds >= 1.50
 *
 * env vars:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   ANALYST_API_URL  (ברירת מחדל: analyst365.net/api/signals)
 */

const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANALYST_API_URL    = process.env.ANALYST_API_URL
  || 'https://www.analyst365.net/api/signals';

/** dedup in-memory — נאפס בכל cold start */
const sentMatchesCache = new Set();


exports.fetchWinningSignals = async (req, res) => {
  try {
    console.log('מתחיל סינכרון נתונים לפי מודל The Winning Method...');

    // ── שלב 1: שלוף נתונים מה-API ───────────────────────────────────────────
    const response = await axios.get(ANALYST_API_URL, {
      params:  { min_confidence: 70, min_odds: 1.50 },
      timeout: 20_000,
    });

    const matches = response.data.matches || [];

    if (matches.length === 0) {
      console.log('לא נמצאו משחקים פעילים כרגע.');
      return res.status(200).send('No matches to process.');
    }

    // ── שלב 2: סינון מקומי + dedup ─────────────────────────────────────────
    const highValueSignals = matches.filter(match => {
      const hasValidOdds = match.odds && match.odds !== '-' && match.odds !== '';
      const oddsValue    = hasValidOdds ? parseFloat(match.odds) : 0;
      const isNew        = !sentMatchesCache.has(String(match.id));

      return match.isValueBet === true
          && match.confidence >= 70
          && hasValidOdds
          && oddsValue >= 1.50
          && isNew;
    });

    if (sentMatchesCache.size > 200) sentMatchesCache.clear();

    console.log(`נמצאו ${highValueSignals.length} סיגנלים בעלי ערך גבוה עם יחס תקף.`);

    // ── שלב 3: שלח לטלגרם ──────────────────────────────────────────────────
    for (const match of highValueSignals) {
      const message = formatTelegramMessage(match);
      const ok = await sendTelegramAlert(message);
      if (ok) sentMatchesCache.add(String(match.id));
    }

    return res.status(200).send(`Processed ${highValueSignals.length} signals successfully.`);

  } catch (error) {
    console.error('שגיאה במהלך סנכרון הענן:', error.message);
    return res.status(500).send('Internal Server Error');
  }
};


// ── פורמט הודעת טלגרם ────────────────────────────────────────────────────────

function formatTelegramMessage(match) {
  const an          = match.analytics || {};
  const valueEdge   = an.valueEdge  ?? 0;
  const edgeStr     = valueEdge > 0 ? `+${valueEdge}%` : `${valueEdge}%`;
  const weatherStr  = match.weather != null ? `${match.weather}°C` : 'לא ידוע';
  const refereeStr  = match.referee  || 'לא ידוע';

  const liveRow = match.isLive
    ? `⏱ *דקה:* \`${match.elapsed || '?'}'\` | *תוצאה:* \`${(match.score?.home ?? 0)} - ${(match.score?.away ?? 0)}\``
    : `📅 *שעת בעיטה:* ${match.kickoffTime}`;

  return `
🔥 *הימור ערך חדש זוהה* 🔥
🏆 ${match.league}

⚽ *${match.homeTeam}* נגד *${match.awayTeam}*
${liveRow}

🤖 *מודל:* The Winning Method
📊 *אחוז ביטחון:* \`${match.confidence}%\`
💰 *יחס עולמי:* \`${match.odds}\`
⚡ *יתרון על השוק:* *${edgeStr}*
🎯 *המלצת המערכת:* ${match.pick}

🌡️ *מזג אוויר:* ${weatherStr} | ⚖️ *שופט:* ${refereeStr}
_הופק באמצעות ניתוח היקפי 360° של xG, מומנטום ונתוני שטח._
`.trim();
}


// ── שליחה לטלגרם ─────────────────────────────────────────────────────────────

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram env vars חסרים — מדפיס לקונסול:');
    console.log(message);
    return true;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const r = await axios.post(url, {
      chat_id:    TELEGRAM_CHAT_ID,
      text:       message,
      parse_mode: 'Markdown',
    }, { timeout: 10_000 });
    return r.status === 200;
  } catch (err) {
    console.error('Telegram send failed:', err.message);
    return false;
  }
}
