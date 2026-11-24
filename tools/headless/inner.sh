#!/usr/bin/env bash
# Runs inside the private D-Bus session set up by run.sh.
set -u
S="$(cd "$(dirname "$0")" && pwd)"; T="$S/env"; OUT="$S/out"
UUID="wifi-bands@griffit.gmail.com"
SCHEMAS="$T/data/gnome-shell/extensions/$UUID/schemas"
failed=0
SCALE="${SCALE:-1}"; HEIGHT="${HEIGHT:-800}"

probe() {   # probe <command...>: hand one command to probe@test, wait for it
    echo "$*" > "$OUT/cmd"
    for _ in $(seq 100); do [ -e "$OUT/cmd" ] || return 0; sleep 0.05; done
    echo "probe did not take: $*" >&2; failed=1
}
field() {   # field <state> <key>: value of a key in out/<state>.json
    python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1]))[sys.argv[2]], ensure_ascii=False))" "$OUT/$1.json" "$2"
}
expect() {  # expect <label> <got> <want>
    if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (got $2, want $3)"; failed=1; fi
}
# The router's 2.4 GHz radio drops out of the scan list now and then.
see_24ghz() {
    for _ in 1 2 3 4 5; do
        nmcli -t -f SSID,FREQ dev wifi list --rescan no | grep -q "^$CON:24" && return 0
        nmcli dev wifi rescan ifname "$DEV" >/dev/null 2>&1; sleep 6
    done
    echo "# the 2.4 GHz radio of $CON is not in the scan list"
}
profile() { nmcli -g 802-11-wireless.band,802-11-wireless.bssid con show "$CON" | tr -d '\\' | paste -sd' ' | xargs; }

DEV=$(nmcli -t -f DEVICE,TYPE dev | awk -F: '$2=="wifi"{print $1; exit}')
CON=$(nmcli -t -f NAME,DEVICE con show --active | awk -F: -v d="$DEV" '$2==d{print $1; exit}')
if [ -z "$DEV" ] || [ -z "$CON" ]; then echo "FAIL no Wi-Fi connection to test on" >&2; exit 1; fi
ORIG_BAND=$(nmcli -g 802-11-wireless.band con show "$CON"); ORIG_BSSID=$(nmcli -g 802-11-wireless.bssid con show "$CON" | tr -d '\\')
restore() {
    kill "${SH:-}" 2>/dev/null
    if [ "$ACTIONS" = 1 ]; then
        nmcli con modify "$CON" 802-11-wireless.band "$ORIG_BAND" 802-11-wireless.bssid "$ORIG_BSSID"
        nmcli con up "$CON" ifname "$DEV" >/dev/null 2>&1
    fi
}
trap restore EXIT
echo "# Wi-Fi: $DEV on $CON, profile band='$ORIG_BAND' bssid='$ORIG_BSSID'"

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.desktop.interface color-scheme prefer-dark
[ "$SCALE" = 1 ] || gsettings set org.gnome.desktop.interface scaling-factor "$SCALE"
gnome-shell --headless --wayland --no-x11 --virtual-monitor "$((1280 * SCALE))x$((HEIGHT * SCALE))" --wayland-display=wayland-wfb > "$OUT/shell.log" 2>&1 &
SH=$!
sleep 6
gnome-extensions enable "$UUID"
gnome-extensions enable probe@test
sleep 3

probe state s0
expect "network menu found" "$(field s0 toggle)" true
expect "no Band entry while the menu is closed" "$(field s0 bandMapped)" false
ICONS="$(field s0 panelIcons)"

nmcli dev wifi rescan ifname "$DEV" >/dev/null 2>&1; sleep 6
probe open; sleep 1
probe wifi; sleep 4
probe state s1
echo "# rows: $(field s1 rows)"
expect "the connected network has dots" "$(python3 -c "
import json; r=json.load(open('$OUT/s1.json'))['rows']
print(any(x['ssid']=='$CON' and len(x['chips'])>0 for x in r))")" True
expect "Band entry is there" "$(field s1 bandVisible)" true
expect "mode shown" "$(field s1 modes)" "[\"$( [ -z "$ORIG_BAND" ] && echo auto || echo "$ORIG_BAND")\"]"
expect "nothing added to the top bar" "$(field s1 panelIcons)" "$ICONS"
probe band; sleep 1
probe state s2
echo "# access points: $(field s2 accessPoints)"
echo "# label: $(field s2 bandLabel)"
expect "access points listed" "$(python3 -c "import json; print(len(json.load(open('$OUT/s2.json'))['accessPoints'])>0)")" True
probe shot 1-wifi-menu; sleep 1

if [ "$ACTIONS" = 1 ]; then
    probe mode a; sleep 12
    probe state s3
    expect "5 GHz asked: profile" "$(profile)" "a $ORIG_BSSID"
    expect "5 GHz asked: still connected on 5 GHz" "$(iw dev "$DEV" link | grep -c 'freq: 5')" 1
    expect "5 GHz asked: mode shown" "$(field s3 modes)" '["a"]'
    probe pin on; sleep 12
    ACTIVE=$(iw dev "$DEV" link | awk '/Connected to/{print $3}')
    expect "pinned: profile holds the access point in use" "$(profile | awk '{print tolower($2)}')" "$ACTIVE"
    probe state s4
    expect "pinned: switch shown" "$(field s4 pinned)" true
    probe shot 2-pinned; sleep 1
    probe pin off; sleep 14
    probe mode auto; sleep 14
    expect "back to auto: profile" "$(profile)" ""
    probe state s5
    expect "back to auto: mode shown" "$(field s5 modes)" '["auto"]'

    # This router refuses the 2.4 GHz radio: the change must be taken back.
    see_24ghz
    probe mode bg; sleep 5
    probe state s6
    echo "# note while waiting: $(python3 -c "import json; print(json.load(open('$OUT/s6.json'))['note'])")"
    sleep 40
    probe state s7
    expect "refused: profile back to what it was" "$(profile)" ""
    expect "refused: still connected" "$(nmcli -g GENERAL.STATE dev show "$DEV" | cut -c1-3)" 100
    expect "refused: mode shown again" "$(field s7 modes)" '["auto"]'
    expect "refused: failure remembered" "$(field s7 failures | grep -c e0:04)" 1
    expect "refused: failure saved" "$(gsettings --schemadir "$SCHEMAS" get org.gnome.shell.extensions.wifi-bands failures | grep -c e0:04)" 1
    echo "# note after: $(python3 -c "import json; print(json.load(open('$OUT/s7.json'))['note'])")"
    probe shot 3-refused; sleep 1

    # Turned off while a change is being checked (a locked screen, say): it
    # is checked, and taken back, the next time the extension starts.
    GS="gsettings --schemadir $SCHEMAS get org.gnome.shell.extensions.wifi-bands"
    see_24ghz
    probe mode bg; sleep 4
    gnome-extensions disable "$UUID"; sleep 1.5
    expect "change kept while off" "$($GS pending | grep -c "'band': 'bg'")" 1
    gnome-extensions enable "$UUID"; sleep 45
    expect "resumed: profile back" "$(profile)" ""
    expect "resumed: nothing pending" "$($GS pending)" "@a{ss} {}"
    expect "resumed: refusal counted" "$($GS failures | grep -o "e0:04': [0-9]*")" "e0:04': 2"
fi

gnome-extensions disable "$UUID"; sleep 1.5
probe state s8
expect "disable removes the dots" "$(field s8 rows)" "[]"
expect "disable removes the Band entry" "$(field s8 bandVisible)" false

# A closing session: the Shell destroys the menus without calling disable(),
# and the Wi-Fi card still reports changes. Nothing of ours may run on them.
gnome-extensions enable "$UUID"; sleep 3
probe open; sleep 1
probe wifi; sleep 3
probe state s9
expect "closing: Band entry was there" "$(field s9 bandVisible)" true
probe closing; sleep 2
expect "closing: nothing of ours runs on the destroyed menu" \
    "$(sed -n '/probe: session closing/,$p' "$OUT/shell.log" | grep -c "$UUID")" 0

[ -e "$OUT/error" ] && { echo "FAIL probe errors:"; cat "$OUT/error"; failed=1; }
echo "=== shell.log (extension lines)"
grep -i -E "wifi-bands|JS ERROR|probe" "$OUT/shell.log" | tail -20
exit $failed
