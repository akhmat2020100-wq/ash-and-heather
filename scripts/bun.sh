#!/system/bin/sh
# Launch the Bun runtime bundled inside OpenCode for Android.
# BUN_BE_BUN=1 makes the OpenCode standalone binary behave as the Bun CLI.
set -e

APK=$(pm path com.opencode.android 2>/dev/null | sed -n 's/^package://p' | head -1)
if [ -n "$APK" ]; then
  APPDIR=$(dirname "$APK")
  LIBDIR="$APPDIR/lib/arm64"
else
  BIN=$(find /data/app -path '*com.opencode.android-*/lib/arm64/libopencode2_bin.so' 2>/dev/null | head -1)
  LIBDIR=$(dirname "$BIN")
fi

BIN="$LIBDIR/libopencode2_bin.so"
LOADER="$LIBDIR/libld_musl.so"
PREFIX=/data/data/com.opencode.android/files

if [ ! -x "$BIN" ]; then
  echo "bun: cannot find $BIN" >&2
  exit 1
fi

export BUN_BE_BUN=1
exec "$LOADER" \
  --library-path "$PREFIX/usr/lib:$PREFIX/home/lib:$LIBDIR" \
  "$BIN" "$@"
