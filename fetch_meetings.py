#!/usr/bin/env python3
"""Fetch upcoming Outlook meetings from a public ICS/iCal subscription URL.

How to get your Outlook ICS URL:
  Outlook.com  : Calendar → Settings (gear) → View all Outlook settings
                 → Calendar → Shared calendars → Publish a calendar
                 → choose calendar → Publish → copy the ICS link
  Microsoft 365: Outlook Web → Calendar → Settings → Shared calendars
                 → Publish calendar → copy the ICS link

Usage:
  Normal (called by the applet):
    python3 fetch_meetings.py
    -> prints one JSON line: {"meetings": [...]} or {"error": "..."}

  First-time setup (interactive):
    python3 fetch_meetings.py --setup
"""

import argparse
import json
import os
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

CONFIG_DIR  = os.path.expanduser("~/.config/outlook-calendar-applet")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")


# ── Config helpers ─────────────────────────────────────────────────────────────

def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE) as fh:
        return json.load(fh)


def save_config(data):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w") as fh:
        json.dump(data, fh, indent=2)


# ── ICS fetching ───────────────────────────────────────────────────────────────

def fetch_ics(url):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "OutlookCalendarCinnamonApplet/1.0")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


# ── ICS parsing ───────────────────────────────────────────────────────────────

def _to_aware_dt(value):
    """Convert a date or datetime from icalendar into a UTC-aware datetime."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, date):
        # all-day event – caller should skip these
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    return None


def parse_meetings_icalendar(ics_bytes):
    """Parse ICS data using the 'icalendar' library."""
    from icalendar import Calendar

    cal  = Calendar.from_ical(ics_bytes)
    now  = datetime.now(timezone.utc)
    end_window = now + timedelta(hours=24)
    meetings = []

    for component in cal.walk("VEVENT"):
        status = str(component.get("STATUS", "")).upper()
        if status == "CANCELLED":
            continue

        dtstart = component.get("DTSTART")
        dtend   = component.get("DTEND")
        if not dtstart:
            continue

        start_dt = _to_aware_dt(dtstart.dt)
        end_dt   = _to_aware_dt(dtend.dt) if dtend else None

        # skip all-day events (date, not datetime)
        if not isinstance(dtstart.dt, datetime):
            continue

        if end_dt and end_dt <= now:
            continue
        if start_dt > end_window:
            continue

        meetings.append({
            "subject":  str(component.get("SUMMARY",  "") or "Sem título"),
            "start":    start_dt.isoformat().replace("+00:00", "Z"),
            "end":      end_dt.isoformat().replace("+00:00", "Z") if end_dt else "",
            "location": str(component.get("LOCATION", "") or ""),
        })

    meetings.sort(key=lambda m: m["start"])
    return meetings[:5]


def parse_meetings_builtin(ics_bytes):
    """Minimal ICS parser (no external deps) – used when icalendar is not installed."""
    import re

    text   = ics_bytes.decode("utf-8", errors="replace")
    # unfold continued lines (RFC 5545 §3.1)
    text   = re.sub(r"\r?\n[ \t]", "", text)
    now    = datetime.now(timezone.utc)
    end_w  = now + timedelta(hours=24)
    meetings = []

    for block in re.split(r"BEGIN:VEVENT", text)[1:]:
        block = block.split("END:VEVENT")[0]

        def get(prop):
            m = re.search(rf"^{prop}(?:;[^:\n]*)?:(.+)$", block, re.MULTILINE)
            return m.group(1).strip() if m else ""

        if get("STATUS").upper() == "CANCELLED":
            continue

        raw_start = get("DTSTART")
        raw_end   = get("DTEND")

        if not raw_start or len(raw_start) < 8:
            continue
        # skip all-day (DATE only, 8 chars like 20240115)
        if len(raw_start) == 8:
            continue

        def parse_dt(s):
            s = s.rstrip("Z")
            s = re.sub(r"[^0-9T]", "", s)
            try:
                return datetime.strptime(s, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
            except ValueError:
                return None

        start_dt = parse_dt(raw_start)
        end_dt   = parse_dt(raw_end) if raw_end else None

        if not start_dt:
            continue
        if end_dt and end_dt <= now:
            continue
        if start_dt > end_w:
            continue

        meetings.append({
            "subject":  get("SUMMARY")  or "Sem título",
            "start":    start_dt.isoformat().replace("+00:00", "Z"),
            "end":      end_dt.isoformat().replace("+00:00", "Z") if end_dt else "",
            "location": get("LOCATION"),
        })

    meetings.sort(key=lambda m: m["start"])
    return meetings[:5]


def parse_meetings(ics_bytes):
    try:
        import icalendar  # noqa: F401
        return parse_meetings_icalendar(ics_bytes)
    except ImportError:
        return parse_meetings_builtin(ics_bytes)


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_fetch():
    config  = load_config()
    ics_url = config.get("ics_url", "").strip()

    if not ics_url:
        print(json.dumps({"error": "URL ICS não configurada. Execute: python3 fetch_meetings.py --setup"}))
        return

    try:
        ics_bytes = fetch_ics(ics_url)
    except Exception as exc:
        print(json.dumps({"error": f"Erro ao buscar calendário: {exc}"}))
        return

    try:
        meetings = parse_meetings(ics_bytes)
        print(json.dumps({"meetings": meetings}))
    except Exception as exc:
        print(json.dumps({"error": f"Erro ao parsear ICS: {exc}"}))


def cmd_setup():
    print("=== Configuração do Outlook Calendar Applet ===")
    print()
    print("Você precisa da URL ICS do seu calendário do Outlook.")
    print()
    print("Como obter a URL (Outlook.com / conta pessoal):")
    print("  1. Acesse outlook.com e vá em Calendar")
    print("  2. Clique no ⚙ (Configurações) > View all Outlook settings")
    print("  3. Calendar > Shared calendars > Publish a calendar")
    print("  4. Escolha seu calendário, clique em Publish")
    print("  5. Copie o link ICS")
    print()
    print("Como obter a URL (Microsoft 365 / conta corporativa):")
    print("  1. Acesse outlook.office.com e vá em Calendar")
    print("  2. Clique no ⚙ > View all Outlook settings")
    print("  3. Calendar > Shared calendars > Publish a calendar")
    print("  4. Escolha o calendário e publique")
    print("  5. Copie o link ICS")
    print()

    ics_url = input("Cole aqui a URL ICS: ").strip()
    if not ics_url.startswith("http"):
        print("URL inválida.")
        sys.exit(1)

    print()
    print("Testando a URL...")
    try:
        ics_bytes = fetch_ics(ics_url)
        meetings  = parse_meetings(ics_bytes)
        print(f"OK! {len(meetings)} reuniões encontradas nas próximas 24h.")
    except Exception as exc:
        print(f"Erro ao acessar a URL: {exc}")
        sys.exit(1)

    config = load_config()
    config["ics_url"] = ics_url
    save_config(config)
    print(f"Configuração salva em {CONFIG_FILE}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Outlook Calendar ICS fetcher for Cinnamon applet")
    parser.add_argument("--setup", action="store_true",
                        help="Interactive first-time configuration")
    args = parser.parse_args()
    (cmd_setup if args.setup else cmd_fetch)()
