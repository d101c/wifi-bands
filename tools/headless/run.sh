#!/usr/bin/env bash
# The extension in a real GNOME Shell, headless, on the real Wi-Fi.
#
#   tools/headless/run.sh             what the menu shows (changes nothing)
#   ACTIONS=1 tools/headless/run.sh   also changes the band of the profile in
#                                     use, one case where the router refuses,
#                                     and puts the profile back
#
# HOME, XDG dirs and the D-Bus session are private to the run, so the real
# dconf and the real extensions are not touched. NetworkManager is the
# system's, though: with ACTIONS=1 the Wi-Fi reconnects a few times.
#
# Outputs in tools/headless/out: *.json (what the menu showed at each step),
# *.png (screenshots), shell.log. LANG=fr_FR.UTF-8 for French; SCALE=2 and
# HEIGHT=1000 for sharper, taller screenshots.
set -u
S="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$S/../.." && pwd)"
T="$S/env"; OUT="$S/out"
UUID="wifi-bands@griffit.gmail.com"

rm -rf "$T" "$OUT"; RT=$(mktemp -d /tmp/wfb.XXXX)
mkdir -p "$T/config" "$T/data/gnome-shell/extensions" "$OUT"
"$REPO/pack.sh" >/dev/null
mkdir -p "$T/data/gnome-shell/extensions/$UUID"
unzip -q "$REPO/$UUID.shell-extension.zip" -d "$T/data/gnome-shell/extensions/$UUID"
glib-compile-schemas "$T/data/gnome-shell/extensions/$UUID/schemas"
cp -r "$S/probe@test" "$T/data/gnome-shell/extensions/"

env -u WAYLAND_DISPLAY -u DISPLAY -u DBUS_SESSION_BUS_ADDRESS \
  HOME="$T" XDG_CONFIG_HOME="$T/config" XDG_DATA_HOME="$T/data" XDG_CACHE_HOME="$RT/c" \
  XDG_RUNTIME_DIR="$RT" GSETTINGS_BACKEND=dconf PROBE_DIR="$OUT" ACTIONS="${ACTIONS:-0}" SCALE="${SCALE:-1}" HEIGHT="${HEIGHT:-800}" \
  dbus-run-session -- "$S/inner.sh"
status=$?
rm -rf "$RT"
exit $status
