const Applet     = imports.ui.applet;
const Gio        = imports.gi.Gio;
const GLib       = imports.gi.GLib;
const Mainloop   = imports.mainloop;
const PopupMenu  = imports.ui.popupMenu;
const Settings   = imports.ui.settings;
const St         = imports.gi.St;
const Util       = imports.misc.util;

const UUID            = "outlook-calendar@caio-hat";
const NOTIFY_CHECK_S  = 30;
const LEGACY_CONFIG   = GLib.get_home_dir() + "/.config/outlook-calendar-applet/config.json";

class OutlookCalendarApplet extends Applet.TextIconApplet {

    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this._metadata    = metadata;
        this._instanceId  = instanceId;
        this._appletDir   = metadata.path;
        this._allMeetings = [];
        this._nextMeeting = null;
        this._notifiedIds = new Set();
        this._lastError   = null;
        this._suppressToggle = false;

        // ── Settings binding ─────────────────────────────────────────
        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind("calendars",        "calendars",       () => this._onCalendarsChanged());
        this.settings.bind("show-in-panel",    "showInPanel",     () => this._onShowInPanelChanged());
        this.settings.bind("label-max-chars",  "labelMaxChars",   () => this._updateDisplay());
        this.settings.bind("notify-enabled",   "notifyEnabled");
        this.settings.bind("notify-before",    "notifyBefore");
        this.settings.bind("refresh-interval", "refreshInterval", () => this._startRefreshTimer());

        // Migrate legacy single-URL config if present and current is empty
        this._migrateLegacyConfig();

        // ── Panel UI ──────────────────────────────────────────────────────
        this.set_applet_icon_symbolic_name("x-office-calendar");
        this.set_applet_label("Outlook");
        this.set_applet_tooltip("Outlook - carregando...");

        this._buildMenu();
        this._startRefreshTimer();
        this._startNotifyTimer();
        this._fetchMeetings();
    }

    // ── Legacy migration ──────────────────────────────────────────────
    _migrateLegacyConfig() {
        try {
            if (this.calendars && this.calendars.length > 0) return;
            if (!GLib.file_test(LEGACY_CONFIG, GLib.FileTest.EXISTS)) return;
            let [ok, contents] = GLib.file_get_contents(LEGACY_CONFIG);
            if (!ok) return;
            let text = (contents instanceof Uint8Array) ? imports.byteArray.toString(contents) : String(contents);
            let legacy = JSON.parse(text);
            if (legacy && legacy.ics_url) {
                let migrated = [{
                    name:    "Outlook",
                    url:     legacy.ics_url,
                    color:   "#1e88e5",
                    enabled: true
                }];
                this.calendars = migrated;
                this.settings.setValue("calendars", migrated);
                global.log("[Outlook] Config antigo migrado para multi-calendario.");
            }
        } catch (e) {
            global.logError("[Outlook] Migracao falhou: " + e);
        }
    }

    // ── Menu building ────────────────────────────────────────────────────
    _buildMenu() {
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = new Applet.AppletPopupMenu(this, this._orientation);
        this._menuManager.addMenu(this._menu);

        // Highlighted next meeting
        this._nextItem = new PopupMenu.PopupMenuItem("Carregando...", { reactive: false });
        this._nextItem.actor.add_style_class_name("outlook-next-item");
        this._nextItem.label.clutter_text.set_line_wrap(true);
        this._menu.addMenuItem(this._nextItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Three collapsible sections
        this._sub24 = new PopupMenu.PopupSubMenuMenuItem("Proximas 24 horas");
        this._sub3d = new PopupMenu.PopupSubMenuMenuItem("Proximos 3 dias");
        this._sub7d = new PopupMenu.PopupSubMenuMenuItem("Proximos 7 dias");
        this._menu.addMenuItem(this._sub24);
        this._menu.addMenuItem(this._sub3d);
        this._menu.addMenuItem(this._sub7d);
        // 24h opens by default
        this._sub24.menu.open(false);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Show-in-panel toggle (mirrors settings)
        this._showSwitch = new PopupMenu.PopupSwitchMenuItem("Exibir na barra", this.showInPanel);
        this._showSwitch.connect("toggled", (item, state) => {
            if (this._suppressToggle) return;
            if (state === this.showInPanel) return;
            this.showInPanel = state;
            this.settings.setValue("show-in-panel", state);
            this._updateDisplay();
        });
        this._menu.addMenuItem(this._showSwitch);

        // Actions
        let refresh = new PopupMenu.PopupMenuItem("↻  Atualizar agora");
        refresh.connect("activate", () => this._fetchMeetings());
        this._menu.addMenuItem(refresh);

        let configure = new PopupMenu.PopupMenuItem("⚙  Configuracoes");
        configure.connect("activate", () => {
            Util.spawnCommandLine("xlet-settings applet " + UUID + ":" + this._instanceId);
        });
        this._menu.addMenuItem(configure);
    }

    on_applet_clicked(_event) {
        this._menu.toggle();
    }

    // ── Timers ────────────────────────────────────────────────────────────────
    _startRefreshTimer() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
        let secs = Math.max(60, (this.refreshInterval || 5) * 60);
        this._refreshTimer = Mainloop.timeout_add_seconds(secs, () => {
            this._fetchMeetings();
            return true;
        });
    }

    _startNotifyTimer() {
        this._notifyTimer = Mainloop.timeout_add_seconds(NOTIFY_CHECK_S, () => {
            this._checkUpcomingNotification();
            this._updateNextItem();
            return true;
        });
    }

    _onCalendarsChanged() {
        this._fetchMeetings();
    }

    _onShowInPanelChanged() {
        if (this._showSwitch && this._showSwitch.state !== this.showInPanel) {
            this._suppressToggle = true;
            this._showSwitch.setToggleState(this.showInPanel);
            this._suppressToggle = false;
        }
        this._updateDisplay();
    }

    // ── Fetch (calls python helper via stdin) ─────────────────────────────
    _fetchMeetings() {
        let scriptPath = this._appletDir + "/fetch_meetings.py";
        let calendarsJson = JSON.stringify(this.calendars || []);

        try {
            let proc = Gio.Subprocess.new(
                ["python3", scriptPath],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(calendarsJson, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    this._handleFetchOutput(stdout || "", stderr || "");
                } catch (e) {
                    this._setError("Erro ao buscar reunioes");
                    global.logError("[Outlook] communicate error: " + e);
                }
            });
        } catch (e) {
            this._setError("python3 nao encontrado");
            global.logError("[Outlook] spawn error: " + e);
        }
    }

    _handleFetchOutput(stdout, stderr) {
        let raw = stdout.trim();
        if (!raw) {
            this._setError("Sem resposta do script\n" + stderr.slice(0, 200));
            return;
        }
        let data;
        try { data = JSON.parse(raw); }
        catch (e) {
            this._setError("Erro ao parsear resposta");
            global.logError("[Outlook] JSON parse error: " + e + " | stdout head: " + raw.slice(0, 300));
            return;
        }
        if (data.error) { this._setError(data.error); return; }

        this._lastError = null;
        this._allMeetings = data.meetings || [];
        this._renderMenu();
        this._updateDisplay();
        this._checkUpcomingNotification();
    }

    _setError(msg) {
        this._lastError = msg;
        this._allMeetings = [];
        this._nextMeeting = null;
        this.hide_applet_label(false);
        this.set_applet_label("⚠ Outlook");
        this.set_applet_tooltip(msg);
        if (this._nextItem) this._nextItem.label.set_text(msg);
        for (let sub of [this._sub24, this._sub3d, this._sub7d]) {
            if (!sub) continue;
            sub.menu.removeAll();
            sub.menu.addMenuItem(new PopupMenu.PopupMenuItem("(erro)", { reactive: false }));
        }
    }

    // ── Formatting ───────────────────────────────────────────────────────────
    _fmtTime(iso) {
        return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    _fmtDay(iso) {
        return new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
    }
    _fmtFull(iso) {
        return this._fmtDay(iso) + " " + this._fmtTime(iso);
    }
    _countdown(iso) {
        let diff = new Date(iso).getTime() - Date.now();
        if (diff <= 0) {
            let mins = Math.round(Math.abs(diff) / 60000);
            return "agora (ha " + mins + " min)";
        }
        let mins = Math.round(diff / 60000);
        if (mins < 60) return "em " + mins + " min";
        let h = Math.floor(mins / 60), m = mins % 60;
        if (h < 24) return "em " + h + "h" + (m > 0 ? (" " + m + "min") : "");
        let d = Math.floor(h / 24);
        return "em " + d + " dia" + (d !== 1 ? "s" : "");
    }
    _esc(s) {
        return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    _color(c) {
        if (!c) return "#1e88e5";
        c = String(c).trim();
        if (c.startsWith("#")) return c;
        let m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) return "#" + [m[1], m[2], m[3]].map(n => parseInt(n, 10).toString(16).padStart(2, "0")).join("");
        return "#1e88e5";
    }

    // ── Render ────────────────────────────────────────────────────────────────
    _renderMenu() {
        let now = Date.now();
        let h24 = now + 24 * 3600 * 1000;
        let h72 = now + 3 * 24 * 3600 * 1000;
        let h168 = now + 7 * 24 * 3600 * 1000;

        // Next non-past meeting
        this._nextMeeting = null;
        for (let m of this._allMeetings) {
            let startMs = new Date(m.start).getTime();
            let endMs   = m.end ? new Date(m.end).getTime() : startMs + 30 * 60 * 1000;
            if (endMs > now) { this._nextMeeting = m; break; }
        }

        this._updateNextItem();

        // Bucket
        let b24 = [], b3d = [], b7d = [];
        for (let m of this._allMeetings) {
            let startMs = new Date(m.start).getTime();
            let endMs   = m.end ? new Date(m.end).getTime() : startMs + 30 * 60 * 1000;
            if (endMs <= now) continue;
            if      (startMs <= h24)  b24.push(m);
            else if (startMs <= h72)  b3d.push(m);
            else if (startMs <= h168) b7d.push(m);
        }

        this._sub24.label.set_text("Proximas 24 horas (" + b24.length + ")");
        this._sub3d.label.set_text("Proximos 3 dias ("  + b3d.length + ")");
        this._sub7d.label.set_text("Proximos 7 dias ("  + b7d.length + ")");

        this._fillSection(this._sub24, b24, false);
        this._fillSection(this._sub3d, b3d, true);
        this._fillSection(this._sub7d, b7d, true);
    }

    _updateNextItem() {
        if (this._lastError) return;
        if (!this._nextMeeting) {
            this._nextItem.label.set_text("Sem reunioes nas proximas 24h");
            return;
        }
        let m = this._nextMeeting;
        let line1 = m.subject;
        let line2 = this._countdown(m.start) + "  ·  " +
                    this._fmtTime(m.start) + " - " + (m.end ? this._fmtTime(m.end) : "?");
        if (m.location) line2 += "  ·  " + m.location;
        let color = this._color(m.calendar_color);
        let markup = "<span foreground=\"" + color + "\" font_weight=\"bold\">●</span> " +
                     "<b>" + this._esc(line1) + "</b>\n<small>" + this._esc(line2) + "</small>";
        this._nextItem.label.clutter_text.set_markup(markup);
    }

    _fillSection(section, meetings, groupByDay) {
        section.menu.removeAll();
        if (meetings.length === 0) {
            section.menu.addMenuItem(new PopupMenu.PopupMenuItem("(nenhuma reuniao)", { reactive: false }));
            return;
        }
        let lastDay = "";
        for (let m of meetings) {
            if (groupByDay) {
                let day = this._fmtDay(m.start);
                if (day !== lastDay) {
                    let sep = new PopupMenu.PopupMenuItem(day, { reactive: false });
                    sep.actor.add_style_class_name("outlook-day-header");
                    section.menu.addMenuItem(sep);
                    lastDay = day;
                }
            }
            section.menu.addMenuItem(this._buildMeetingItem(m));
        }
    }

    _buildMeetingItem(m) {
        let item = new PopupMenu.PopupMenuItem("");
        let color = this._color(m.calendar_color);
        let line = "<span foreground=\"" + color + "\">●</span>  " +
                   "<b>" + this._esc(this._fmtTime(m.start)) + "</b>  " +
                   this._esc(m.subject);
        if (m.location) line += "  <small><i>· " + this._esc(m.location) + "</i></small>";
        if (m.join_url) line += "  <small>🔗</small>";
        item.label.clutter_text.set_markup(line);

        if (m.join_url) {
            item.connect("activate", () => {
                Util.spawn(["xdg-open", m.join_url]);
            });
        }
        return item;
    }

    // ── Panel label ──────────────────────────────────────────────────────────
    _updateDisplay() {
        if (this._lastError) {
            this.hide_applet_label(false);
            this.set_applet_label("⚠ Outlook");
            return;
        }
        if (!this._nextMeeting) {
            this.hide_applet_label(false);
            this.set_applet_label("Sem reunioes");
            this.set_applet_tooltip("Nenhuma reuniao nas proximas 24h");
            return;
        }
        if (!this.showInPanel) {
            this.hide_applet_label(true);
            this.set_applet_tooltip("Texto oculto - clique para ver reunioes");
            return;
        }
        this.hide_applet_label(false);
        let m = this._nextMeeting;
        let label = m.subject + "  " + this._fmtTime(m.start);
        let max = this.labelMaxChars || 40;
        if (label.length > max) label = label.slice(0, Math.max(1, max - 1)) + "…";
        this.set_applet_label(label);
        this.set_applet_tooltip(m.subject + "\n" + this._fmtFull(m.start) + " - " + this._fmtTime(m.end || m.start));
    }

    // ── Notification ─────────────────────────────────────────────────────────
    _checkUpcomingNotification() {
        if (!this.notifyEnabled || !this._nextMeeting) return;
        let m = this._nextMeeting;
        let key = (m.uid || "") + "|" + m.start + "|" + m.subject;
        if (this._notifiedIds.has(key)) return;

        let diff = new Date(m.start).getTime() - Date.now();
        let windowMs = (this.notifyBefore || 30) * 60 * 1000 + 60 * 1000;
        if (diff > 0 && diff <= windowMs) {
            let mins = Math.max(1, Math.round(diff / 60000));
            let title = "Reuniao em " + mins + " minuto" + (mins !== 1 ? "s" : "");
            let body  = m.subject + "\n" + this._fmtFull(m.start);
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
        if (this._refreshTimer) Mainloop.source_remove(this._refreshTimer);
        if (this._notifyTimer)  Mainloop.source_remove(this._notifyTimer);
        if (this.settings)      this.settings.finalize();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new OutlookCalendarApplet(metadata, orientation, panelHeight, instanceId);
}
