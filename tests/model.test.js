// SPDX-License-Identifier: GPL-2.0-or-later
// gjs -m tests/model.test.js
import {
    BAND_2_4, BAND_5, GOOD, WEAK, POOR,
    bandOf, channelOf, isRadarChannel, dbmOf, sameBssid, neighbours, rate,
    bandsOf, modeOf, countRecent, addFailure, clearFailure,
} from '../extension/model.js';

let failed = 0;
function check(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok)
        failed++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

check('2.4 GHz band', bandOf(2462), BAND_2_4);
check('5 GHz band', bandOf(5180), BAND_5);
check('upper 5 GHz band', bandOf(5745), BAND_5);
check('60 GHz is no band of ours', bandOf(58320), null);
check('channel 1', channelOf(2412), 1);
check('channel 11', channelOf(2462), 11);
check('channel 14', channelOf(2484), 14);
check('channel 36', channelOf(5180), 36);
check('channel 128', channelOf(5640), 128);
check('channel of nothing', channelOf(900), null);

check('36 is free of radar', isRadarChannel(5180), false);
check('48 is free of radar', isRadarChannel(5240), false);
check('52 has radar', isRadarChannel(5260), true);
check('64 has radar', isRadarChannel(5320), true);
check('128 has radar', isRadarChannel(5640), true);
check('149 is free of radar', isRadarChannel(5745), false);
check('2.4 GHz has no radar', isRadarChannel(2437), false);

check('dBm of 39', dbmOf(39), -81);
check('same BSSID, other case', sameBssid('6C:99:61:43:E0:05', '6c:99:61:43:e0:05'), true);
check('other BSSID', sameBssid('6C:99:61:43:E0:05', '6C:99:61:43:E0:04'), false);
check('no BSSID', sameBssid(null, '6c:99:61:43:e0:05'), false);

const ap = (strength, frequency, ssid = 'home') => ({bssid: 'x', ssid, strength, frequency});
check('strong and free is good', rate(ap(70, 5180)), {level: GOOD, reasons: []});
check('weak signal', rate(ap(47, 5180)), {level: WEAK, reasons: ['weak-signal']});
check('very weak signal', rate(ap(30, 5180)), {level: POOR, reasons: ['very-weak-signal']});
check('limit between good and weak', rate(ap(53, 5180)).level, GOOD);
check('limit between weak and poor', rate(ap(40, 5180)).level, WEAK);
check('radar channel downgrades a strong signal', rate(ap(80, 5640)), {level: WEAK, reasons: ['radar-channel']});
check('refused before is poor', rate(ap(80, 5180), {failures: 1}), {level: POOR, reasons: ['failed-before']});
check('crowded channel', rate(ap(80, 2437), {crowd: 2}), {level: WEAK, reasons: ['busy-channel']});
check('one neighbour is no crowd', rate(ap(80, 2437), {crowd: 1}).level, GOOD);
check('keeps switching', rate(ap(80, 5180), {switches: 3}), {level: WEAK, reasons: ['switching']});
check('reasons add up, worst level wins',
    rate(ap(30, 5640), {crowd: 3}), {level: POOR, reasons: ['very-weak-signal', 'radar-channel', 'busy-channel']});

const all = [ap(60, 2437, 'a'), ap(55, 2437, 'b'), ap(30, 2437, 'c'), ap(50, 2437, 'd'), ap(50, 5180, 'e')];
check('neighbours count strong others on the same frequency', neighbours(all[0], all), 2);
check('a network is not its own neighbour', neighbours(ap(60, 2437, 'a'), [ap(60, 2437, 'a')]), 0);

const on = (frequency, active = false) => ({bssid: 'x', ssid: 'home', strength: 60, frequency, active});
check('5 GHz is listed first', bandsOf([on(2462), on(5180)]), [
    {band: BAND_5, active: false}, {band: BAND_2_4, active: false}]);
check('a network on one band', bandsOf([on(2462)]), [{band: BAND_2_4, active: false}]);
check('the band in use', bandsOf([on(2462), on(5180, true)]), [
    {band: BAND_5, active: true}, {band: BAND_2_4, active: false}]);
check('in use on a weaker access point of the band',
    bandsOf([on(5180), on(5240, true)]), [{band: BAND_5, active: true}]);
check('no access point', bandsOf([]), []);

check('auto mode', modeOf(null, null), {mode: 'auto', pinned: false});
check('5 GHz mode', modeOf('a', null), {mode: 'a', pinned: false});
check('2.4 GHz pinned', modeOf('bg', '6C:99:61:43:E0:04'), {mode: 'bg', pinned: true});
check('empty BSSID is not pinned', modeOf(null, ''), {mode: 'auto', pinned: false});

check('recent times', countRecent([1000, 5000, 9000], 10000, 6000), 2);
check('no times', countRecent([], 10000, 6000), 0);

let f = addFailure({}, '6C:99:61:43:E0:04');
f = addFailure(f, '6c:99:61:43:e0:04');
check('failures are counted per lowercase BSSID', f, {'6c:99:61:43:e0:04': 2});
check('failure forgotten', clearFailure(f, '6C:99:61:43:E0:04'), {});
const many = {};
for (let i = 0; i < 70; i++)
    many[`aa:bb:cc:dd:ee:${i.toString(16).padStart(2, '0')}`] = 1;
check('failure list stays small', Object.keys(addFailure(many, 'aa:bb:cc:dd:ee:ff')).length, 64);
check('the newest failure is kept', 'aa:bb:cc:dd:ee:ff' in addFailure(many, 'aa:bb:cc:dd:ee:ff'), true);

if (failed)
    imports.system.exit(1);
