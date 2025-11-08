#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT/dist"
ARCHIVE_NAME="offline-dpc-prototype.zip"
ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

pushd "$ROOT" > /dev/null
zip -r "$ARCHIVE_PATH" . \
  -x "./dist/*" \
     "./.git/*" \
     "./node_modules/*" \
     "./backend/node_modules/*" \
     "./mobile/node_modules/*" \
     "*/.expo/*" \
     "*/.expo-shared/*"
popd > /dev/null

echo "Archive created at: $ARCHIVE_PATH"
