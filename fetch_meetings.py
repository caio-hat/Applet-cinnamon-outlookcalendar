#!/usr/bin/env python3
"""Fetch the next Outlook calendar events via Microsoft Graph API.

Usage (normal – called by the applet):
    python3 fetch_meetings.py
    Outputs one line of JSON: {"meetings": [...]} or {"error": "..."}

Usage (first-time login):
    python3 fetch_meetings.py --login
    Opens a device-code browser flow to authenticate.
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

CONFIG_DIR       = os.path.expanduser("~/.config/outlook-calendar-applet")
TOKEN_CACHE_FILE = os.path.join(CONFIG_DIR, "token_cache.json")
CONFIG_FILE      = os.path.join(CONFIG_DIR, "config.json")
SCOPES           = ["Calendars.Read", "User.Read"]


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_config():
    if not os.path.exists(CONFIG_FILE):
        return None
    with open(CONFIG_FILE) as fh:
        return json.load(fh)


def load_cache():
    import msal
    cache = msal.SerializableTokenCache()
    if os.path.exists(TOKEN_CACHE_FILE):
        with open(TOKEN_CACHE_FILE) as fh:
            cache.deserialize(fh.read())
    return cache


def save_cache(cache):
    if cache.has_state_changed:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(TOKEN_CACHE_FILE, "w") as fh:
            fh.write(cache.serialize())


def build_msal_app(config, cache):
    import msal
    return msal.PublicClientApplication(
        config["client_id"],
        authority=f"https://login.microsoftonline.com/{config.get('tenant_id', 'common')}",
        token_cache=cache,
    )


def acquire_token_silently(app):
    accounts = app.get_accounts()
    if not accounts:
        return None
    result = app.acquire_token_silent(SCOPES, account=accounts[0])
    return result.get("access_token") if result else None


def parse_graph_dt(dt_str):
    """Parse a Graph API UTC datetime string (no trailing Z) into an aware datetime."""
    if "." in dt_str:
        base, frac = dt_str.split(".", 1)
        dt_str = base + "." + frac[:6]          # keep at most microseconds
    return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)


# ── Fetch command (used by the applet) ───────────────────────────────────────

def cmd_fetch():
    try:
        import msal  # noqa: F401
    except ImportError:
        print(json.dumps({"error": "Execute setup.sh para instalar dependências"}))
        return

    config = load_config()
    if not config:
        print(json.dumps({"error": "Não configurado. Execute setup.sh"}))
        return

    cache = load_cache()
    app   = build_msal_app(config, cache)
    token = acquire_token_silently(app)
    save_cache(cache)

    if not token:
        print(json.dumps({"error": "Não autenticado. Execute: python3 fetch_meetings.py --login"}))
        return

    try:
        meetings = fetch_calendar_events(token)
        print(json.dumps({"meetings": meetings}))
    except Exception as exc:
        print(json.dumps({"error": f"Erro na API: {exc}"}))


def fetch_calendar_events(token):
    now = datetime.now(timezone.utc)
    end = now + timedelta(hours=24)

    params = urllib.parse.urlencode({
        "startDateTime": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endDateTime":   end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "$orderby":      "start/dateTime",
        "$top":          "10",
        "$select":       "subject,start,end,location,isAllDay,isCancelled",
    })
    url = f"https://graph.microsoft.com/v1.0/me/calendarView?{params}"

    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    # Ask Graph to return all times in UTC so we avoid Windows timezone name mapping
    req.add_header("Prefer", 'outlook.timezone="UTC"')

    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())

    meetings = []
    for event in data.get("value", []):
        if event.get("isCancelled") or event.get("isAllDay"):
            continue

        start_dt = parse_graph_dt(event["start"]["dateTime"])
        end_dt   = parse_graph_dt(event["end"]["dateTime"])

        if end_dt <= now:           # skip meetings that already ended
            continue

        loc      = event.get("location") or {}
        location = loc.get("displayName", "") if isinstance(loc, dict) else ""

        meetings.append({
            "subject":  event.get("subject") or "Sem título",
            "start":    start_dt.isoformat().replace("+00:00", "Z"),
            "end":      end_dt.isoformat().replace("+00:00", "Z"),
            "location": location,
        })

    return meetings[:5]


# ── Login command (run once to authenticate) ──────────────────────────────────

def cmd_login():
    try:
        import msal  # noqa: F401
    except ImportError:
        print("msal não instalado. Execute: pip3 install --user msal")
        sys.exit(1)

    config = load_config()
    if not config:
        print("Configuração não encontrada. Execute setup.sh primeiro.")
        sys.exit(1)

    cache  = load_cache()
    app    = build_msal_app(config, cache)
    flow   = app.initiate_device_flow(scopes=SCOPES)

    if "user_code" not in flow:
        print("Erro ao iniciar autenticação:", flow)
        sys.exit(1)

    print(flow["message"])          # prints the URL + user code
    print()

    result = app.acquire_token_by_device_flow(flow)
    save_cache(cache)

    if "access_token" in result:
        print("Login realizado com sucesso!")
    else:
        print("Erro:", result.get("error_description", result))
        sys.exit(1)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch Outlook meetings for Cinnamon applet")
    parser.add_argument("--login", action="store_true",
                        help="Authenticate via device code flow (run once)")
    args = parser.parse_args()
    (cmd_login if args.login else cmd_fetch)()
