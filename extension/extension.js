// SPDX-License-Identifier: GPL-2.0-or-later
// Wi-Fi Bands: adds to the Wi-Fi menu of Quick Settings a pill per network
// showing its bands, and a Band entry to choose the band of the network in
// use. Nothing is added to the top bar.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    BAND_2_4, BAND_5,
    addFailure, bandOf, bandsOf, channelOf, clearFailure, countRecent, dbmOf,
    modeOf, neighbours, rate, sameBssid,
} from './model.js';
import {Wifi} from './wifi.js';

const LEVEL_NAMES = ['good', 'weak', 'poor'];
const REFRESH_SECONDS = 2;
// How long a change gets to connect before it is taken back.
const REVERT_SECONDS = 25;
const RECENT_SWITCH_MS = 30 * 60 * 1000;

function bandLabel(band) {
    return band === BAND_5 ? _('5 GHz') : _('2.4 GHz');
}

function bandShort(band) {
    return band === BAND_5 ? _('5') : _('2.4');
}

function* descendants(actor) {
    for (const child of actor.get_children()) {
        yield child;
        yield* descendants(child);
    }
}

// The rows of the Wi-Fi list, whose `network` is the Shell's own object.
function isNetworkRow(actor) {
    return typeof actor.network?.name === 'string' &&
        typeof actor.network?.signal_strength === 'number';
}

// One pill, split in a segment per band the network is on; the band in use
// is the lighter one. Neutral on purpose: colours are for the open entry.
function bandPill(bands) {
    const pill = new St.BoxLayout({style_class: 'wifi-bands-pill', y_align: Clutter.ActorAlign.CENTER});
    bands.forEach(({band, active}, i) => {
        if (i > 0)
            pill.add_child(new St.Widget({style_class: 'wifi-bands-pill-divider'}));
        pill.add_child(new St.Label({
            text: bandShort(band),
            style_class: active ? 'wifi-bands-pill-text wifi-bands-pill-active' : 'wifi-bands-pill-text',
            accessible_name: bandLabel(band),
            y_align: Clutter.ActorAlign.CENTER,
        }));
    });
    return pill;
}

// Filled: seen on the access point in use or tried before. Empty: guessed
// from the scan alone.
function dot(level, filled) {
    return new St.Widget({
        style_class: `wifi-bands-dot wifi-bands-dot-${LEVEL_NAMES[level]}${filled ? '' : ' wifi-bands-dot-hollow'}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

function reasonText(reason) {
    switch (reason) {
    case 'very-weak-signal': return _('very weak signal');
    case 'weak-signal': return _('weak signal');
    case 'failed-before': return _('refused you before');
    case 'radar-channel': return _('radar-sensitive channel');
    case 'busy-channel': return _('busy channel');
    case 'switching': return _('keeps switching');
    default: return reason;
    }
}

// Long texts break into lines instead of being cut with an ellipsis.
function wrap(label) {
    label.clutter_text.line_wrap = true;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
}

export default class WifiBands extends Extension {
    enable() {
        this._toggle = Main.panel.statusArea.quickSettings._network?._wirelessToggle;
        if (!this._toggle) {
            console.warn('wifi-bands: no Wi-Fi menu in Quick Settings, doing nothing');
            return;
        }
        this._settings = this.getSettings();
        this._failures = this._settings.get_value('failures').deepUnpack();
        this._rated = [];
        this._chips = new Map();
        this._rowsSignature = '';
        // A newer choice makes the callbacks of an older one stale.
        this._generation = 0;
        // The change made and not yet checked, and one asked for mid-reconnection.
        this._change = null;
        this._queued = null;
        this._lastUuid = null;
        this._wifi = new Wifi(() => this._refresh());
        this._wifi.start(() => this._start());
    }

    disable() {
        this._generation++;
        this._queued = null;
        this._stopWatch();
        this._stopTimer();
        if (this._menuId) {
            this._toggle.menu.disconnect(this._menuId);
            this._menuId = 0;
        }
        for (const [row, {box, destroyId}] of this._chips ?? []) {
            row.disconnect(destroyId);
            box.destroy();
            if (row._selectedIcon)
                row.set_child_above_sibling(row._selectedIcon, null);
        }
        this._chips = null;
        this._note?.destroy();
        this._note = null;
        this._pinSwitch?.disconnect(this._pinId);
        this._pinSwitch?.destroy();
        this._pinSwitch = null;
        this._rows?.destroy();
        this._rows = null;
        this._item?.destroy();
        this._item = null;
        this._buttons = null;
        this._rated = null;
        this._wifi?.destroy();
        this._wifi = null;
        this._settings = null;
        this._toggle = null;
        // A change still being checked stays in the settings: it is checked
        // (and taken back if it failed) the next time the extension starts.
        this._change = null;
    }

    _start() {
        this._buildMenu();
        this._menuId = this._toggle.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._refresh();
                this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                    this._refresh();
                    return GLib.SOURCE_CONTINUE;
                });
            } else {
                this._queued = null;
                this._stopTimer();
            }
        });
        this._change = this._loadPending();
        if (this._change)
            this._watch();
        this._refresh();
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _stopWatch() {
        if (this._watchId) {
            GLib.source_remove(this._watchId);
            this._watchId = 0;
        }
    }

    _buildMenu() {
        this._item = new PopupMenu.PopupSubMenuMenuItem(_('Band'), false);
        const menu = this._item.menu;

        this._rows = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this._rows);

        const modeRow = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        const buttons = new St.BoxLayout({x_expand: true, x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 8px;'});
        this._buttons = new Map();
        for (const [mode, label] of [['auto', _('Auto')], [BAND_5, _('5 GHz')], [BAND_2_4, _('2.4 GHz')]]) {
            const button = new St.Button({
                label,
                style_class: 'button wifi-bands-mode',
                can_focus: true,
            });
            button.connect('clicked', () => this._choose(mode, this._pinSwitch.state));
            this._buttons.set(mode, button);
            buttons.add_child(button);
        }
        modeRow.add_child(buttons);
        menu.addMenuItem(modeRow);

        this._pinSwitch = new PopupMenu.PopupSwitchMenuItem(_('Stay on this access point'), false);
        this._pinId = this._pinSwitch.connect('toggled', (_item, state) => this._choose(this._mode, state));
        menu.addMenuItem(this._pinSwitch);

        this._note = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._note.add_style_class_name('wifi-bands-note');
        wrap(this._note.label);
        this._note.visible = false;
        menu.addMenuItem(this._note);

        // Right under the list of networks.
        const position = this._toggle.menu._getMenuItems().indexOf(this._toggle._itemsSection) + 1;
        this._toggle.menu.addMenuItem(this._item, position || undefined);
        this._item.visible = false;
    }

    _say(text) {
        this._note.label.text = text;
        this._note.visible = text !== '';
    }

    // Every access point with how it rates, current as of now.
    _rate() {
        const now = Date.now();
        const aps = this._wifi.accessPoints();
        const recent = countRecent(this._wifi.switches, now, RECENT_SWITCH_MS);
        this._rated = aps.map(ap => {
            const failures = this._failures[ap.bssid.toLowerCase()] ?? 0;
            return {
                ...ap,
                failures,
                rating: rate(ap, {
                    failures,
                    crowd: neighbours(ap, aps),
                    switches: ap.active ? recent : 0,
                }),
            };
        });
    }

    _refresh() {
        if (!this._wifi?.available || !this._item)
            return;
        this._rate();
        if (this._wifi.single)
            this._decorateRows();
        this._updateMenu();
    }

    _decorateRows() {
        const bySsid = new Map();
        for (const ap of this._rated) {
            if (!bySsid.has(ap.ssid))
                bySsid.set(ap.ssid, []);
            bySsid.get(ap.ssid).push(ap);
        }

        for (const row of descendants(this._toggle.menu.box)) {
            if (!isNetworkRow(row))
                continue;
            const bands = bandsOf(bySsid.get(row.network.name) ?? []);
            const signature = bands.map(b => `${b.band}${b.active}`).join();
            let chips = this._chips.get(row);
            if (chips?.signature === signature)
                continue;
            if (!chips) {
                const box = new St.BoxLayout({
                    x_expand: true,
                    x_align: Clutter.ActorAlign.END,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                row.add_child(box);
                // The check mark stays next to the name, so that the pills
                // line up on the right whether or not the network is in use.
                if (row._selectedIcon && row._label)
                    row.set_child_above_sibling(row._selectedIcon, row._label);
                // The Shell drops a row when its network leaves the list.
                const destroyId = row.connect('destroy', () => this._chips?.delete(row));
                chips = {box, signature: '', destroyId};
                this._chips.set(row, chips);
            }
            chips.signature = signature;
            chips.box.destroy_all_children();
            if (bands.length > 0)
                chips.box.add_child(bandPill(bands));
        }
    }

    _showMode(mode, pinned) {
        this._mode = mode;
        for (const [name, button] of this._buttons)
            button.checked = name === mode;
        // setToggleState() emits "toggled" too: this is not a choice.
        this._pinSwitch.block_signal_handler(this._pinId);
        this._pinSwitch.setToggleState(pinned);
        this._pinSwitch.unblock_signal_handler(this._pinId);
        this._item.label.text = (pinned ? _('Band: %s, one access point') : _('Band: %s'))
            .format(mode === 'auto' ? _('Auto') : bandLabel(mode));
    }

    // Shows what the profile is set to.
    _showProfile(profile) {
        const {mode, pinned} = modeOf(profile.band, profile.bssid);
        this._showMode(mode, pinned);
    }

    _updateMenu() {
        const profile = this._wifi.profile();
        const active = this._rated.find(ap => ap.active);
        if (!profile || !active || !this._wifi.activated) {
            this._item.visible = this._queued !== null;
            return;
        }
        this._item.visible = true;
        this._lastUuid = profile.uuid;
        if (this._queued) {
            const {mode, pin, uuid} = this._queued;
            this._queued = null;
            // Only for the network it was asked on.
            if (uuid === profile.uuid) {
                this._choose(mode, pin);
                return;
            }
        }
        // A change being checked already shows what was asked.
        if (!this._change)
            this._showProfile(profile);

        const mine = this._rated
            .filter(ap => ap.ssid === active.ssid && bandOf(ap.frequency))
            .sort((a, b) => (bandOf(a.frequency) === BAND_5 ? 0 : 1) - (bandOf(b.frequency) === BAND_5 ? 0 : 1) ||
                b.strength - a.strength);
        const signature = mine.map(ap =>
            `${ap.bssid}${ap.strength}${ap.active}${ap.rating.level}${ap.rating.reasons}`).join();
        if (signature === this._rowsSignature)
            return;
        this._rowsSignature = signature;
        this._rows.removeAll();
        for (const ap of mine)
            this._rows.addMenuItem(this._accessPointRow(ap));
    }

    _accessPointRow(ap) {
        const row = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        row.add_child(dot(ap.rating.level, ap.active || ap.failures > 0));

        const text = new St.BoxLayout({x_expand: true, style: 'spacing: 2px;'});
        // Through the layout manager, which every supported version has.
        text.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        const channel = channelOf(ap.frequency);
        text.add_child(new St.Label({
            text: bandOf(ap.frequency) === BAND_5
                ? _('5 GHz, channel %d').format(channel)
                : _('2.4 GHz, channel %d').format(channel),
        }));
        const details = [_('%d dBm').format(dbmOf(ap.strength))];
        if (ap.active)
            details.unshift(_('connected'));
        details.push(...ap.rating.reasons.map(reasonText));
        const detail = new St.Label({text: details.join(', '), style_class: 'dim-label', style: 'font-size: 0.85em;'});
        wrap(detail);
        text.add_child(detail);
        row.add_child(text);
        return row;
    }

    // Applies a mode (and whether to hold one access point), and takes it
    // back if the router does not let the laptop connect.
    _choose(mode, pin) {
        const profile = this._wifi.profile();
        const active = this._rated.find(ap => ap.active);
        if (!profile || !active) {
            // Mid-reconnection: do it once the connection is back.
            this._queued = {mode, pin, uuid: this._lastUuid};
            this._say(_('Waiting for the connection…'));
            return;
        }

        const band = mode === 'auto' ? null : mode;
        const inBand = this._rated
            .filter(ap => ap.ssid === active.ssid && (band === null || bandOf(ap.frequency) === band))
            .sort((a, b) => b.strength - a.strength);
        if (inBand.length === 0) {
            this._say(_('This network is not on that band from here.'));
            this._showProfile(profile);
            return;
        }
        // Hold the access point in use if it fits the band, else the best one.
        const target = inBand.find(ap => ap.active) ?? inBand[0];
        const bssid = pin ? target.bssid : null;
        if (band === profile.band && bssid === profile.bssid) {
            this._showProfile(profile);
            return;
        }

        // While a change is being checked, going back means going back to
        // what worked before it, not to the change. One that already works
        // counts as what worked.
        const unchecked = this._change?.uuid === profile.uuid && !this._works(this._change);
        const previous = unchecked
            ? this._change.previous
            : {band: profile.band, bssid: profile.bssid};
        // An access point only counts as refusing when it was the one asked for.
        const candidates = pin ? [bssid] : band === null ? [] : inBand.map(ap => ap.bssid);
        this._change = {uuid: profile.uuid, band, bssid, previous, candidates};
        this._savePending();

        const generation = ++this._generation;
        this._stopWatch();
        this._showMode(mode, pin);
        this._say(_('Changing the band…'));
        this._wifi.apply(profile.connection, band, bssid, ok => {
            if (generation !== this._generation)
                return;
            if (ok) {
                this._watch();
            } else {
                this._finish(_('Could not change the setting.'));
            }
        });
    }

    _watch() {
        this._stopWatch();
        this._watchId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REVERT_SECONDS, () => {
            this._watchId = 0;
            this._settle();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Is the laptop connected the way the change asked?
    _works(change) {
        const active = this._rated.find(ap => ap.active);
        return this._wifi.activated && this._wifi.activeUuid() === change.uuid && Boolean(active) &&
            (change.band === null || bandOf(active.frequency) === change.band) &&
            (change.bssid === null || sameBssid(active.bssid, change.bssid));
    }

    // Did the connection come back on what was asked? If not, go back.
    _settle() {
        const change = this._change;
        this._rate();
        if (this._works(change)) {
            this._failures = clearFailure(this._failures, this._rated.find(ap => ap.active).bssid);
            this._saveFailures();
            this._finish('');
            return;
        }

        const connection = this._wifi.connection(change.uuid);
        for (const bssid of change.candidates)
            this._failures = addFailure(this._failures, bssid);
        this._saveFailures();
        if (!connection) {
            this._finish('');
            return;
        }
        const generation = this._generation;
        this._wifi.apply(connection, change.previous.band, change.previous.bssid, ok => {
            if (generation !== this._generation)
                return;
            this._finish(ok
                ? _('That access point refused the connection. Back to the previous setting.')
                : _('Could not change the setting.'));
        });
    }

    _finish(text) {
        this._change = null;
        this._savePending();
        this._say(text);
        this._refresh();
    }

    _saveFailures() {
        this._settings.set_value('failures', new GLib.Variant('a{si}', this._failures));
    }

    _savePending() {
        const c = this._change;
        const value = c ? {
            uuid: c.uuid,
            band: c.band ?? '',
            bssid: c.bssid ?? '',
            previousBand: c.previous.band ?? '',
            previousBssid: c.previous.bssid ?? '',
            candidates: c.candidates.join(','),
        } : {};
        this._settings.set_value('pending', new GLib.Variant('a{ss}', value));
    }

    _loadPending() {
        const v = this._settings.get_value('pending').deepUnpack();
        if (!v.uuid)
            return null;
        return {
            uuid: v.uuid,
            band: v.band || null,
            bssid: v.bssid || null,
            previous: {band: v.previousBand || null, bssid: v.previousBssid || null},
            candidates: v.candidates ? v.candidates.split(',') : [],
        };
    }
}
