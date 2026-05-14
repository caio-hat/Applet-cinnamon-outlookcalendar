#!/usr/bin/env bash
# setup.sh - installs the Outlook Next Meeting Cinnamon applet
set -euo pipefail

APPLET_UUID="outlook-calendar@caio-hat"
APPLET_INSTALL_DIR="$HOME/.local/share/cinnamon/applets/$APPLET_UUID"
LOCALE_BASE_DIR="$HOME/.local/share/locale"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "================================================"
echo "  Outlook Calendar Applet - Setup"
echo "================================================"
echo ""

# ── 1) Python deps ───────────────────────────────────────────────────────────────
have_py_deps() {
    python3 -c "import icalendar, recurring_ical_events" 2>/dev/null
}

if have_py_deps; then
    echo "STEP 1: Python deps already installed. Skipping."
else
    echo "STEP 1: Installing Python deps..."
    installed=0
    if command -v apt-get >/dev/null 2>&1; then
        echo "  Trying via apt (recommended on Mint/Ubuntu)..."
        echo "  Will ask for sudo password:"
        if sudo apt-get install -y python3-icalendar python3-recurring-ical-events python3-dateutil 2>/dev/null; then
            if have_py_deps; then
                echo "  OK - installed via apt."
                installed=1
            fi
        fi
    fi
    if [ "$installed" -eq 0 ]; then
        echo "  Trying pip3 --user..."
        if pip3 install --user --break-system-packages icalendar recurring-ical-events 2>/dev/null \
           || pip3 install --user icalendar recurring-ical-events 2>/dev/null; then
            if have_py_deps; then
                echo "  OK - installed via pip."
                installed=1
            fi
        fi
    fi
    if [ "$installed" -eq 0 ]; then
        echo ""
        echo "  WARNING: could not install icalendar/recurring-ical-events automatically."
        echo "  The applet will work, but RECURRING meetings will NOT appear."
        echo "  Manual install:"
        echo "    sudo apt install python3-icalendar python3-recurring-ical-events"
        echo ""
    fi
fi
echo ""

# ── 2) Compile translations (po/*.po → .mo) ────────────────────────────────────────────
echo "STEP 2: Compiling translations..."
if [ -d "$SCRIPT_DIR/po" ]; then
    if command -v msgfmt >/dev/null 2>&1; then
        compiled=0
        for po in "$SCRIPT_DIR"/po/*.po; do
            [ -f "$po" ] || continue
            lang="$(basename "$po" .po)"
            mo_dir="$LOCALE_BASE_DIR/$lang/LC_MESSAGES"
            mkdir -p "$mo_dir"
            if msgfmt "$po" -o "$mo_dir/$APPLET_UUID.mo" 2>/dev/null; then
                echo "  → $lang installed at $mo_dir/$APPLET_UUID.mo"
                compiled=$((compiled + 1))
            else
                echo "  ! Failed to compile $lang"
            fi
        done
        if [ "$compiled" -eq 0 ]; then
            echo "  (no .po files found)"
        fi
    else
        echo "  WARNING: msgfmt not found. Install with:  sudo apt install gettext"
        echo "  Translations skipped (applet will use English source strings)."
    fi
else
    echo "  (no po/ directory)"
fi
echo ""

# ── 3) Install applet files ────────────────────────────────────────────────────────────
echo "STEP 3: Installing applet to $APPLET_INSTALL_DIR..."
mkdir -p "$APPLET_INSTALL_DIR"
for f in metadata.json applet.js stylesheet.css settings-schema.json fetch_meetings.py; do
    cp "$SCRIPT_DIR/$f" "$APPLET_INSTALL_DIR/"
done
# Also copy po/ for reference (some Cinnamon versions can read it directly).
if [ -d "$SCRIPT_DIR/po" ]; then
    cp -r "$SCRIPT_DIR/po" "$APPLET_INSTALL_DIR/"
fi
chmod +x "$APPLET_INSTALL_DIR/fetch_meetings.py"
echo "  OK."
echo ""

# ── 4) Instructions ──────────────────────────────────────────────────────────────────
echo "================================================"
echo "  Setup complete!"
echo "================================================"
echo ""
echo "Next steps:"
echo ""
echo "  1) Add the applet to the panel:"
echo "     - Right-click the Cinnamon panel"
echo "     - 'Add applets to the panel' (or 'Applets')"
echo "     - Look for 'Outlook Next Meeting' and click '+'"
echo ""
echo "  2) Configure your calendars:"
echo "     - Right-click the applet in the panel  -> 'Configure...'"
echo "       (or click the applet -> Settings)"
echo "     - 'General' tab > Calendars > '+' button"
echo "     - Add name, ICS URL, color (hex like #1e88e5) and check 'Active'"
echo ""
echo "  Apply changes (live):  cinnamon --replace &"
echo ""
echo "How to get the ICS URL (Outlook on the web):"
echo "  Calendar -> Settings (gear) -> View all Outlook settings"
echo "  -> Calendar -> Shared calendars -> Publish a calendar"
echo "  -> pick the calendar -> Publish -> copy the ICS link"
echo ""
echo "Translations:"
echo "  This applet detects your system language ($LANG) automatically."
echo "  To contribute a translation, see  po/outlook-calendar@caio-hat.pot"
echo ""
echo "To update later:"
echo "  cd $SCRIPT_DIR && git pull && bash setup.sh"
echo ""
