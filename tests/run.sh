#!/usr/bin/env bash
# Runs every test: tests/run.sh
set -u
cd "$(dirname "$0")/.."
echo "== model (pure rules)"
gjs -m tests/model.test.js
