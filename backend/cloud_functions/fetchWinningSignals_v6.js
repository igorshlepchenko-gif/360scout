'use strict';
/**
 * 360SCOUT — Cloud Function: fetchWinningSignals v6
 *
 * PREMIUM Edge filter: valueEdge >= 20%, momentum >= 45, fatigue < 75,
 * motivation >= 3, confidence >= 70.
 *
 * env vars:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 */

const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANALYST_API_URL    = 'https://www.analyst365.net/api/signals';

let sentMatchesCache = new Set();


exports.fetchWinningSignals = async (req, res) => {
  try {
    console.log('מפעיל סינכרון מתקדם עם בקרת שווי (Edge Control) עבור The Winning Method...');

    const response = await axios.get(ANALYST_API_URL, { timeout: 20_000 });
    const matches  = response.data.matches || [];

    if (matches.length === 0) {
      return res.status(200).send('No matches to process.');
    }

    if (sentMatchesCache.size > 200) sentMatchesCache.clear();

    const highValueSignals = matches.filter(match => {
      const an = match.analytics || {};

      const hasValidOdds   = match.odds && match.odds !== '-' && match.odds !== '';
      const attackMomentum = an.liveMomentumScore  ?? an.liveDominanceScore  ?? 50;
      const squadFatigue   = an.squadFatigueIndex  ?? an.playerFatigueIndex  ?? 40;
      const teamMotivation = an.motivationLevel    ?? 3;
      const valueEdge      = an.valueEdge          ?? 0;

      const isPremiumEdge  = valueEdge >= 20.0;
      const isNew          = !sentMatchesCache.has(String(match.id));

      return match.isValueBet === true
          && match.confidence >= 70
          && hasValidOdds
          && attackMomentum >= 45
          && squadFatigue   <  75
          && teamMotivation >= 3
          && isPremiumEdge
          && isNew;
    });

    console.log(`סינון הושלם. נמצאו ${highValueSignals.length} סיגנלים ברמת PREMIUM.`);

    let sent = 0;
    for (const match of highValueSignals) {
      const message = formatTelegramMessage(match);
      const ok = await sendTelegramAlert(message);
      if (ok) {
        sentMatchesCache.add(String(match.id));
        sent++;
      }
    }

    return res.status(200).send(`Processed ${sent} premium signals.`);
  } catch (error) {
    console.error('שגיאה במהלך סנכרון הענן:', error.message);
    return res.status(500).send('Internal Server Error');
  }
};


function formatTelegramMessage(match) {
  const an            = match.analytics || {};
  const momentumScore = an.liveMomentumScore ?? an.liveDominanceScore ?? 50;
  const fatigueScore  = an.squadFatigueIndex ?? an.playerFatigueIndex ?? 40;
  const edgeVal       = an.valueEdge ?? 0;
  const momentumEmoji = momentumScore > 70 ? '🚀 עוצמתי' : '📈 יציב';

  let fatigueStatus = '🟢 רעננים';
  if (fatigueScore > 50) fatigueStatus = '🟡 עומס בינוני';
  if (fatigueScore > 70) fatigueStatus = '🔴 עייפות גבוהה';

  const liveRow = match.isLive
    ? `⏱ *דקה:* \`${match.elapsed || '?'}'\` | *תוצאה:* \`${(match.score?.home ?? 0)} - ${(match.score?.away ?? 0)}\``
    : `📅 *שעת המשחק:* ${match.kickoffTime} (שעון ישראל)`;

  return `
🏆 *סיגנל חם — VALUE BET* 🏆
📊 Analyst365 • The Winning Method

⚽️ *${match.homeTeam}* נגד *${match.awayTeam}*
${liveRow}

━━━━━━━━━━━━━━━━━━━━
🎯 *ההמלצה:* ${match.pick}
💰 *יחס שוק נוכחי:* \`${match.odds}\`
🔥 *Edge (יתרון):* *+${edgeVal}%* ⭐⭐⭐
🤖 *ביטחון המודל:* \`${match.confidence}%\`
━━━━━━━━━━━━━━━━━━━━
📈 *מומנטום:* \`${momentumScore}/100\` ${momentumEmoji} | 🏃‍♂️ *סגל:* ${fatigueStatus}
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
