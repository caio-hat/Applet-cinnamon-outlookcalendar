#!/usr/bin/env bash
# setup.sh – installs the Outlook Next Meeting Cinnamon applet
set -euo pipefail

APPLET_UUID="outlook-calendar@caio-hat"
APPLET_INSTALL_DIR="$HOME/.local/share/cinnamon/applets/$APPLET_UUID"
CONFIG_DIR="$HOME/.config/outlook-calendar-applet"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "================================================"
echo "  Outlook Next Meeting Applet – Configuração"
echo "================================================"
echo ""
echo "PASSO 1: Criar Azure AD App Registration"
echo "-----------------------------------------"
echo "Você precisa registrar um aplicativo no Azure para que o applet"
echo "possa acessar seu calendário do Outlook."
echo ""
echo "  1. Acesse: https://portal.azure.com"
echo "  2. Vá em: Azure Active Directory > App registrations > New registration"
echo "  3. Preencha:"
echo "       Nome: OutlookCalendarApplet  (pode ser qualquer nome)"
echo "       Tipos de conta suportados:"
echo "         'Accounts in any organizational directory"
echo "          and personal Microsoft accounts'"
echo "       Redirect URI: Public client/native > http://localhost"
echo "  4. Após criar, vá em 'API permissions' e adicione:"
echo "       Microsoft Graph > Delegated > Calendars.Read"
echo "       Microsoft Graph > Delegated > User.Read"
echo "  5. Em 'Authentication' habilite:"
echo "       'Allow public client flows'  (necessário para device code)"
echo ""
read -rp "Pressione ENTER quando terminar de configurar o App Registration..."
echo ""

echo "PASSO 2: Credenciais"
echo "---------------------"
read -rp "Client ID (Application ID): " CLIENT_ID
read -rp "Tenant ID (ou 'common' para conta pessoal/mista): " TENANT_ID
echo ""

echo "PASSO 3: Instalando dependência Python (msal)..."
pip3 install --user msal
echo ""

echo "PASSO 4: Salvando configuração..."
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/config.json" << CONFIGEOF
{
    "client_id": "$CLIENT_ID",
    "tenant_id": "$TENANT_ID"
}
CONFIGEOF
echo "Configuração salva em $CONFIG_DIR/config.json"
echo ""

echo "PASSO 5: Instalando applet no Cinnamon..."
mkdir -p "$APPLET_INSTALL_DIR"
for f in metadata.json applet.js stylesheet.css fetch_meetings.py; do
    cp "$SCRIPT_DIR/$f" "$APPLET_INSTALL_DIR/"
done
chmod +x "$APPLET_INSTALL_DIR/fetch_meetings.py"
echo "Applet instalado em $APPLET_INSTALL_DIR"
echo ""

echo "PASSO 6: Autenticação com sua conta Microsoft..."
python3 "$APPLET_INSTALL_DIR/fetch_meetings.py" --login
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
echo "Para recarregar o Cinnamon após futuras atualizações:"
echo "  cinnamon --replace &"
echo ""
