'use strict';
/**
 * 360SCOUT — Cloud Function: fetchWinningSignals v4
 *
 * גרסה ממוקדת-מומנטום: מסננת לפי liveMomentumScore בלבד (≥ 45).
 * פשוטה מ-v3 — מתאימה לפריסה מהירה.
 *
 * env vars:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 */

const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANALYST_API_URL    = 'https://www.analyst365.net/api/signals';

/** dedup in-memory — נאפס עם cold start */
const sentMatchesCache = new Set();


exports.fetchWinningSignals = async (req, res) => {
  try {
    console.log('מתחיל סינכרון מתקדם מבוסס מומנטום עבור The Winning Method...');

    const response = await axios.get(ANALYST_API_URL, { timeout: 20_000 });
    const matches  = response.data.matches || [];

    if (matches.length === 0) {
      console.log('לא נמצאו משחקים פעילים כרגע.');
      return res.status(200).send('No matches to process.');
    }

    if (sentMatchesCache.size > 200) sentMatchesCache.clear();

    // סינון מתקדם המשלב יחסים תקפים ומנוע מומנטום בזמן אמת
    const highValueSignals = matches.filter(match => {
      // 1. בדיקת קיום יחס עולמי תקף
      const hasValidOdds = match.odds && match.odds !== '-' && match.odds !== '';

      // 2. שליפת מדד מומנטום (0–100)
      const an             = match.analytics || {};
      const attackMomentum = an.liveMomentumScore || an.liveDominanceScore || 50;

      // 3. סף מומנטום: לא בקריסה
      const isMomentumSafe = attackMomentum >= 45;

      const isNew = !sentMatchesCache.has(String(match.id));

      return match.isValueBet === true
          && match.confidence >= 70
          && hasValidOdds
          && isMomentumSafe
          && isNew;
    });

    console.log(`נמצאו ${highValueSignals.length} סיגנלים עם מומנטום תומך ויחס תקף.`);

    let sent = 0;
    for (const match of highValueSignals) {
      const message = formatTelegramMessage(match);
      const ok = await sendTelegramAlert(message);
      if (ok) {
        sentMatchesCache.add(String(match.id));
        sent++;
      }
    }

    return res.status(200).send(`Processed ${sent} signals successfully.`);
  } catch (error) {
    console.error('שגיאה במהלך סנכרון הענן:', error.message);
    return res.status(500).send('Internal Server Error');
  }
};


function formatTelegramMessage(match) {
  const an             = match.analytics || {};
  const momentumScore  = an.liveMomentumScore ?? an.liveDominanceScore ?? 50;
  const momentumEmoji  = momentumScore > 70 ? '🚀 עוצמתי' : '📈 יציב';
  const weatherStr     = match.weather != null ? `${match.weather}°C` : 'לא ידוע';
  const refereeStr     = match.referee  || 'לא ידוע';

  const liveRow = match.isLive
    ? `⏱ *דקה:* \`${match.elapsed || '?'}'\` | *תוצאה:* \`${(match.score?.home ?? 0)} - ${(match.score?.away ?? 0)}\``
    : `📅 *שעת בעיטה:* ${match.kickoffTime}`;

  return `
🔥 *הימור ערך חדש זוהה* 🔥
🏆 ${match.league}

⚽️ *${match.homeTeam}* נגד *${match.awayTeam}*
${liveRow}

🤖 *מודל:* The Winning Method
📊 *אחוז ביטחון:* \`${match.confidence}%\`
💰 *יחס עולמי:* \`${match.odds}\`
⚡ *מומנטום לייב:* \`${momentumScore}/100\` (${momentumEmoji})
🎯 *המלצת המערכת:* ${match.pick}

🌡️ *מזג אוויר:* ${weatherStr} | ⚖️ *שופט:* ${refereeStr}
_הופק בשילוב מדדי לחץ, xG מתגלגל ומומנטום ב-15 הדקות האחרונות._
  `.trim();
}


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
