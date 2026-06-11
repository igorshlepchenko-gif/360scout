/**
 * Enhanced match loader — fills missing odds from The Odds API
 * when neither the main API nor API-Sports returned odds for a fixture.
 *
 * Server-side only (uses process.env, Next.js fetch caching).
 * Matches the same odds dict shape as build_match_analysis_sync in the backend.
 */

const ODDS_API_KEY  = process.env.ODDS_API_KEY ?? "";
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

async function fetchFallbackOdds(
  homeTeam: string,
  awayTeam: string,
): Promise<Record<string, any> | null> {
  if (!ODDS_API_KEY) return null;

  try {
    const res = await fetch(
      `${ODDS_API_BASE}/sports/soccer/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`,
      { next: { revalidate: 900 } }, // cache 15 minutes
    );
    if (!res.ok) return null;

    const events: any[] = await res.json();
    const hl = homeTeam.toLowerCase();
    const al = awayTeam.toLowerCase();

    const event = events.find(e => {
      const eh = e.home_team?.toLowerCase() ?? "";
      const ea = e.away_team?.toLowerCase() ?? "";
      return (
        (hl.slice(0, 6) && eh.includes(hl.slice(0, 6))) ||
        (eh.slice(0, 6) && hl.includes(eh.slice(0, 6)))
      ) && (
        (al.slice(0, 6) && ea.includes(al.slice(0, 6))) ||
        (ea.slice(0, 6) && al.includes(ea.slice(0, 6)))
      );
    });
    if (!event?.bookmakers?.length) return null;

    // prefer Pinnacle for accuracy, otherwise first available
    const bm =
      event.bookmakers.find((b: any) => /pinnacle/i.test(b.key ?? "")) ??
      event.bookmakers[0];

    const market = bm.markets?.find((m: any) => m.key === "h2h");
    if (!market) return null;

    const byName = Object.fromEntries(
      (market.outcomes ?? []).map((o: any) => [o.name, o.price]),
    );
    const homeOdds = byName[event.home_team];
    const awayOdds = byName[event.away_team];
    const drawOdds = byName["Draw"] ?? 3.5;
    if (!homeOdds || !awayOdds) return null;

    return {
      bookmaker:         bm.title ?? "The Odds API",
      odds_home:         homeOdds,
      odds_draw:         drawOdds,
      odds_away:         awayOdds,
      implied_prob_home: Math.round((1 / homeOdds) * 10000) / 10000,
      implied_prob_draw: Math.round((1 / drawOdds) * 10000) / 10000,
      implied_prob_away: Math.round((1 / awayOdds) * 10000) / 10000,
      _source:           "odds-api-fallback",
    };
  } catch {
    return null;
  }
}

/**
 * Takes raw matches from the backend and fills in odds from The Odds API
 * for any match that is still missing them.
 *
 * @param matches  — raw array from /api/live/matches
 * @param filterNoOdds — when true (default false) removes matches
 *                       that have no odds from ANY source
 */
export async function getEnhancedMatches(
  matches: any[],
  { filterNoOdds = false } = {},
): Promise<any[]> {
  const enhanced = await Promise.all(
    matches.map(async match => {
      const hasOdds =
        match.odds?.odds_home != null && match.odds?.odds_away != null;

      if (hasOdds) return match;

      const fallback = await fetchFallbackOdds(
        match.home_team ?? "",
        match.away_team ?? "",
      );
      if (!fallback) return match;

      return {
        ...match,
        odds: { ...fallback, isFallback: true },
      };
    }),
  );

  return filterNoOdds
    ? enhanced.filter(m => m.odds?.odds_home != null)
    : enhanced;
}
