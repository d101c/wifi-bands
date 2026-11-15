#!/usr/bin/env bash
# Builds wifi-bands@griffit.gmail.com.shell-extension.zip in the repo root.
# Install it with: gnome-extensions install --force <zip>
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$REPO/extension"
DOMAIN="wifi-bands"

# Keep the source tree's .mo files current, for runs straight from a checkout.
for po in "$SRC"/po/*.po; do
    lang="$(basename "$po" .po)"
    dest="$SRC/locale/$lang/LC_MESSAGES"
    mkdir -p "$dest"
    msgfmt --check "$po" -o "$dest/$DOMAIN.mo"
done

gnome-extensions pack "$SRC" \
  --extra-source=model.js \
  --extra-source=wifi.js \
  --extra-source=LICENSE \
  --schema=schemas/org.gnome.shell.extensions.wifi-bands.gschema.xml \
  --podir=po \
  --gettext-domain="$DOMAIN" \
  --out-dir="$REPO" \
  --force

echo "Built: $REPO/wifi-bands@griffit.gmail.com.shell-extension.zip"
