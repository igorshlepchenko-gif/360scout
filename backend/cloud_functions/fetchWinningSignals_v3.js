'use strict';
/**
 * 360SCOUT — Cloud Function: fetchWinningSignals v3
 *
 * שינויים עיקריים מ-v2:
 *   - משתמש בשמות השדות החדשים: playerFatigueIndex, liveDominanceScore
 *   - סף ביטחון הועלה ל-75% (מ-70%)
 *   - isSafeToBet: playerFatigueIndex < 80 && motivationLevel > 2
 *   - הודעת הטלגרם מציגה dominanceScore ו-fatigueIndex
 *
 * env vars:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   ANALYST_API_URL  (ברירת מחדל: https://www.analyst365.net/api/signals)
 */

const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANALYST_API_URL    = process.env.ANALYST_API_URL
  || 'https://www.analyst365.net/api/signals';

/** dedup in-memory — נאפס עם cold start */
const sentMatchesCache = new Set();


exports.fetchWinningSignals = async (req, res) => {
  try {
    console.log('360SCOUT v3 — מפעיל סינון מתקדם The Winning Method...');

    // ── שלב 1: שלוף נתונים מה-API (שרת כבר מסנן confidence ≥ 75) ────────────
    const response = await axios.get(ANALYST_API_URL, {
      params: {
        min_confidence: 75,
        min_odds:       1.50,
        max_fatigue:    80,
        min_motivation: 3,
      },
      timeout: 20_000,
    });

    const matches = response.data.matches || [];
    console.log(`קיבלנו ${matches.length} סיגנלים מהשרת.`);

    if (matches.length === 0) {
      return res.status(200).send('No signals to process.');
    }

    // ── שלב 2: סינון מקומי + isSafeToBet + dedup ────────────────────────────
    if (sentMatchesCache.size > 200) sentMatchesCache.clear();

    const highValueSignals = matches.filter(match => {
      const an = match.analytics || {};

      const fatigueFactor   = an.playerFatigueIndex ?? an.squadFatigueIndex ?? 0;
      const motivationFactor = an.motivationLevel ?? 3;
      const dominanceScore  = an.liveDominanceScore ?? an.liveMomentumScore ?? 0;

      const hasValidOdds = match.odds && match.odds !== '-' && match.odds !== '';
      const oddsValue    = hasValidOdds ? parseFloat(match.odds) : 0;
      const isNew        = !sentMatchesCache.has(String(match.id));

      // isSafeToBet: רמת עייפות נמוכה + מוטיבציה חיובית
      const isSafeToBet = fatigueFactor < 80 && motivationFactor > 2;

      return match.isValueBet === true
          && match.confidence >= 75
          && hasValidOdds
          && oddsValue >= 1.50
          && isSafeToBet
          && isNew;
    });

    console.log(`${highValueSignals.length} סיגנלים עברו את כל הפילטרים.`);

    // ── שלב 3: שלח לטלגרם ──────────────────────────────────────────────────
    let sent = 0;
    for (const match of highValueSignals) {
      const message = formatTelegramMessage(match);
      const ok = await sendTelegramAlert(message);
      if (ok) {
        sentMatchesCache.add(String(match.id));
        sent++;
      }
    }

    const summary = `v3 סיכום: ${sent} התראות נשלחו מתוך ${matches.length} סיגנלים.`;
    console.log(summary);
    return res.status(200).send(summary);

  } catch (error) {
    console.error('שגיאה בסנכרון:', error.message);
    return res.status(500).send('Internal Server Error: ' + error.message);
  }
};


// ── פורמט הודעת טלגרם (v3) ───────────────────────────────────────────────────

function formatTelegramMessage(match) {
  const an = match.analytics || {};

  const fatigueFactor    = an.playerFatigueIndex  ?? an.squadFatigueIndex  ?? 0;
  const dominanceScore   = an.liveDominanceScore   ?? an.liveMomentumScore  ?? 0;
  const motivationFactor = an.motivationLevel      ?? 3;
  const valueEdge        = an.valueEdge            ?? 0;

  const edgeStr          = valueEdge > 0 ? `+${valueEdge}%` : `${valueEdge}%`;
  const weatherStr       = match.weather != null ? `${match.weather}°C` : 'לא ידוע';
  const refereeStr       = match.referee  || 'לא ידוע';

  // סרגל ויזואלי לדומיננטיות
  const dominanceBar = dominanceScore >= 70 ? '🔥🔥🔥 גבוה'
                     : dominanceScore >= 50 ? '🔥🔥 בינוני-גבוה'
                     : '🔥 בינוני';

  // סרגל ויזואלי לעייפות (ירוק = רענן)
  const fatigueBar = fatigueFactor < 40 ? '🟢 רעננים'
                   : fatigueFactor < 60 ? '🟡 סביר'
                   : '🟠 עייפות';

  const motivationBar = '⭐'.repeat(Math.min(5, motivationFactor));

  const stars = valueEdge >= 25 ? '⭐⭐⭐'
              : valueEdge >= 20 ? '⭐⭐'
              : '⭐';

  const liveRow = match.isLive
    ? `⏱ *דקה:* \`${match.elapsed || '?'}'\` | *תוצאה:* \`${(match.score?.home ?? 0)} - ${(match.score?.away ?? 0)}\``
    : `📅 *שעת בעיטה:* ${match.kickoffTime}`;

  return `
🏆 *סיגנל HIGH-VALUE — The Winning Method v3* 🏆

⚽ *${match.homeTeam}* נגד *${match.awayTeam}*
🏟 ${match.league || ''}
${liveRow}

━━━━━━━━━━━━━━━━━━━━
🎯 *המלצה:* ${match.pick}
💰 *יחס שוק:* \`${match.odds}\`
🔥 *Edge (יתרון):* *${edgeStr}* ${stars}
🤖 *ביטחון המודל:* \`${match.confidence}%\`
━━━━━━━━━━━━━━━━━━━━
📈 *דומיננטיות:* ${dominanceBar} (\`${dominanceScore}\`)
💪 *עייפות סגל:* ${fatigueBar} (\`${fatigueFactor}\`)
🎖 *מוטיבציה:* ${motivationBar} (\`${motivationFactor}/5\`)
━━━━━━━━━━━━━━━━━━━━
🌡️ *מזג אוויר:* ${weatherStr} | ⚖️ *שופט:* ${refereeStr}
_360° cross-referencing: xG, מומנטום, עייפות, מוטיבציה_
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
