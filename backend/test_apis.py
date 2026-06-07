"""
360SCOUT — API Connection Tester
הרץ: python test_apis.py
בודק שכל 3 ה-APIs עובדים ומציג נתונים אמיתיים
"""

import asyncio
import httpx
import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Windows UTF-8 fix
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

load_dotenv()

API_FOOTBALL_KEY = os.getenv("API_FOOTBALL_KEY", "")
OPENWEATHER_KEY  = os.getenv("OPENWEATHER_KEY", "")
ODDS_API_KEY     = os.getenv("ODDS_API_KEY", "")


def header(title: str):
    print(f"\n{'='*50}")
    print(f"  {title}")
    print(f"{'='*50}")


def ok(msg):  print(f"  ✅ {msg}")
def err(msg): print(f"  ❌ {msg}")
def info(msg):print(f"  ℹ️  {msg}")


async def test_api_football():
    header("1️⃣  API-Football")

    if not API_FOOTBALL_KEY or API_FOOTBALL_KEY == "your_api_football_key_here":
        err("מפתח חסר! הוסף API_FOOTBALL_KEY לקובץ .env")
        return False

    async with httpx.AsyncClient(timeout=15) as client:
        # בדיקת status
        try:
            r = await client.get(
                "https://v3.football.api-sports.io/status",
                headers={"x-apisports-key": API_FOOTBALL_KEY}
            )
            data = r.json()
            account = data.get("response", {}).get("account", {})
            requests = data.get("response", {}).get("requests", {})

            ok(f"חיבור תקין! מנוי: {account.get('plan', 'Free')}")
            ok(f"קריאות היום: {requests.get('current', 0)} / {requests.get('limit_day', 100)}")
        except Exception as e:
            err(f"שגיאת חיבור: {e}")
            return False

        # משחקים קרובים
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

            r = await client.get(
                "https://v3.football.api-sports.io/fixtures",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"from": today, "to": tomorrow, "status": "NS"}
            )
            fixtures = r.json().get("response", [])
            ok(f"משחקים מחר: {len(fixtures)} נמצאו")

            if fixtures:
                print("\n  📅 דוגמה למשחקים:")
                for f in fixtures[:5]:
                    home = f["teams"]["home"]["name"]
                    away = f["teams"]["away"]["name"]
                    league = f["league"]["name"]
                    date = f["fixture"]["date"][:16].replace("T", " ")
                    print(f"     {home} נגד {away} | {league} | {date}")
        except Exception as e:
            err(f"שגיאה במשיכת משחקים: {e}")

    return True


async def test_openweather():
    header("2️⃣  OpenWeatherMap")

    if not OPENWEATHER_KEY or OPENWEATHER_KEY == "your_openweather_key_here":
        err("מפתח חסר! הוסף OPENWEATHER_KEY לקובץ .env")
        return False

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"q": "Tel Aviv", "appid": OPENWEATHER_KEY, "units": "metric"}
            )
            if r.status_code == 401:
                err("מפתח לא תקין — בדוק שהמפתח נכון")
                return False

            data = r.json()
            main = data.get("main", {})
            weather = data.get("weather", [{}])[0]

            ok(f"חיבור תקין!")
            ok(f"תל אביב כרגע: {main.get('temp', '?')}°C, {weather.get('description', '')}")
            ok(f"לחות: {main.get('humidity', '?')}%")
        except Exception as e:
            err(f"שגיאת חיבור: {e}")
            return False

    return True


async def test_odds_api():
    header("3️⃣  The Odds API")

    if not ODDS_API_KEY or ODDS_API_KEY == "your_odds_api_key_here":
        err("מפתח חסר! הוסף ODDS_API_KEY לקובץ .env")
        return False

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                "https://api.the-odds-api.com/v4/sports/soccer/odds",
                params={
                    "apiKey": ODDS_API_KEY,
                    "regions": "eu",
                    "markets": "h2h",
                    "oddsFormat": "decimal",
                }
            )
            if r.status_code == 401:
                err("מפתח לא תקין")
                return False

            events = r.json()
            remaining = r.headers.get("x-requests-remaining", "?")
            ok(f"חיבור תקין! קריאות שנותרו: {remaining}")
            ok(f"משחקים עם יחסים: {len(events)}")

            if events:
                print("\n  💰 דוגמה ליחסים:")
                for e in events[:3]:
                    home = e.get("home_team", "")
                    away = e.get("away_team", "")
                    bm = e.get("bookmakers", [{}])[0] if e.get("bookmakers") else {}
                    markets = bm.get("markets", [{}])[0] if bm.get("markets") else {}
                    outcomes = {o["name"]: o["price"] for o in markets.get("outcomes", [])}
                    print(f"     {home} נגד {away}")
                    print(f"     בית: {outcomes.get(home, '?')} | תיקו: {outcomes.get('Draw', '?')} | אורחים: {outcomes.get(away, '?')}")
        except Exception as e:
            err(f"שגיאת חיבור: {e}")
            return False

    return True


async def main():
    print("\n🔍 360SCOUT — בדיקת חיבורי API")
    print(f"   {datetime.now().strftime('%d/%m/%Y %H:%M')}")

    r1 = await test_api_football()
    r2 = await test_openweather()
    r3 = await test_odds_api()

    header("📊 סיכום")
    results = [
        ("API-Football", r1),
        ("OpenWeatherMap", r2),
        ("The Odds API", r3),
    ]
    for name, ok_result in results:
        status = "✅ מחובר" if ok_result else "❌ לא מחובר"
        print(f"  {status} — {name}")

    all_ok = all(r for _, r in results)
    if all_ok:
        print("\n  🚀 הכל מחובר! האתר מוכן לנתונים אמיתיים.")
    else:
        print("\n  ⚠️  יש להשלים את המפתחות החסרים בקובץ .env")


if __name__ == "__main__":
    asyncio.run(main())
