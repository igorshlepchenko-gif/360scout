'use strict';
/**
 * 360SCOUT — Cloud Function: fetchWinningSignals v5
 *
 * מסנן לפי liveMomentumScore (≥ 45) + squadFatigueIndex (< 75).
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
    console.log('מתחיל סינכרון מתקדם (מומנטום + עייפות) עבור The Winning Method...');

    const response = await axios.get(ANALYST_API_URL, { timeout: 20_000 });
    const matches  = response.data.matches || [];

    if (matches.length === 0) {
      console.log('לא נמצאו משחקים פעילים כרגע.');
      return res.status(200).send('No matches to process.');
    }

    if (sentMatchesCache.size > 200) sentMatchesCache.clear();

    const highValueSignals = matches.filter(match => {
      const an = match.analytics || {};

      // 1. יחס עולמי תקף
      const hasValidOdds = match.odds && match.odds !== '-' && match.odds !== '';

      // 2. מומנטום בזמן אמת
      const attackMomentum = an.liveMomentumScore ?? an.liveDominanceScore ?? 50;
      const isMomentumSafe = attackMomentum >= 45;

      // 3. עייפות סגל (מעל 75 = עייפות קיצונית)
      const squadFatigue      = an.squadFatigueIndex ?? an.playerFatigueIndex ?? 40;
      const isSquadFreshEnough = squadFatigue < 75;

      const isNew = !sentMatchesCache.has(String(match.id));

      return match.isValueBet === true
          && match.confidence >= 70
          && hasValidOdds
          && isMomentumSafe
          && isSquadFreshEnough
          && isNew;
    });

    console.log(`נמצאו ${highValueSignals.length} סיגנלים שעברו את סינון המומנטום והעייפות.`);

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
  const fatigueScore   = an.squadFatigueIndex ?? an.playerFatigueIndex ?? 40;
  const momentumEmoji  = momentumScore > 70 ? '🚀 עוצמתי' : '📈 יציב';
  const weatherStr     = match.weather != null ? `${match.weather}°C` : 'לא ידוע';
  const refereeStr     = match.referee  || 'לא ידוע';

  let fatigueStatus = '🟢 רעננים';
  if (fatigueScore > 50) fatigueStatus = '🟡 עומס בינוני';
  if (fatigueScore > 70) fatigueStatus = '🔴 עייפות גבוהה';

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
🏃‍♂️ *כושר גופני וסגל:* ${fatigueStatus} (\`${fatigueScore}/100\`)
🎯 *המלצת המערכת:* ${match.pick}

🌡️ *מזג אוויר:* ${weatherStr} | ⚖️ *שופט:* ${refereeStr}
_הופק בשילוב מדדי עומס מצטבר, דקות רוטציה, ומומנטום בזמן אמת._
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
