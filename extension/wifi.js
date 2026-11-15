// SPDX-License-Identifier: GPL-2.0-or-later
// The Wi-Fi side: reads access points from NetworkManager and changes the
// band of a profile. No command is run.
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import NM from 'gi://NM';

const MAX_SWITCHES = 20;
// Moves of the laptop right after a change made here are the change itself.
const QUIET_MS = 30 * 1000;

function ssidOf(ap) {
    const bytes = ap.get_ssid();
    return bytes ? NM.utils_ssid_to_utf8(bytes.toArray()) : null;
}

function isCancelled(error) {
    return error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export class Wifi {
    // onChange(): something the menu shows may have changed.
    constructor(onChange) {
        this._onChange = onChange;
        this._cancellable = new Gio.Cancellable();
        this._client = null;
        this._device = null;
        this._single = true;
        this._clientIds = [];
        this._deviceIds = [];
        // When the laptop was moved to another access point, in ms.
        this.switches = [];
        this._quietUntil = 0;
    }

    start(ready) {
        NM.Client.new_async(this._cancellable, (_source, result) => {
            try {
                this._client = NM.Client.new_finish(result);
            } catch (e) {
                if (!isCancelled(e))
                    console.error('wifi-bands', e);
                return;
            }
            this._clientIds = [
                this._client.connect('device-added', () => this._pickDevice()),
                this._client.connect('device-removed', () => this._pickDevice()),
            ];
            this._pickDevice();
            ready();
        });
    }

    // Pending callbacks are cancelled and never called.
    destroy() {
        this._cancellable.cancel();
        this._leaveDevice();
        // GObject's own: NM.Device has a disconnect() of another kind.
        this._clientIds.forEach(id => GObject.signal_handler_disconnect(this._client, id));
        this._clientIds = [];
        this._client = null;
    }

    get available() {
        return this._device !== null;
    }

    // False with several Wi-Fi cards: the Shell then lists each card's
    // networks apart, and this class follows one card only.
    get single() {
        return this._single;
    }

    get activated() {
        return this._device?.get_state() === NM.DeviceState.ACTIVATED;
    }

    _leaveDevice() {
        this._deviceIds.forEach(id => GObject.signal_handler_disconnect(this._device, id));
        this._deviceIds = [];
        this._device = null;
    }

    // The card in use, else the first one.
    _pickDevice() {
        const devices = this._client.get_devices().filter(d => d instanceof NM.DeviceWifi);
        const device = devices.find(d => d.get_active_connection()) ?? devices[0] ?? null;
        this._single = devices.length <= 1;
        if (device !== this._device) {
            this._leaveDevice();
            this._device = device;
            this.switches = [];
            if (device) {
                this._deviceIds = [
                    device.connect('notify::active-access-point', () => {
                        if (device.get_active_access_point() && Date.now() >= this._quietUntil)
                            this.switches = [...this.switches, Date.now()].slice(-MAX_SWITCHES);
                        this._onChange();
                    }),
                    device.connect('state-changed', () => this._onChange()),
                ];
            }
        }
        this._onChange();
    }

    accessPoints() {
        if (!this._device)
            return [];
        const active = this._device.get_active_access_point();
        const list = [];
        for (const ap of this._device.get_access_points()) {
            const ssid = ssidOf(ap);
            const bssid = ap.get_bssid();
            if (ssid && bssid) {
                list.push({
                    bssid, ssid,
                    frequency: ap.get_frequency(),
                    strength: ap.get_strength(),
                    active: ap === active,
                });
            }
        }
        return list;
    }

    // The profile in use, or null when not connected.
    profile() {
        const connection = this._device?.get_active_connection()?.get_connection();
        const wireless = connection?.get_setting_wireless();
        if (!wireless)
            return null;
        return {
            connection,
            uuid: connection.get_uuid(),
            band: wireless.band || null,
            bssid: wireless.bssid || null,
        };
    }

    activeUuid() {
        return this._device?.get_active_connection()?.get_uuid() ?? null;
    }

    connection(uuid) {
        return this._client?.get_connection_by_uuid(uuid) ?? null;
    }

    // Sets the band (and the access point, or null) of a profile, then
    // reconnects it. done(true) once NetworkManager took it, done(false) if
    // it refused; not called at all after destroy().
    apply(connection, band, bssid, done) {
        this._quietUntil = Date.now() + QUIET_MS;
        const wireless = connection.get_setting_wireless();
        const before = {band: wireless.band, bssid: wireless.bssid};
        wireless.band = band;
        wireless.bssid = bssid;
        connection.commit_changes_async(true, this._cancellable, (source, result) => {
            try {
                source.commit_changes_finish(result);
            } catch (e) {
                // The local copy must not keep what was refused.
                wireless.band = before.band;
                wireless.bssid = before.bssid;
                this._failed(e, done);
                return;
            }
            this._client.activate_connection_async(connection, this._device, null,
                this._cancellable, (client, res) => {
                    try {
                        client.activate_connection_finish(res);
                    } catch (e) {
                        this._failed(e, done);
                        return;
                    }
                    done(true);
                });
        });
    }

    _failed(error, done) {
        if (isCancelled(error))
            return;
        console.error('wifi-bands', error);
        done(false);
    }
}
