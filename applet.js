const Applet    = imports.ui.applet;
const Gio       = imports.gi.Gio;
const GLib      = imports.gi.GLib;
const Mainloop  = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings  = imports.ui.settings;
const Util      = imports.misc.util;

const UUID           = "outlook-calendar@caio-hat";
const NOTIFY_CHECK_S = 30;
const LEGACY_CONFIG  = GLib.get_home_dir() + "/.config/outlook-calendar-applet/config.json";

class OutlookCalendarApplet extends Applet.TextIconApplet {

    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this._metadata         = metadata;
        this._instanceId       = instanceId;
        this._appletDir        = metadata.path;
        this._allMeetings      = [];
        this._nextMeeting      = null;
        this._inProgress       = null;
        this._panelMeeting     = null;
        this._conflictKeys     = new Set();
        this._notifiedIds      = new Set();
        this._notifiedConflicts = new Set();
        this._lastError        = null;
        this._suppressToggle   = false;

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind("calendars",       "calendars",      () => this._onCalendarsChanged());
        this.settings.bind("show-in-panel",   "showInPanel",    () => this._onShowInPanelChanged());
        this.settings.bind("hidden-mode",     "hiddenMode",     () => this._onHiddenModeChanged());
        this.settings.bind("label-max-chars", "labelMaxChars",  () => this._updateDisplay());
        this.settings.bind("notify-enabled",  "notifyEnabled");
        this.settings.bind("notify-before",   "notifyBefore");
        this.settings.bind("notify-conflicts","notifyConflicts");
        this.settings.bind("refresh-interval","refreshInterval",() => this._startRefreshTimer());
        this.settings.bind("show-tentative",  "showTentative",  () => this._onShowTentativeChanged());

        this._migrateLegacyConfig();

        this.set_applet_icon_symbolic_name("x-office-calendar");
        this.set_applet_label("Outlook");
        this.set_applet_tooltip("Outlook - carregando...");

        this._buildMenu();
        this._startRefreshTimer();
        this._startNotifyTimer();
        this._fetchMeetings();
    }

    // ── Legacy migration ─────────────────────────────────────────────────────
    _migrateLegacyConfig() {
        try {
            if (this.calendars && this.calendars.length > 0) return;
            if (!GLib.file_test(LEGACY_CONFIG, GLib.FileTest.EXISTS)) return;
            let [ok, raw] = GLib.file_get_contents(LEGACY_CONFIG);
            if (!ok) return;
            let text = (raw instanceof Uint8Array) ? imports.byteArray.toString(raw) : String(raw);
            let legacy = JSON.parse(text);
            if (legacy && legacy.ics_url) {
                let migrated = [{ name: "Outlook", url: legacy.ics_url, color: "#1e88e5", enabled: true }];
                this.calendars = migrated;
                this.settings.setValue("calendars", migrated);
                global.log("[Outlook] Config antigo migrado.");
            }
        } catch (e) { global.logError("[Outlook] Migracao falhou: " + e); }
    }

    // ── Menu ───────────────────────────────────────────────────────────────────
    _buildMenu() {
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = new Applet.AppletPopupMenu(this, this._orientation);
        this._menuManager.addMenu(this._menu);

        this._nextItem = new PopupMenu.PopupMenuItem("Carregando...", { reactive: false });
        this._nextItem.actor.add_style_class_name("outlook-next-item");
        this._nextItem.label.clutter_text.set_line_wrap(true);
        this._menu.addMenuItem(this._nextItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._sub24 = new PopupMenu.PopupSubMenuMenuItem("Proximas 24 horas");
        this._sub3d = new PopupMenu.PopupSubMenuMenuItem("Proximos 3 dias");
        this._sub7d = new PopupMenu.PopupSubMenuMenuItem("Proximos 7 dias");
        this._menu.addMenuItem(this._sub24);
        this._menu.addMenuItem(this._sub3d);
        this._menu.addMenuItem(this._sub7d);
        this._sub24.menu.open(false);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Privacy toggles
        this._hiddenSwitch = new PopupMenu.PopupSwitchMenuItem("🔒 Modo oculto (so countdown)", this.hiddenMode === true);
        this._hiddenSwitch.connect("toggled", (item, state) => {
            if (this._suppressToggle || state === this.hiddenMode) return;
            this.hiddenMode = state;
            this.settings.setValue("hidden-mode", state);
            this._updateDisplay();
        });
        this._menu.addMenuItem(this._hiddenSwitch);

        this._showSwitch = new PopupMenu.PopupSwitchMenuItem("Exibir texto na barra", this.showInPanel !== false);
        this._showSwitch.connect("toggled", (item, state) => {
            if (this._suppressToggle || state === this.showInPanel) return;
            this.showInPanel = state;
            this.settings.setValue("show-in-panel", state);
            this._updateDisplay();
        });
        this._menu.addMenuItem(this._showSwitch);

        this._tentativeSwitch = new PopupMenu.PopupSwitchMenuItem("Mostrar pendentes", this.showTentative !== false);
        this._tentativeSwitch.connect("toggled", (item, state) => {
            if (this._suppressToggle || state === this.showTentative) return;
            this.showTentative = state;
            this.settings.setValue("show-tentative", state);
            this._renderMenu();
            this._updateDisplay();
        });
        this._menu.addMenuItem(this._tentativeSwitch);

        let refresh = new PopupMenu.PopupMenuItem("↻  Atualizar agora");
        refresh.connect("activate", () => this._fetchMeetings());
        this._menu.addMenuItem(refresh);

        let configure = new PopupMenu.PopupMenuItem("⚙  Configuracoes");
        configure.connect("activate", () =>
            Util.spawnCommandLine("xlet-settings applet " + UUID + ":" + this._instanceId));
        this._menu.addMenuItem(configure);
    }

    on_applet_clicked(_e) { this._menu.toggle(); }

    // ── Timers ────────────────────────────────────────────────────────────────
    _startRefreshTimer() {
        if (this._refreshTimer) { Mainloop.source_remove(this._refreshTimer); this._refreshTimer = null; }
        let secs = Math.max(60, (this.refreshInterval || 5) * 60);
        this._refreshTimer = Mainloop.timeout_add_seconds(secs, () => { this._fetchMeetings(); return true; });
    }

    _startNotifyTimer() {
        this._notifyTimer = Mainloop.timeout_add_seconds(NOTIFY_CHECK_S, () => {
            this._checkUpcomingNotification();
            this._checkConflictNotification();
            this._updateNextItem();
            this._updateDisplay();
            return true;
        });
    }

    _onCalendarsChanged()    { this._fetchMeetings(); }
    _onShowInPanelChanged()  { this._syncSwitch(this._showSwitch,      this.showInPanel);    this._updateDisplay(); }
    _onHiddenModeChanged()   { this._syncSwitch(this._hiddenSwitch,    this.hiddenMode);     this._updateDisplay(); }
    _onShowTentativeChanged(){ this._syncSwitch(this._tentativeSwitch, this.showTentative);  this._renderMenu(); this._updateDisplay(); }

    _syncSwitch(sw, value) {
        if (!sw || sw.state === value) return;
        this._suppressToggle = true;
        sw.setToggleState(value);
        this._suppressToggle = false;
    }

    // ── Fetch ──────────────────────────────────────────────────────────────────
    _fetchMeetings() {
        let scriptPath = this._appletDir + "/fetch_meetings.py";
        try {
            let proc = Gio.Subprocess.new(
                ["python3", scriptPath],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(JSON.stringify(this.calendars || []), null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    this._handleFetchOutput(stdout || "", stderr || "");
                } catch (e) {
                    this._setError("Erro ao buscar reunioes");
                    global.logError("[Outlook] communicate: " + e);
                }
            });
        } catch (e) {
            this._setError("python3 nao encontrado");
            global.logError("[Outlook] spawn: " + e);
        }
    }

    _handleFetchOutput(stdout, stderr) {
        let raw = stdout.trim();
        if (!raw) { this._setError("Sem resposta\n" + stderr.slice(0, 200)); return; }
        let data;
        try { data = JSON.parse(raw); }
        catch (e) { this._setError("Erro ao parsear resposta"); global.logError("[Outlook] JSON: " + e); return; }
        if (data.error) { this._setError(data.error); return; }
        this._lastError = null;
        this._allMeetings = data.meetings || [];
        this._renderMenu();
        this._updateDisplay();
        this._checkUpcomingNotification();
        this._checkConflictNotification();
    }

    _setError(msg) {
        this._lastError = msg;
        this._allMeetings = []; this._nextMeeting = null; this._inProgress = null;
        this._panelMeeting = null; this._conflictKeys = new Set();
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

    // ── Formatting helpers ────────────────────────────────────────────────────
    _fmtTime(iso) { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
    _fmtDay(iso)  { return new Date(iso).toLocaleDateString("pt-BR",  { weekday: "short", day: "2-digit", month: "2-digit" }); }
    _fmtFull(iso) { return this._fmtDay(iso) + " " + this._fmtTime(iso); }
    _countdown(iso) {
        let diff = new Date(iso).getTime() - Date.now();
        if (diff <= 0) { return "agora (ha " + Math.round(Math.abs(diff) / 60000) + " min)"; }
        let mins = Math.round(diff / 60000);
        if (mins < 60) return "em " + mins + " min";
        let h = Math.floor(mins / 60), m = mins % 60;
        if (h < 24) return "em " + h + "h" + (m > 0 ? " " + m + "min" : "");
        return "em " + Math.floor(h / 24) + " dia(s)";
    }
    _esc(s)   { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
    _color(c) {
        if (!c) return "#1e88e5";
        c = String(c).trim();
        if (c.startsWith("#")) return c;
        let m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? "#" + [m[1],m[2],m[3]].map(n => parseInt(n,10).toString(16).padStart(2,"0")).join("") : "#1e88e5";
    }
    _mkey(m) { return (m.uid || "") + "|" + m.start; }

    // ── Conflict detection ─────────────────────────────────────────────────────────
    _detectConflicts(meetings) {
        let keys = new Set();
        for (let i = 0; i < meetings.length; i++) {
            for (let j = i + 1; j < meetings.length; j++) {
                let a = meetings[i], b = meetings[j];
                if (a.status === "free" || b.status === "free") continue;
                let aS = new Date(a.start).getTime(), aE = a.end ? new Date(a.end).getTime() : aS + 30*60*1000;
                let bS = new Date(b.start).getTime(), bE = b.end ? new Date(b.end).getTime() : bS + 30*60*1000;
                if (aS < bE && bS < aE) { keys.add(this._mkey(a)); keys.add(this._mkey(b)); }
            }
        }
        return keys;
    }

    // ── Render ───────────────────────────────────────────────────────────────────
    _renderMenu() {
        let now  = Date.now();
        let h24  = now +  24*3600*1000;
        let h72  = now +   3*24*3600*1000;
        let h168 = now +   7*24*3600*1000;

        this._inProgress = null;
        let future = [];

        for (let m of this._allMeetings) {
            let s = new Date(m.start).getTime();
            let e = m.end ? new Date(m.end).getTime() : s + 30*60*1000;
            if (e <= now) continue;
            if (s <= now && now < e) { if (!this._inProgress) this._inProgress = m; }
            else if (s <= h168)      { future.push(m); }
        }

        this._nextMeeting = this._inProgress || (future.length > 0 ? future[0] : null);

        let nextAccepted  = future.find(m => m.status !== "tentative") || null;
        let nextTentative = future.find(m => m.status === "tentative")  || null;
        this._panelMeeting = this._inProgress || nextAccepted || nextTentative;

        this._conflictKeys = this._detectConflicts(
            this._inProgress ? [this._inProgress, ...future] : future
        );

        this._updateNextItem();

        let show = (m) => this.showTentative !== false || m.status !== "tentative";
        let live24 = this._inProgress && show(this._inProgress) ? [this._inProgress] : [];
        let b24 = live24.concat(future.filter(m => new Date(m.start).getTime() <= h24 && show(m)));
        let b3d = future.filter(m => { let s = new Date(m.start).getTime(); return s > h24 && s <= h72  && show(m); });
        let b7d = future.filter(m => { let s = new Date(m.start).getTime(); return s > h72  && s <= h168 && show(m); });

        this._sub24.label.set_text("Proximas 24 horas (" + b24.length + ")");
        this._sub3d.label.set_text("Proximos 3 dias ("   + b3d.length + ")");
        this._sub7d.label.set_text("Proximos 7 dias ("   + b7d.length + ")");

        this._fillSection(this._sub24, b24, false, this._conflictKeys);
        this._fillSection(this._sub3d, b3d, true,  this._conflictKeys);
        this._fillSection(this._sub7d, b7d, true,  this._conflictKeys);
    }

    _updateNextItem() {
        if (this._lastError) return;
        let m = this._nextMeeting;
        if (!m) { this._nextItem.label.set_text("Sem reunioes nas proximas 7 dias"); return; }

        let now     = Date.now();
        let startMs = new Date(m.start).getTime();
        let isLive  = !!(this._inProgress && this._inProgress.start === m.start);
        let color   = this._color(m.calendar_color);
        let isConflict = this._conflictKeys.has(this._mkey(m));

        let dot      = isLive ? "◎" : (m.status === "tentative" ? "?" : "●");
        let dotColor = isLive ? "#f44336" : (m.status === "tentative" ? "#ffa726" : color);

        let line2;
        if (isLive) {
            let mins = Math.round((now - startMs) / 60000);
            line2 = "EM ANDAMENTO (ha " + mins + " min)  ·  ate " + (m.end ? this._fmtTime(m.end) : "?");
        } else {
            line2 = this._countdown(m.start) + "  ·  " + this._fmtTime(m.start) + " - " + (m.end ? this._fmtTime(m.end) : "?");
        }
        if (m.location) line2 += "  ·  " + m.location;

        let markup =
            "<span foreground=\"" + dotColor + "\" font_weight=\"bold\">" + dot + "</span> " +
            (isConflict ? "<span foreground=\"#ff7043\">⚠ </span>" : "") +
            "<b>" + this._esc(m.subject) + "</b>" +
            (m.status === "tentative" ? "  <small><i>(pendente)</i></small>" : "") +
            "\n<small>" + this._esc(line2) + "</small>";
        this._nextItem.label.clutter_text.set_markup(markup);
    }

    _fillSection(section, meetings, groupByDay, conflictKeys) {
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
            section.menu.addMenuItem(this._buildMeetingItem(m, conflictKeys));
        }
    }

    _buildMeetingItem(m, conflictKeys) {
        let now     = Date.now();
        let startMs = new Date(m.start).getTime();
        let endMs   = m.end ? new Date(m.end).getTime() : startMs + 30*60*1000;
        let isLive  = startMs <= now && now < endMs;
        let hasConflict = conflictKeys && conflictKeys.has(this._mkey(m));

        let color    = this._color(m.calendar_color);
        let dot, dotColor;
        if (isLive)                      { dot = "◎"; dotColor = "#f44336"; }
        else if (m.status === "tentative"){ dot = "?";      dotColor = "#ffa726"; }
        else                              { dot = "●"; dotColor = color;     }

        let item = new PopupMenu.PopupMenuItem("");
        let line = "";
        if (hasConflict) line += "<span foreground=\"#ff7043\" font_weight=\"bold\">⚠ </span>";
        line += "<span foreground=\"" + dotColor + "\">"+dot+"</span>  ";
        line += "<b>" + this._esc(this._fmtTime(m.start)) + "</b>  ";
        line += this._esc(m.subject);
        if (isLive)                      { line += "  <small><i>ha " + Math.round((now-startMs)/60000) + " min</i></small>"; }
        if (m.status === "tentative")    { line += "  <small><i>(pendente)</i></small>"; }
        if (m.location)                  { line += "  <small>· " + this._esc(m.location) + "</small>"; }
        if (m.join_url)                  { line += "  <small>🔗</small>"; }
        item.label.clutter_text.set_markup(line);
        if (m.join_url) item.connect("activate", () => Util.spawn(["xdg-open", m.join_url]));
        return item;
    }

    // ── Panel label ─────────────────────────────────────────────────────────────
    _updateDisplay() {
        if (this._lastError) {
            this.hide_applet_label(false); this.set_applet_label("⚠ Outlook"); return;
        }

        // Mode 1: Sem exibicao (most restrictive - just icon, nothing else)
        if (!this.showInPanel) {
            this.hide_applet_label(true);
            this.set_applet_tooltip("Modo Sem Exibicao - clique no icone para ver reunioes");
            return;
        }

        let m    = this._panelMeeting;
        let live = this._inProgress;

        if (!m) {
            this.hide_applet_label(false);
            this.set_applet_label(this.hiddenMode ? "—" : "Sem reunioes");
            this.set_applet_tooltip("Nenhuma reuniao nas proximas 7 dias");
            return;
        }

        this.hide_applet_label(false);

        // Mode 2: Modo Oculto (privacy - countdown only, no meeting name/time)
        if (this.hiddenMode) {
            let label, tooltip;
            if (live) {
                let mins = Math.round((Date.now() - new Date(live.start).getTime()) / 60000);
                label   = "◎ em curso (ha " + mins + " min)";
                tooltip = "Modo Oculto - reuniao em andamento\nClique no icone para ver detalhes";
            } else {
                let cd = this._countdown(m.start);  // "em 3h 56min" / "em 12 min"
                label   = "⏱ " + cd;
                tooltip = "Modo Oculto - proxima reuniao " + cd + "\nClique no icone para ver detalhes";
            }
            if (this._conflictKeys.has(this._mkey(live || m))) {
                label = "⚠ " + label;
                tooltip = "Conflito de horario!\n" + tooltip;
            }
            let max = this.labelMaxChars || 40;
            if (label.length > max) label = label.slice(0, Math.max(1, max - 1)) + "…";
            this.set_applet_label(label);
            this.set_applet_tooltip(tooltip);
            return;
        }

        // Mode 3: Normal
        let label, tooltip;
        if (live) {
            let mins = Math.round((Date.now() - new Date(live.start).getTime()) / 60000);
            label   = "◎ " + live.subject + "  (ha " + mins + " min)";
            tooltip = "EM ANDAMENTO: " + live.subject + "\n" +
                      this._fmtFull(live.start) + " - " + (live.end ? this._fmtTime(live.end) : "?");
        } else {
            let prefix = m.status === "tentative" ? "? " : "";
            label   = prefix + m.subject + "  " + this._fmtTime(m.start);
            tooltip = (m.status === "tentative" ? "[PENDENTE] " : "") + m.subject + "\n" +
                      this._fmtFull(m.start) + " - " + (m.end ? this._fmtTime(m.end) : "?");
        }

        if (this._conflictKeys.has(this._mkey(live || m))) {
            label   = "⚠ " + label;
            tooltip = "CONFLITO DE HORARIO!\n" + tooltip;
        }

        let max = this.labelMaxChars || 40;
        if (label.length > max) label = label.slice(0, Math.max(1, max - 1)) + "…";
        this.set_applet_label(label);
        this.set_applet_tooltip(tooltip);
    }

    // ── Notifications ───────────────────────────────────────────────────────────
    _checkUpcomingNotification() {
        if (!this.notifyEnabled || this._inProgress) return;
        let m = this._panelMeeting;
        if (!m) return;
        let key = this._mkey(m);
        if (this._notifiedIds.has(key)) return;
        let diff = new Date(m.start).getTime() - Date.now();
        let window = (this.notifyBefore || 30) * 60 * 1000 + 60 * 1000;
        if (diff > 0 && diff <= window) {
            let mins  = Math.max(1, Math.round(diff / 60000));
            let title = "Reuniao em " + mins + " minuto" + (mins !== 1 ? "s" : "");
            let body  = (m.status === "tentative" ? "[PENDENTE] " : "") + m.subject + "\n" + this._fmtFull(m.start);
            if (m.location) body += "\n" + m.location;
            Util.spawn(["notify-send", "--icon=x-office-calendar", "--urgency=normal",
                        "--app-name=Outlook Calendar", title, body]);
            this._notifiedIds.add(key);
        }
    }

    _checkConflictNotification() {
        if (!this.notifyConflicts || this._conflictKeys.size === 0) return;
        let now = Date.now();
        let upcoming = this._allMeetings.filter(m => {
            let s = new Date(m.start).getTime();
            return this._conflictKeys.has(this._mkey(m)) && s > now && s <= now + 60*60*1000;
        });
        if (upcoming.length < 2) return;
        let gKey = upcoming.slice(0, 4).map(m => m.start + m.subject).join("|");
        if (this._notifiedConflicts.has(gKey)) return;
        let title = "⚠ Conflito: " + upcoming.length + " reunioes no mesmo horario";
        let body  = upcoming.map(m => (m.status === "tentative" ? "? " : "● ") +
                                       m.subject + "  " + this._fmtTime(m.start)).join("\n");
        Util.spawn(["notify-send", "--icon=appointment-missed", "--urgency=critical",
                    "--app-name=Outlook Calendar", title, body]);
        this._notifiedConflicts.add(gKey);
    }

    // ── Cleanup ────────────────────────────────────────────────────────────────
    on_applet_removed_from_panel() {
        if (this._refreshTimer) Mainloop.source_remove(this._refreshTimer);
        if (this._notifyTimer)  Mainloop.source_remove(this._notifyTimer);
        if (this.settings)      this.settings.finalize();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new OutlookCalendarApplet(metadata, orientation, panelHeight, instanceId);
}
