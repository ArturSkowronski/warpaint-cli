#!/usr/bin/env bash
# Install the packed tarball the way a stranger would and check the CLI actually works.
#
# `npm test` runs against the working tree and cannot catch install-only breakage: a global
# or npx install resolves the bin through a node_modules/.bin symlink and starts from a $HOME
# with no ~/.minipainting. Both bugs listed in CLAUDE.md slipped through exactly that gap.
#
# Usage: scripts/clean-room-test.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> packing"
tarball="$repo/$(cd "$repo" && npm pack --silent | tail -1)"
test -f "$tarball" || { echo "FAIL: npm pack produced no tarball"; exit 1; }
trap 'rm -rf "$work"; rm -f "$tarball"' EXIT

# A stranger's machine: empty HOME, so no pre-existing inventory.
export HOME="$work/home"
mkdir -p "$HOME" "$work/app"
cd "$work/app"

echo "==> installing $(basename "$tarball") into a throwaway prefix"
npm init -y >/dev/null 2>&1
npm install "$tarball" --no-audit --no-fund --loglevel=error >/dev/null

bin="$work/app/node_modules/.bin"
test -L "$bin/minipainter" || echo "note: $bin/minipainter is not a symlink on this platform"

fail=0
check() {
  local label="$1"; shift
  local out
  if ! out="$("$@" 2>&1)"; then
    echo "FAIL [$label]: exited non-zero"; echo "$out" | sed 's/^/    /'; fail=1; return
  fi
  # Pattern-match, don't pipe and don't strip. `${out//[[:space:]]/}` is quadratic in
  # bash 3.2 (the macOS default) and takes minutes on the ~66 KB `match color` prints;
  # `| grep -q` closes the pipe early, and SIGPIPE trips `set -o pipefail`.
  case "$out" in
    *[![:space:]]*) ;;
    *) echo "FAIL [$label]: no output (is-main-module guard broken under a bin symlink?)"; fail=1; return ;;
  esac
  echo "ok   [$label]"
}

# Read-only commands must work on a fresh install with no inventory file.
check "minipainter paint search" "$bin/minipainter" paint search bone
check "mpaint alias"             "$bin/mpaint"      paint search bone
check "match by hex"             "$bin/mpaint"      match color '#D1A965'
check "inventory list (empty)"   "$bin/mpaint"      inventory list

if [ -e "$HOME/.minipainting/inventory.json" ]; then
  echo "FAIL: a read-only command created $HOME/.minipainting/inventory.json"
  fail=1
else
  echo "ok   [no write on read-only commands]"
fi

# The catalog must be bundled, not fetched.
catalog_out="$("$bin/mpaint" paint search 'imperial gold' 2>&1)"
case "$catalog_out" in
  *"Imperial Gold"*) echo "ok   [catalog bundled]" ;;
  *) echo "FAIL: bundled catalog missing or unreadable from the installed package"
     echo "$catalog_out" | head -5 | sed 's/^/    /'; fail=1 ;;
esac

if [ "$fail" -ne 0 ]; then
  echo; echo "clean-room test FAILED"; exit 1
fi
echo; echo "clean-room test passed"
