"""
360SCOUT — Analyst365 API Client (Data Scraper Layer)

שואב נתוני משחקים ישירות מה-API של analyst365.net.
עדיף על גירוד HTML כי:
  - מהיר יותר (ללא render)
  - יציב יותר (אין תלות ב-CSS selectors)
  - מחזיר את אותם הנתונים שהאתר מציג

Playwright HTML scraper זמין ב-fetch_from_html() למקרה שנדרשת
אימות ויזואלי של מה שמוצג למשתמש (monitoring layer).

שימוש:
    from app.tasks.analyst365_client import fetch_live_matches, MatchSnapshot

    matches = await fetch_live_matches(base_url="https://analyst365.net", limit=10)
    for m in matches:
        print(m.home_team, m.value_bet_edge)
"""

from __future__ import annotations
import logging
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ─── Data model ──────────────────────────────────────────────────────────────


@dataclass
class MatchSnapshot:
    """נתוני משחק מלאים כפי שמחזיר ה-API."""
    fixture_id:      Optional[int]
    home_team:       str
    away_team:       str
    league:          str
    home_prob:       float          # 0–1
    draw_prob:       float          # 0–1
    away_prob:       float          # 0–1
    confidence:      float          # %
    value_bet_label: Optional[str]  # e.g. "אורחים (2)"
    value_bet_edge:  Optional[float]  # edge_percent (e.g. 79.8)
    value_bet_rating: Optional[str]   # STRONG / MODERATE / WEAK / None
    odds_home:       Optional[float]
    odds_draw:       Optional[float]
    odds_away:       Optional[float]
    ou_under_edge:   Optional[float]  # Over/Under 2.5
    ou_over_edge:    Optional[float]
    elapsed:         Optional[int]    # דקה נוכחית (None לפרה-גיים)
    score_home:      Optional[int]
    score_away:      Optional[int]
    temperature:     Optional[float]


# ─── Primary: API client ──────────────────────────────────────────────────────


async def fetch_live_matches(
    base_url: str = "https://analyst365.net",
    limit: int = 10,
    days: int = 1,
    timeout: int = 20,
) -> list[MatchSnapshot]:
    """
    שואב משחקים פעילים מ-/api/live/matches.
    מחזיר רשימת MatchSnapshot ממוינת לפי Edge יורד.
    """
    endpoint = f"{base_url}/api/live/matches"
    params   = {"limit": limit, "days": days}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(endpoint, params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.error(f"[Analyst365Client] fetch failed: {e}")
        return []

    raw_matches = data.get("matches", []) if isinstance(data, dict) else data
    snapshots   = [_parse_match(m) for m in raw_matches if m]
    snapshots   = [s for s in snapshots if s is not None]

    # מיין לפי Edge יורד (הכי חזק קודם)
    snapshots.sort(key=lambda s: s.value_bet_edge or 0, reverse=True)
    return snapshots


# ─── Secondary: Playwright HTML monitor (ויזואלי בלבד) ───────────────────────


async def fetch_from_html(
    url: str = "https://analyst365.net",
    headless: bool = True,
) -> list[dict]:
    """
    Playwright HTML scraper — לניטור ויזואלי בלבד.
    מחזיר dict גולמי (לא MatchSnapshot) כי המבנה עשוי להשתנות.

    משמש לאימות: "מה שה-API מחזיר = מה שהמשתמש רואה".
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.warning("Playwright לא מותקן — pip install playwright && playwright install chromium")
        return []

    results = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=headless)
            page    = await browser.new_page()
            await page.set_extra_http_headers({
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
                )
            })
            await page.goto(url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=20000)

            # שלוף כל כרטיסי משחק על-ידי ה-data-fixture attribute
            cards = await page.locator("[data-fixture-id]").all()
            for card in cards:
                try:
                    fid    = await card.get_attribute("data-fixture-id")
                    home   = await _safe_text(card, "[data-home-team]")
                    away   = await _safe_text(card, "[data-away-team]")
                    badge  = await _safe_text(card, "[data-value-badge]")
                    results.append({"fixture_id": fid, "home": home, "away": away, "badge": badge})
                except Exception:
                    pass
            await browser.close()
    except Exception as e:
        logger.error(f"[Analyst365Client] HTML scrape failed: {e}")

    return results


async def _safe_text(parent, selector: str) -> str | None:
    try:
        el = parent.locator(selector).first
        if await el.is_visible():
            return (await el.text_content() or "").strip() or None
    except Exception:
        pass
    return None


# ─── Parser ───────────────────────────────────────────────────────────────────


def _parse_match(m: dict) -> MatchSnapshot | None:
    """ממיר dict מה-API ל-MatchSnapshot."""
    try:
        pred    = m.get("prediction", {}) or {}
        final   = pred.get("final", {}) or {}
        odds    = m.get("odds", {}) or {}
        score   = m.get("score", {}) or {}
        weather = m.get("weather", {}) or {}
        ou      = m.get("ou_edge", {}) or {}

        # Value bet הטוב ביותר
        vb_label = vb_edge = vb_rating = None
        vbs = m.get("value_bets") or {}
        if vbs:
            best = max(vbs.items(), key=lambda kv: (kv[1] or {}).get("edge_percent", 0))
            outcome, vb = best
            LABEL = {"home": "בית (1)", "draw": "תיקו (X)", "away": "אורחים (2)"}
            vb_label  = LABEL.get(outcome, outcome)
            vb_edge   = (vb or {}).get("edge_percent")
            vb_rating = (vb or {}).get("rating")

        return MatchSnapshot(
            fixture_id       = m.get("fixture_id"),
            home_team        = m.get("home_team", "?"),
            away_team        = m.get("away_team", "?"),
            league           = m.get("league", ""),
            home_prob        = final.get("home", 0.0),
            draw_prob        = final.get("draw", 0.0),
            away_prob        = final.get("away", 0.0),
            confidence       = pred.get("confidence", 0.0),
            value_bet_label  = vb_label,
            value_bet_edge   = vb_edge,
            value_bet_rating = vb_rating,
            odds_home        = odds.get("odds_home"),
            odds_draw        = odds.get("odds_draw"),
            odds_away        = odds.get("odds_away"),
            ou_under_edge    = ou.get("under_edge"),
            ou_over_edge     = ou.get("over_edge"),
            elapsed          = m.get("elapsed"),
            score_home       = score.get("home"),
            score_away       = score.get("away"),
            temperature      = weather.get("temperature_celsius"),
        )
    except Exception as e:
        logger.debug(f"[Analyst365Client] parse error: {e}")
        return None
