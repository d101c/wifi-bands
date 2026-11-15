// SPDX-License-Identifier: GPL-2.0-or-later
// Test driver for tools/headless/run.sh. It polls $PROBE_DIR/cmd, runs the
// one command written there, then deletes the file:
//   open | close      the Quick Settings menu
//   wifi              open the Wi-Fi menu
//   band              open the Band entry
//   mode <auto|a|bg>  press a mode button
//   pin <on|off>      flip the "stay on this access point" switch
//   state <name>      write what the extension shows to <name>.json
//   shot <name>       screenshot of the whole screen to <name>.png
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'wifi-bands@griffit.gmail.com';

export default class Probe {
    enable() {
        this._dir = GLib.getenv('PROBE_DIR');
        this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => this._tick());
    }

    disable() {
        GLib.source_remove(this._id);
    }

    _ext() {
        return Main.extensionManager.lookup(UUID)?.stateObj ?? null;
    }

    _tick() {
        const path = `${this._dir}/cmd`;
        if (!GLib.file_test(path, GLib.FileTest.EXISTS))
            return GLib.SOURCE_CONTINUE;
        const [, bytes] = GLib.file_get_contents(path);
        const text = new TextDecoder().decode(bytes).trim();
        // Caught between the shell creating the file and writing to it.
        if (text === '')
            return GLib.SOURCE_CONTINUE;
        const [cmd, ...args] = text.split(/\s+/);
        try {
            this._run(cmd, args);
        } catch (e) {
            logError(e, 'probe');
            GLib.file_set_contents(`${this._dir}/error`, `${cmd}: ${e.message}\n`);
        }
        GLib.unlink(path);
        return GLib.SOURCE_CONTINUE;
    }

    _state() {
        const ext = this._ext();
        const toggle = Main.panel.statusArea.quickSettings._network?._wirelessToggle;
        const rows = [];
        for (const [row, {box}] of ext?._chips ?? []) {
            rows.push({
                ssid: row.network.name,
                chips: box.get_children().flatMap(pill => pill.get_children())
                    .filter(a => a instanceof St.Label)
                    .map(l => ({band: l.text, active: l.has_style_class_name('wifi-bands-pill-active')})),
            });
        }
        const item = ext?._item;
        return {
            toggle: toggle !== undefined,
            rows,
            bandVisible: item?.visible ?? false,
            bandMapped: item?.mapped ?? false,
            bandLabel: item?.label?.text ?? null,
            accessPoints: item?.visible
                ? ext._rows._getMenuItems().map(r => r.get_children()[2].get_children().map(l => l.text))
                : [],
            modes: ext?._buttons ? [...ext._buttons].filter(([, b]) => b.checked).map(([m]) => m) : [],
            pinned: ext?._pinSwitch?.state ?? null,
            note: ext?._note?.visible ? ext._note.label.text : '',
            failures: ext?._failures ?? null,
            panelIcons: Main.panel.statusArea.quickSettings._indicators.get_children().filter(c => c.visible).length,
        };
    }

    _run(cmd, args) {
        const qs = Main.panel.statusArea.quickSettings;
        const ext = this._ext();
        switch (cmd) {
        case 'open':
            qs.menu.open();
            break;
        case 'close':
            qs.menu.close();
            break;
        case 'wifi':
            qs._network._wirelessToggle.menu.open();
            break;
        case 'band':
            ext._item.menu.open();
            break;
        case 'mode':
            ext._buttons.get(args[0]).emit('clicked', 0);
            break;
        case 'pin':
            ext._pinSwitch.toggle();
            if (ext._pinSwitch.state !== (args[0] === 'on'))
                ext._pinSwitch.toggle();
            break;
        case 'state':
            GLib.file_set_contents(`${this._dir}/${args[0]}.json`, `${JSON.stringify(this._state())}\n`);
            break;
        case 'shot': {
            const file = Gio.File.new_for_path(`${this._dir}/${args[0]}.png`);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            new Shell.Screenshot().screenshot(false, stream, (o, res) => {
                try {
                    o.screenshot_finish(res);
                } catch (e) {
                    logError(e, 'probe');
                }
                stream.close(null);
            });
            break;
        }
        default:
            throw new Error(`unknown command ${cmd}`);
        }
    }
}
