"""
360SCOUT — OLBG Expert Consensus Scraper

התקנה (חד-פעמית):
    pip install playwright
    playwright install chromium

שימוש ישיר:
    from app.tasks.olbg_scraper import fetch_olbg_consensus, olbg_to_analyst_predictions
    data = await fetch_olbg_consensus("https://www.olbg.com/football/arsenal-vs-chelsea")
    # → {"home": 0.74, "draw": 0.15, "away": 0.11}
"""

import re
import asyncio
import logging

logger = logging.getLogger(__name__)

# cache תוך-שרת: url → result (נמחק עם restart)
_cache: dict[str, dict | None] = {}


# ─── URL builder ─────────────────────────────────────────────────────────────

def build_olbg_url(home_team: str, away_team: str) -> str:
    """בנה URL של OLBG ממשחק (slug format)."""
    def slug(name: str) -> str:
        name = re.sub(r"[^\w\s-]", "", name.lower())
        return re.sub(r"[\s_]+", "-", name).strip("-")
    return f"https://www.olbg.com/football/{slug(home_team)}-vs-{slug(away_team)}"


# ─── Async scraper ────────────────────────────────────────────────────────────

async def fetch_olbg_consensus(url: str) -> dict | None:
    """
    Scrape OLBG for expert consensus percentages (home / draw / away).
    Returns {"home": 0.74, "draw": 0.15, "away": 0.11} or None.
    """
    if url in _cache:
        return _cache[url]

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.warning("Playwright לא מותקן — pip install playwright && playwright install chromium")
        return None

    result = None
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page    = await browser.new_page()                  # new_page() — לא new_web_page()
            await page.set_extra_http_headers({
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                )
            })
            await page.goto(url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            result = await _extract_percentages(page)
            await browser.close()
    except Exception as e:
        logger.debug(f"[OLBG] scrape failed for {url}: {e}")

    _cache[url] = result  # cache even None so we don't retry failed URLs
    if result:
        logger.info(f"[OLBG] {url} → {result}")
    return result


async def _extract_percentages(page) -> dict | None:
    """
    מנסה כמה selectors כדי לחלץ home/draw/away % מ-OLBG.
    מחזיר dict מנורמל לסכום=1, או None.
    """
    # 1. .tips-st-percentage (selector מהדוגמה המקורית, כל 3 תוצאות)
    try:
        els = await page.locator(".tips-st-percentage").all()
        if len(els) >= 2:
            texts = [await el.text_content() for el in els[:3]]
            r = _texts_to_dict(texts)
            if r:
                return r
    except Exception:
        pass

    # 2. data-attribute selectors נפוצים ב-OLBG
    for sel in (".tip-percentage", "[class*='percentage']", "[class*='tips-percentage']"):
        try:
            els = await page.locator(sel).all()
            visible = [el for el in els if await el.is_visible()]
            if len(visible) >= 2:
                texts = [await el.text_content() for el in visible[:3]]
                r = _texts_to_dict(texts)
                if r:
                    return r
        except Exception:
            pass

    # 3. regex fallback — חיפוש בטקסט המלא של הדף
    try:
        content = await page.content()
        nums = [int(m) for m in re.findall(r'\b(\d{1,3})\s*%', content)
                if 5 <= int(m) <= 95]
        if len(nums) >= 2:
            return _nums_to_dict(nums[:3])
    except Exception:
        pass

    return None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _texts_to_dict(texts: list[str]) -> dict | None:
    nums = []
    for t in texts:
        try:
            nums.append(int(str(t).replace("%", "").strip()))
        except (ValueError, TypeError):
            pass
    return _nums_to_dict(nums) if nums else None


def _nums_to_dict(nums: list[int]) -> dict | None:
    home = nums[0] / 100 if len(nums) > 0 else 0
    draw = nums[1] / 100 if len(nums) > 1 else 0
    away = nums[2] / 100 if len(nums) > 2 else max(0.0, 1 - home - draw)
    total = home + draw + away
    if total <= 0:
        return None
    return {
        "home": round(home / total, 4),
        "draw": round(draw / total, 4),
        "away": round(away / total, 4),
    }


# ─── Converter for calculate_consensus() ─────────────────────────────────────

def olbg_to_analyst_predictions(consensus: dict) -> list[dict]:
    """
    ממיר אחוזי קהל של OLBG → רשימת analyst_predictions
    לשימוש ב-calculate_consensus(prediction_final, analyst_predictions).

    מדמה 10 אנליסטים מדומים על-פי חלוקת האחוזים.
    win_rate=0.54 = ממוצע מציאותי של tipster ב-OLBG.
    """
    N = 10
    predictions = []
    for outcome, pct in consensus.items():
        count      = round(N * pct)
        confidence = max(1, min(10, round(pct * 10)))
        for _ in range(count):
            predictions.append({
                "outcome":    outcome,
                "win_rate":   0.54,
                "confidence": confidence,
            })
    return predictions
