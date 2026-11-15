// SPDX-License-Identifier: GPL-2.0-or-later
// Pure rules, no GNOME imports: testable with plain gjs.

// NetworkManager's own names for the band setting of a profile.
export const BAND_2_4 = 'bg';
export const BAND_5 = 'a';

export const GOOD = 0;
export const WEAK = 1;
export const POOR = 2;

// NetworkManager reports a signal strength from 0 to 100, which is the
// signal in dBm plus 120 (-40 dBm is 80, -80 dBm is 40).
const STRONG_FROM = 53;   // about -67 dBm: room to spare for video calls
const POOR_BELOW = 40;    // about -80 dBm: the link keeps dropping
// Another network at this strength on the same channel is a crowd.
const NEIGHBOUR_FROM = 40;
const CROWD = 2;
const SWITCHES_TOO_MANY = 3;

export function bandOf(frequency) {
    if (frequency >= 2400 && frequency < 2500)
        return BAND_2_4;
    if (frequency >= 5150 && frequency < 5900)
        return BAND_5;
    return null;
}

export function channelOf(frequency) {
    if (bandOf(frequency) === BAND_2_4)
        return frequency === 2484 ? 14 : (frequency - 2407) / 5;
    if (bandOf(frequency) === BAND_5)
        return (frequency - 5000) / 5;
    return null;
}

// Channels 52 to 64 and 100 to 144 must give way to weather and military
// radars: a router there can be told to leave without warning.
export function isRadarChannel(frequency) {
    return (frequency >= 5260 && frequency <= 5320) ||
        (frequency >= 5500 && frequency <= 5720);
}

export function dbmOf(strength) {
    return strength - 120;
}

export function sameBssid(a, b) {
    return typeof a === 'string' && typeof b === 'string' &&
        a.toLowerCase() === b.toLowerCase();
}

// Other networks that are close enough to share the air on this frequency.
export function neighbours(ap, all) {
    return all.filter(o => o.ssid !== ap.ssid &&
        o.frequency === ap.frequency &&
        o.strength >= NEIGHBOUR_FROM).length;
}

// How an access point looks, and why. `failures` is how many times it
// refused a connection, `crowd` the neighbours on its channel, `switches`
// how often the laptop was moved between access points lately.
export function rate(ap, {failures = 0, crowd = 0, switches = 0} = {}) {
    const reasons = [];
    let level = GOOD;
    const worsen = (to, reason) => {
        level = Math.max(level, to);
        reasons.push(reason);
    };

    if (ap.strength < POOR_BELOW)
        worsen(POOR, 'very-weak-signal');
    else if (ap.strength < STRONG_FROM)
        worsen(WEAK, 'weak-signal');
    if (failures > 0)
        worsen(POOR, 'failed-before');
    if (isRadarChannel(ap.frequency))
        worsen(WEAK, 'radar-channel');
    if (crowd >= CROWD)
        worsen(WEAK, 'busy-channel');
    if (switches >= SWITCHES_TOO_MANY)
        worsen(WEAK, 'switching');
    return {level, reasons};
}

// The bands a network is on, 5 GHz first, and whether the one in use is there.
export function bandsOf(aps) {
    return [BAND_5, BAND_2_4]
        .map(band => ({band, aps: aps.filter(a => bandOf(a.frequency) === band)}))
        .filter(b => b.aps.length > 0)
        .map(b => ({band: b.band, active: b.aps.some(a => a.active)}));
}

// What a profile is set to: its band and whether it holds one access point.
export function modeOf(band, bssid) {
    return {
        mode: band === BAND_5 || band === BAND_2_4 ? band : 'auto',
        pinned: typeof bssid === 'string' && bssid !== '',
    };
}

export function countRecent(times, now, windowMs) {
    return times.filter(t => now - t <= windowMs).length;
}

// Keeps the failure counts small: the newest `max` access points only.
export function addFailure(failures, bssid, max = 64) {
    const key = bssid.toLowerCase();
    const next = {...failures};
    next[key] = (next[key] ?? 0) + 1;
    const keys = Object.keys(next);
    if (keys.length > max) {
        const drop = keys.filter(k => k !== key).slice(0, keys.length - max);
        for (const k of drop)
            delete next[k];
    }
    return next;
}

export function clearFailure(failures, bssid) {
    const next = {...failures};
    delete next[bssid.toLowerCase()];
    return next;
}
