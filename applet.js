const Applet = imports.ui.applet;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const FETCH_INTERVAL_S  = 5 * 60;          // fetch meetings every 5 min
const NOTIFY_CHECK_S    = 30;              // check notification every 30 s
const NOTIFY_WINDOW_MS  = 31 * 60 * 1000; // notify when meeting ≤ 31 min away

class OutlookCalendarApplet extends Applet.TextIconApplet {

    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this._appletDir   = metadata.path;
        this._nextMeeting = null;
        this._hidden      = false;
        this._notifiedIds = new Set();

        this.set_applet_icon_symbolic_name("x-office-calendar");
        this.set_applet_label("Carregando...");
        this.set_applet_tooltip("Outlook - buscando reuniões...");

        this._buildMenu();
        this._fetchMeetings();

        this._fetchTimeoutId = Mainloop.timeout_add_seconds(FETCH_INTERVAL_S, () => {
            this._fetchMeetings();
            return true;
        });

        this._notifyTimeoutId = Mainloop.timeout_add_seconds(NOTIFY_CHECK_S, () => {
            this._checkUpcomingNotification();
            return true;
        });
    }

    // ── Menu ────────────────────────────────────────────────────────────────

    _buildMenu() {
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = new Applet.AppletPopupMenu(this, this._orientation);
        this._menuManager.addMenu(this._menu);

        // Toggle: show / hide meeting text in the panel bar
        this._showSwitch = new PopupMenu.PopupSwitchMenuItem("Exibir na barra", true);
        this._showSwitch.connect("toggled", (item, state) => {
            this._hidden = !state;
            this._updateDisplay();
        });
        this._menu.addMenuItem(this._showSwitch);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Meeting details (read-only)
        this._infoItem = new PopupMenu.PopupMenuItem("Carregando...", { reactive: false });
        this._menu.addMenuItem(this._infoItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let refreshItem = new PopupMenu.PopupMenuItem("Atualizar agora");
        refreshItem.connect("activate", () => this._fetchMeetings());
        this._menu.addMenuItem(refreshItem);
    }

    on_applet_clicked(event) { // eslint-disable-line no-unused-vars
        this._menu.toggle();
    }

    // ── Data fetching ────────────────────────────────────────────────────────

    _fetchMeetings() {
        let scriptPath = this._appletDir + "/fetch_meetings.py";
        try {
            let proc = Gio.Subprocess.new(
                ["python3", scriptPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout] = proc.communicate_utf8_finish(res);
                    this._processFetchOutput(stdout || "");
                } catch (e) {
                    this._showError("Erro ao buscar reuniões");
                    global.logError("[Outlook Applet] communicate error: " + e);
                }
            });
        } catch (e) {
            this._showError("Erro ao executar script");
            global.logError("[Outlook Applet] spawn error: " + e);
        }
    }

    _processFetchOutput(raw) {
        raw = raw.trim();
        if (!raw) { this._showError("Sem resposta do script"); return; }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            this._showError("Erro ao ler dados");
            global.logError("[Outlook Applet] JSON parse error: " + e);
            return;
        }

        if (data.error) { this._showError(data.error); return; }

        this._nextMeeting = (data.meetings || [])[0] || null;
        this._updateDisplay();
        this._checkUpcomingNotification();
    }

    // ── Display ──────────────────────────────────────────────────────────────

    _showError(msg) {
        this.hide_applet_label(false);
        this.set_applet_label("⚠");
        this.set_applet_tooltip(msg);
        this._infoItem.label.set_text(msg);
    }

    _fmtTime(isoStr) {
        return new Date(isoStr).toLocaleTimeString("pt-BR", {
            hour: "2-digit", minute: "2-digit"
        });
    }

    _fmtDateTime(isoStr) {
        let d = new Date(isoStr);
        return d.toLocaleDateString("pt-BR", {
            weekday: "short", day: "2-digit", month: "2-digit"
        }) + " " + d.toLocaleTimeString("pt-BR", {
            hour: "2-digit", minute: "2-digit"
        });
    }

    _updateDisplay() {
        if (!this._nextMeeting) {
            this.hide_applet_label(false);
            this.set_applet_label("Sem reuniões");
            this.set_applet_tooltip("Nenhuma reunião nas próximas 24h");
            this._infoItem.label.set_text("Nenhuma reunião próxima");
            return;
        }

        let m = this._nextMeeting;
        let startTime   = this._fmtTime(m.start);
        let fullStart   = this._fmtDateTime(m.start);
        let endTime     = this._fmtTime(m.end);

        let details = m.subject + "\n" + fullStart + " – " + endTime;
        if (m.location) details += "\n" + m.location;

        this._infoItem.label.set_text(details);
        this.set_applet_tooltip(details);

        if (this._hidden) {
            this.hide_applet_label(true);
        } else {
            this.hide_applet_label(false);
            this.set_applet_label(m.subject + "  " + startTime);
        }
    }

    // ── Notification ─────────────────────────────────────────────────────────

    _checkUpcomingNotification() {
        if (!this._nextMeeting) return;

        let m   = this._nextMeeting;
        let key = m.start + "|" + m.subject;
        if (this._notifiedIds.has(key)) return;

        let diff = new Date(m.start).getTime() - Date.now();
        if (diff > 0 && diff <= NOTIFY_WINDOW_MS) {
            let mins  = Math.round(diff / 60000);
            let title = `Reunião em ${mins} minuto${mins !== 1 ? "s" : ""}`;
            let body  = m.subject + "\n" + this._fmtDateTime(m.start);
            if (m.location) body += "\n" + m.location;

            Util.spawn([
                "notify-send",
                "--icon=x-office-calendar",
                "--urgency=normal",
                "--app-name=Outlook Calendar",
                title,
                body
            ]);
            this._notifiedIds.add(key);
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    on_applet_removed_from_panel() {
        if (this._fetchTimeoutId)  Mainloop.source_remove(this._fetchTimeoutId);
        if (this._notifyTimeoutId) Mainloop.source_remove(this._notifyTimeoutId);
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new OutlookCalendarApplet(metadata, orientation, panelHeight, instanceId);
}
