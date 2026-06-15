'use strict';
/**
 * 360SCOUT — Cloud Function: fetchWinningSignals
 * שולח לטלגרם רק סיגנלים שעברו את כל הפילטרים המתקדמים.
 *
 * להפעלה (Google Cloud Functions):
 *   gcloud functions deploy fetchWinningSignals \
 *     --runtime nodejs20 --trigger-http --allow-unauthenticated \
 *     --set-env-vars TELEGRAM_BOT_TOKEN=...,TELEGRAM_CHAT_ID=...
 *
 * env vars נדרשים:
 *   TELEGRAM_BOT_TOKEN  — token מה-BotFather
 *   TELEGRAM_CHAT_ID    — @channel_name או -100xxxxxxxx
 *   ANALYST_API_URL     — (אופציונלי) override ל-endpoint, ברירת מחדל analyst365.net
 */

const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANALYST_API_URL    = process.env.ANALYST_API_URL
  || 'https://www.analyst365.net/api/signals';

/**
 * dedup cache — מונע שליחת אותו משחק פעמיים.
 * הערה: in-memory — נאפס עם cold start של ה-Function.
 * לייצור, שקול Cloud Firestore / Redis לcache קבוע.
 */
const sentMatchesCache = new Set();

// ── פרמטרי פילטרים (query params ל-API) ─────────────────────────────────────
const API_PARAMS = {
  min_confidence: 75,    // ≥75% ביטחון מודל
  min_edge:       20,    // ≥20% EV (Premium Edge)
  min_odds:       1.50,  // 🛑 חוסם 1.10/1.20
  min_momentum:   45,
  max_fatigue:    75,
  min_motivation: 3,
};


exports.fetchWinningSignals = async (req, res) => {
  try {
    console.log('מפעיל סינכרון מתקדם — The Winning Method...');

    // ── שלב 1: שליפת סיגנלים מה-API ──────────────────────────────────────────
    const response = await axios.get(ANALYST_API_URL, {
      params:  API_PARAMS,
      timeout: 20_000,
    });

    const matches = response.data.matches || [];
    console.log(`קיבלנו ${matches.length} סיגנלים שעברו סינון מהשרת.`);

    if (matches.length === 0) {
      return res.status(200).send('No signals to send.');
    }

    // ── שלב 2: dedup מקומי (מניעת שליחה כפולה) ───────────────────────────────
    if (sentMatchesCache.size > 200) {
      sentMatchesCache.clear();
    }

    const freshSignals = matches.filter(m => !sentMatchesCache.has(String(m.id)));
    console.log(`${freshSignals.length} סיגנלים חדשים (לא נשלחו בעבר).`);

    // ── שלב 3: שלח התראה לכל סיגנל חדש ──────────────────────────────────────
    let sent = 0;
    for (const match of freshSignals) {
      const message = formatTelegramMessage(match);
      const ok = await sendTelegramAlert(message);
      if (ok) {
        sentMatchesCache.add(String(match.id));
        sent++;
      }
    }

    const summary = `סיכום: ${sent} התראות נשלחו מתוך ${matches.length} סיגנלים.`;
    console.log(summary);
    return res.status(200).send(summary);

  } catch (error) {
    console.error('שגיאה בסנכרון:', error.message);
    return res.status(500).send('Internal Server Error: ' + error.message);
  }
};


// ── פורמט הודעת טלגרם ────────────────────────────────────────────────────────

function formatTelegramMessage(match) {
  const an = match.analytics || {};

  const momentumEmoji = an.liveMomentumScore > 70 ? '🚀 עוצמתי' : '📈 יציב';
  const fatigueStatus = an.squadFatigueIndex > 50 ? '🟡 עומס בינוני' : '🟢 רעננים';
  const motivationBar = '⭐'.repeat(Math.min(5, an.motivationLevel || 3));

  const stars = an.valueEdge >= 25 ? '⭐⭐⭐'
              : an.valueEdge >= 20 ? '⭐⭐'
              : '⭐';

  const liveRow = match.isLive
    ? `⏱ *דקה:* \`${match.elapsed || '?'}'\` | *תוצאה:* \`${(match.score?.home ?? 0)} - ${(match.score?.away ?? 0)}\``
    : `📅 *שעת המשחק:* ${match.kickoffTime} (שעון ישראל)`;

  return `
🏆 *סיגנל זהב — HIGH CONFIDENCE VALUE BET* 🏆
📊 *Analyst365 • The Winning Method*

⚽ *${match.homeTeam}* נגד *${match.awayTeam}*
🏟 ${match.league || ''}
${liveRow}

━━━━━━━━━━━━━━━━━━━━
🎯 *ההמלצה:* ${match.pick}
💰 *יחס שוק:* \`${match.odds}\` (מאושר ≥ 1.50)
🔥 *Edge (יתרון):* *+${an.valueEdge}%* ${stars}
🤖 *ביטחון המודל:* \`${match.confidence}%\`
━━━━━━━━━━━━━━━━━━━━
${momentumEmoji} | ${fatigueStatus} | ${motivationBar}
🧠 המודל סינן יחסים נמוכים ומצא ערך אמיתי.
`.trim();
}


// ── שליחה לטלגרם ─────────────────────────────────────────────────────────────

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram env vars חסרים — מדפיס במקום שולח:');
    console.log(message);
    return true;   // בdebug — נחשב כהצלחה
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
