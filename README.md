# Outlook Next Meeting — Applet para Cinnamon

Applet para Linux Mint / Cinnamon que mostra sua **próxima reunião do Outlook** na barra do painel, agrupa as próximas reuniões em janelas de 24h / 3 dias / 7 dias num popup, e dispara uma notificação antes do horário.

Funciona com a **URL ICS pública** que o próprio Outlook gera para publicar o calendário. **Não precisa de Azure AD, OAuth ou login Microsoft.**

---

## Funcionalidades

- **Próxima reunião na barra**: nome + horário exibidos no painel, com atualização automática
- **Notificação automática** antes do início (padrão: 30 minutos)
- **Múltiplos calendários** — pessoal, trabalho, time, etc. — cada um com sua cor própria
- **Popup detalhado** ao clicar:
  - Próxima reunião destacada com contagem regressiva ao vivo
  - 3 seções colapsáveis: próximas 24 horas, 3 dias e 7 dias
- **Click para entrar**: reuniões com link do Teams/Meet/Zoom abrem direto no navegador
- **Toggle de visibilidade**: switch para esconder o texto da barra quando você estiver compartilhando a tela
- **Eventos recorrentes** (RRULE) corretamente expandidos — reuniões semanais, daily, etc.
- **Configuração gráfica nativa** do Cinnamon (clique direito → Configure)
- **Sem OAuth, sem servidor, sem login Microsoft**

---

## Pré-requisitos

- Linux Mint 20+ ou outra distro com **Cinnamon 4.6+**
- **Python 3.8+** (já vem no Mint)
- `notify-send` (pacote `libnotify-bin`, geralmente já instalado)
- Acesso à internet (para buscar o ICS do Outlook)

### Dependências Python

| Pacote | Para quê |
|---|---|
| `icalendar` | Parser robusto de arquivos ICS |
| `recurring-ical-events` | Expansão de eventos recorrentes (RRULE) |
| `python-dateutil` | Manipulação de datas e timezones |

O `setup.sh` instala tudo isso automaticamente, preferindo o `apt` do sistema.

---

## Instalação

```bash
git clone https://github.com/caio-hat/Applet-cinnamon-outlookcalendar.git
cd Applet-cinnamon-outlookcalendar
bash setup.sh
```

O `setup.sh` vai:

1. Instalar as dependências Python (`sudo apt install python3-icalendar python3-recurring-ical-events python3-dateutil`)
2. Copiar os arquivos do applet para `~/.local/share/cinnamon/applets/outlook-calendar@caio-hat/`
3. Imprimir as instruções para adicionar o applet ao painel

### Adicionar ao painel

1. Clique direito no painel do Cinnamon
2. Selecione **Add applets to the panel** (ou **Applets**)
3. Procure por **Outlook Next Meeting**
4. Clique no `+` para adicionar

> Se o applet não aparecer logo na lista, recarregue o Cinnamon com `Ctrl+Alt+Esc` ou executando `cinnamon --replace &` num terminal.

---

## Como obter sua URL ICS no Outlook

A URL ICS é um link com um token embutido que publica seu calendário para leitura. Você precisa de **uma URL para cada calendário** que quiser exibir.

### Outlook.com (conta pessoal)

1. Acesse [outlook.com](https://outlook.com) e abra o **Calendário**
2. Engrenagem (⚙) → **View all Outlook settings**
3. **Calendar → Shared calendars → Publish a calendar**
4. Escolha o calendário, selecione **Can view all details** e clique em **Publish**
5. Copie o link que termina em `.ics`

### Microsoft 365 / conta corporativa

1. Acesse [outlook.office.com](https://outlook.office.com) → **Calendar**
2. Engrenagem (⚙) → **View all Outlook settings**
3. **Calendar → Shared calendars → Publish a calendar**
4. Mesmo fluxo acima

> Se a opção **Publish a calendar** não aparecer na conta corporativa, é porque o admin do tenant desabilitou. Peça para o TI habilitar a publicação externa de calendário para a sua conta.

---

## Configuração do applet

### Adicionar calendários

1. Clique direito no applet **Outlook Next Meeting** no painel
2. Selecione **Configure...**
3. Aba **Geral → Calendários** → clique em **+**
4. Preencha:
   - **Nome**: rótulo para identificar (ex.: "Trabalho", "Pessoal")
   - **URL ICS**: cole o link copiado do Outlook
   - **Cor**: bolinha que vai aparecer ao lado da reunião no popup
   - **Ativo**: marque para habilitar
5. Repita para quantos calendários precisar

As mudanças são aplicadas imediatamente — não precisa reiniciar nada.

### Outras opções de configuração

**Aba Geral → Painel:**
| Opção | Padrão | Para quê |
|---|---|---|
| Mostrar próxima reunião na barra | Ligado | Switch global de exibição (espelhado no popup) |
| Tamanho máximo do texto na barra | 40 caracteres | Trunca títulos longos com `…` |

**Aba Avançado → Notificações:**
| Opção | Padrão | Para quê |
|---|---|---|
| Enviar notificação antes da reunião | Ligado | Liga/desliga as notificações |
| Antecedencia da notificação | 30 min | Quantos minutos antes da reunião |

**Aba Avançado → Atualização:**
| Opção | Padrão | Para quê |
|---|---|---|
| Intervalo de atualização | 5 min | De quanto em quanto tempo o applet busca o calendário |

---

## Uso

### Barra do painel

O texto na barra mostra o nome e o horário da próxima reunião:

```
[ícone]  Daily Standup  14:30
```

Quando não há reuniões nas próximas 24h, mostra **Sem reuniões**.

### Popup ao clicar

```
● Daily Standup
  em 23 min · 14:30 - 15:00 · Microsoft Teams
───────────────────────────────────────────
▾ Próximas 24 horas (3)
   ● 14:30  Daily Standup  🔗
   ● 16:00  1:1 com gerente
   ● 18:00  Review sprint
▸ Próximos 3 dias (8)
▸ Próximos 7 dias (15)
───────────────────────────────────────────
[✓] Exibir na barra
↻  Atualizar agora
⚙  Configurações
```

- A **bolinha colorida** (`●`) indica de qual calendário a reunião veio
- A **próxima reunião** fica em destaque no topo com contagem regressiva (atualiza a cada 30s)
- Reuniões com **🔗** têm link de entrar — clique para abrir Teams/Meet/Zoom no navegador
- Seção **24 horas** abre por padrão; **3 dias** e **7 dias** ficam colapsadas — clique para expandir
- Nas seções de 3 e 7 dias, as reuniões ficam agrupadas por dia

### Toggle "Exibir na barra"

Útil quando você está **compartilhando a tela** e não quer expor o título de uma reunião sensível. O switch no popup esconde o texto da barra mas mantém o ícone clicável para você continuar consultando.

### Notificação

No intervalo configurado (padrão 30 minutos), cada reunião dispara uma notificação do sistema via `notify-send`. A notificação aparece uma única vez por evento.

---

## Solução de problemas

### "0 reuniões" mesmo tendo reuniões agendadas

Quase certamente o `python3-recurring-ical-events` não está instalado e suas reuniões são recorrentes (semanais, daily, etc.). Sem a expansão de `RRULE`, eventos recorrentes ficam invisíveis.

```bash
sudo apt install python3-icalendar python3-recurring-ical-events
```

Depois clique em **Atualizar agora** no popup do applet.

### `pip` retorna "externally-managed-environment"

Isso é o PEP 668, ativo em Mint 21+ / Ubuntu 22.04+. **Use o `apt`**, não o `pip`:

```bash
sudo apt install python3-icalendar python3-recurring-ical-events python3-dateutil
```

Se realmente precisar usar pip:

```bash
pip3 install --user --break-system-packages icalendar recurring-ical-events
```

### Aparece "⚠ Outlook" na barra

Erro ao buscar ou parsear o calendário. Passe o mouse sobre o ícone para ver a mensagem completa no tooltip. Causas comuns:

- URL ICS errada ou expirada — republique pelo Outlook
- Sem conexão com a internet
- Calendário foi removido ou despublicado no Outlook
- A URL retornou HTML em vez de ICS (token inválido)

### Notificação não aparece

Verifique se `notify-send` está instalado:

```bash
which notify-send || sudo apt install libnotify-bin
```

E se notificações do sistema estão habilitadas em **Configurações do Sistema → Notificações**.

### Applet não aparece na lista de "Add applets"

Recarregue o Cinnamon:

```bash
cinnamon --replace &
```

Ou pressione `Ctrl+Alt+Esc`. Confira também se os arquivos foram instalados:

```bash
ls ~/.local/share/cinnamon/applets/outlook-calendar@caio-hat/
```

Devem estar lá: `metadata.json`, `applet.js`, `settings-schema.json`, `stylesheet.css`, `fetch_meetings.py`.

### Debug / logs

Erros do applet aparecem no log do Cinnamon:

```bash
tail -f ~/.xsession-errors
# ou
journalctl --user -f
```

Para testar o script de fetch manualmente:

```bash
echo '[{"name":"Test","url":"https://outlook.office365.com/.../calendar.ics","color":"#1e88e5","enabled":true}]' \
  | python3 ~/.local/share/cinnamon/applets/outlook-calendar@caio-hat/fetch_meetings.py
```

Deve imprimir um JSON com a lista de reuniões ou um campo `error`.

---

## Arquitetura

```
outlook-calendar@caio-hat/
├── metadata.json         # ID, nome, versão, ícone (lido pelo Cinnamon)
├── settings-schema.json  # Define a UI gráfica de configuração
├── applet.js             # Código principal em GJS (GNOME JavaScript)
├── stylesheet.css        # Estilos do popup e do label do painel
└── fetch_meetings.py     # Busca + parseia ICS, devolve JSON
```

### Fluxo de execução

1. Cinnamon carrega `applet.js` quando o applet é adicionado ao painel
2. Applet lê as configurações (calendários, intervalo, etc.) via `Settings.AppletSettings`
3. A cada N minutos (configurável), applet faz `Gio.Subprocess.new(['python3', 'fetch_meetings.py'])` e passa a lista de calendários como JSON via stdin
4. Python para cada URL:
   - Faz `urllib.request.urlopen(url)` para baixar o ICS
   - Parseia com `icalendar.Calendar.from_ical(...)`
   - Expande recorrências com `recurring_ical_events.of(cal).between(now, +7d)`
   - Extrai links de Teams/Meet/Zoom do corpo do evento com regex
   - Devolve JSON em stdout
5. Applet parseia o JSON, atualiza o texto da barra, repopula os submenus do popup
6. A cada 30 segundos, verifica se a próxima reunião entrou na janela de notificação (padrão 30 min antes) e chama `notify-send` se for o caso

### Por que Python e não tudo em GJS?

A GJS (motor JavaScript do Cinnamon) não tem suporte decente a parse de ICS, e nada de expansão de RRULE. O ecossistema Python tem bibliotecas maduras (`icalendar`, `recurring-ical-events`) que resolvem isso em poucas linhas. O custo é spawnar um subprocesso a cada refresh, mas como o intervalo mínimo é 1 minuto, não tem impacto prático.

---

## Limitações conhecidas

- Eventos **all-day** são ignorados (não são reuniões com horário)
- Janela de busca é fixa em **7 dias** à frente
- Reuniões já em andamento aparecem como "agora (há X min)" mas não são removidas
- Não suporta CalDAV nem outros provedores que não exportem ICS público
- A URL ICS é um **link secreto** — qualquer pessoa com ela vê seu calendário. Trate como senha

---

## Privacidade

- Dados do calendário ficam **apenas localmente** no seu computador
- Nada é enviado para servidores externos além das requisições HTTP diretas ao Outlook que você configurou
- A lista de URLs ICS fica salva pelo Cinnamon em `~/.config/cinnamon/spices/outlook-calendar@caio-hat/`
- A migração do config antigo (versão 1.x com URL única) lê de `~/.config/outlook-calendar-applet/config.json` apenas na primeira execução do applet 2.x

---

## Estrutura de múltiplos calendários

O formato do campo `calendars` no settings (visualizado via Configure dialog) é uma lista de objetos:

```json
[
  {
    "name": "Trabalho",
    "url": "https://outlook.office365.com/owa/calendar/.../calendar.ics",
    "color": "#1e88e5",
    "enabled": true
  },
  {
    "name": "Pessoal",
    "url": "https://outlook.live.com/owa/calendar/.../calendar.ics",
    "color": "#43a047",
    "enabled": true
  }
]
```

Você pode desabilitar um calendário temporariamente desmarcando o **Ativo** sem precisar apagar.

---

## Atualizando para uma nova versão

```bash
cd Applet-cinnamon-outlookcalendar
git pull
bash setup.sh
cinnamon --replace &
```

O `setup.sh` é idempotente — pode rodar quantas vezes precisar.

---

## Contribuindo

Pull requests são bem-vindos. Para mudanças grandes, abra uma issue antes para discutir o que mudar.

Ideias na fila / contribuições bem-vindas:

- [ ] Indicador visual quando uma reunião está em andamento
- [ ] Suporte a CalDAV
- [ ] Pesquisa/filtro no popup
- [ ] Snooze de notificação
- [ ] Tradução (i18n) para outros idiomas

---

## Licença

MIT — use, modifique e redistribua à vontade.
