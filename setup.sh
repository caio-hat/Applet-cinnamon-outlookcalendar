#!/usr/bin/env bash
# setup.sh - instala o Outlook Next Meeting Cinnamon applet (multi-calendario)
set -euo pipefail

APPLET_UUID="outlook-calendar@caio-hat"
APPLET_INSTALL_DIR="$HOME/.local/share/cinnamon/applets/$APPLET_UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "================================================"
echo "  Outlook Calendar Applet - Instalacao"
echo "================================================"
echo ""

# ── 1) Python deps ────────────────────────────────────────────────────────────
have_deps() {
    python3 -c "import icalendar, recurring_ical_events" 2>/dev/null
}

if have_deps; then
    echo "PASSO 1: Dependencias Python ja instaladas. Pulando."
else
    echo "PASSO 1: Instalando dependencias Python..."
    installed=0

    # Try apt first (Debian/Ubuntu/Mint) - this is the recommended path
    if command -v apt-get >/dev/null 2>&1; then
        echo "  Tentando via apt (recomendado em Mint/Ubuntu)..."
        echo "  Vai pedir sua senha para sudo:"
        if sudo apt-get install -y python3-icalendar python3-recurring-ical-events python3-dateutil 2>/dev/null; then
            if have_deps; then
                echo "  OK - instalado via apt."
                installed=1
            fi
        fi
    fi

    # Fallback: pip --break-system-packages (PEP 668 workaround)
    if [ "$installed" -eq 0 ]; then
        echo "  apt nao funcionou. Tentando pip3 --user..."
        if pip3 install --user --break-system-packages icalendar recurring-ical-events 2>/dev/null \
           || pip3 install --user icalendar recurring-ical-events 2>/dev/null; then
            if have_deps; then
                echo "  OK - instalado via pip."
                installed=1
            fi
        fi
    fi

    if [ "$installed" -eq 0 ]; then
        echo ""
        echo "  AVISO: nao consegui instalar icalendar/recurring-ical-events automaticamente."
        echo "  O applet vai funcionar, mas reunioes RECORRENTES (semanais, diarias) NAO aparecerao."
        echo ""
        echo "  Para instalar manualmente:"
        echo "    sudo apt install python3-icalendar python3-recurring-ical-events"
        echo ""
    fi
fi
echo ""

# ── 2) Install applet files ──────────────────────────────────────────────────────
echo "PASSO 2: Instalando applet em $APPLET_INSTALL_DIR..."
mkdir -p "$APPLET_INSTALL_DIR"
for f in metadata.json applet.js stylesheet.css settings-schema.json fetch_meetings.py; do
    cp "$SCRIPT_DIR/$f" "$APPLET_INSTALL_DIR/"
done
chmod +x "$APPLET_INSTALL_DIR/fetch_meetings.py"
echo "  OK."
echo ""

# ── 3) Instructions ─────────────────────────────────────────────────────────────────
echo "================================================"
echo "  Instalacao concluida!"
echo "================================================"
echo ""
echo "Proximos passos:"
echo ""
echo "  1) Adicionar o applet ao painel:"
echo "     - Clique direito no painel do Cinnamon"
echo "     - 'Add applets to the panel' (ou 'Applets')"
echo "     - Procure 'Outlook Next Meeting' e clique no '+'"
echo ""
echo "  2) Configurar seus calendarios:"
echo "     - Clique direito no applet ja no painel"
echo "     - 'Configure...'"
echo "     - Aba 'Geral' > Calendarios > '+'"
echo "     - Adicione nome, URL ICS, cor e marque 'Ativo'"
echo "     - Pode adicionar quantos calendarios quiser"
echo ""
echo "Como obter a URL ICS (Outlook):"
echo "  Calendar -> Settings (engrenagem) -> View all Outlook settings"
echo "  -> Calendar -> Shared calendars -> Publish a calendar"
echo "  -> escolha o calendario -> Publish -> copie o link ICS"
echo ""
echo "Para reinstalar futuras versoes:"
echo "  cd $SCRIPT_DIR && git pull && bash setup.sh"
echo ""
