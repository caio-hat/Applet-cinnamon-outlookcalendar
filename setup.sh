#!/usr/bin/env bash
# setup.sh – installs the Outlook Next Meeting Cinnamon applet (ICS mode, no Azure AD)
set -euo pipefail

APPLET_UUID="outlook-calendar@caio-hat"
APPLET_INSTALL_DIR="$HOME/.local/share/cinnamon/applets/$APPLET_UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "================================================"
echo "  Outlook Next Meeting Applet – Instalação"
echo "================================================"
echo ""

echo "PASSO 1: Instalando dependência Python (icalendar)..."
if pip3 install --user icalendar 2>/dev/null; then
    echo "  icalendar instalado com sucesso."
else
    echo "  Aviso: pip3 falhou. O applet usará o parser interno (sem icalendar)."
fi
echo ""

echo "PASSO 2: Instalando applet no Cinnamon..."
mkdir -p "$APPLET_INSTALL_DIR"
for f in metadata.json applet.js stylesheet.css fetch_meetings.py; do
    cp "$SCRIPT_DIR/$f" "$APPLET_INSTALL_DIR/"
done
chmod +x "$APPLET_INSTALL_DIR/fetch_meetings.py"
echo "  Applet instalado em $APPLET_INSTALL_DIR"
echo ""

echo "PASSO 3: Configurar URL ICS do Outlook..."
python3 "$APPLET_INSTALL_DIR/fetch_meetings.py" --setup
echo ""

echo "================================================"
echo "  Instalação concluída!"
echo "================================================"
echo ""
echo "Para adicionar o applet ao painel:"
echo "  1. Clique direito no painel do Cinnamon"
echo "  2. Selecione 'Add applets to the panel'"
echo "  3. Procure por 'Outlook Next Meeting'"
echo "  4. Clique no '+' para adicionar"
echo ""
echo "Para atualizar o applet no futuro:"
echo "  bash $SCRIPT_DIR/setup.sh"
echo ""
