#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Everything that needs the Mac's screen, in one pass that runs only while the
# screen is unlocked. Waits for an unlock (every 10 s, up to MAX_WAIT seconds,
# default 12 h), runs once, then exits. Nothing is unlocked or signed here.
#
#   nohup sh native/scripts/mac-gui-pass.sh <run-dir> > <run-dir>/gui-pass.out 2>&1 &
#
# <run-dir> holds native/ (with target/release/lina-proto built), and optionally
# web-dist/ (native/web/build.sh output) and webapp-dist/ (the current web app's
# `npm run build`, served under /app/). Results go to <run-dir>/gui-pass/.
#   1 captures   2 measurements   3 Korean input   4 accessibility, menu, notification
#   5 the web build in Safari
set -u

RUN="$(cd "${1:?usage: mac-gui-pass.sh <run-dir>}" && pwd)"
OUT="$RUN/gui-pass"
MAX_WAIT="${MAX_WAIT:-43200}"
IDLE_SECS="${IDLE_SECS:-1800}"
STATE_BIN="$RUN/bin/mac-screen-state"
CUA="/Applications/LINA Helper.app/Contents/Helpers/cua-driver"
APP="$RUN/native/target/release/LINA Proto.app"
BIN="$RUN/native/target/release/lina-proto"
mkdir -p "$OUT" "$RUN/bin"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$OUT/pass.log"; }
need() { [ -e "$1" ] || { log "missing $1"; exit 4; }; }

if [ ! -x "$STATE_BIN" ]; then
  swiftc -O "$RUN/native/scripts/mac-screen-state.swift" -o "$STATE_BIN" || { log "swiftc failed"; exit 4; }
fi
need "$BIN"

screen_state() { "$STATE_BIN" 2>/dev/null; }

# Wait for an unlock; give up at the deadline.
deadline=$(( $(date +%s) + MAX_WAIT ))
log "waiting for an unlocked screen (pid $$, until $(date -u -r "$deadline" +%Y-%m-%dT%H:%M:%SZ))"
while :; do
  state="$(screen_state)"
  [ "$state" = "unlocked" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    log "deadline reached, screen still $state; nothing ran"
    exit 3
  fi
  sleep 10
done
log "screen unlocked; starting"

# Keep the display awake while the pass runs.
( while :; do caffeinate -u -t 25; done ) &
keepawake=$!
cleanup() {
  kill "$keepawake" 2>/dev/null
  pkill -x lina-proto 2>/dev/null
  [ -n "${server_pid:-}" ] && kill "$server_pid" 2>/dev/null
  [ -n "${leased:-}" ] && lina-helperctl cua.release --arg holder=gpui-proto-pass >/dev/null 2>&1
  log "cleanup done"
}
trap cleanup EXIT

# The app bundle, ad-hoc signed (Developer ID needs a keychain allow, not done here).
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
cp "$RUN/native/app/macos/Info.plist" "$APP/Contents/Info.plist"
cp "$BIN" "$APP/Contents/MacOS/lina-proto"
codesign --force --sign - "$APP" >/dev/null 2>&1

window_info() { # $1 owner name -> "window_id x y w h pid" of its largest layer-0 window
  osascript -l JavaScript -e "
ObjC.import('CoreGraphics');
const list = ObjC.deepUnwrap(ObjC.castRefToObject(\$.CGWindowListCopyWindowInfo(\$.kCGWindowListOptionOnScreenOnly, 0)));
const mine = list.filter(w => w.kCGWindowOwnerName === '$1' && w.kCGWindowLayer === 0)
  .sort((a, b) => b.kCGWindowBounds.Width * b.kCGWindowBounds.Height - a.kCGWindowBounds.Width * a.kCGWindowBounds.Height);
mine.length ? [mine[0].kCGWindowNumber, mine[0].kCGWindowBounds.X, mine[0].kCGWindowBounds.Y, mine[0].kCGWindowBounds.Width, mine[0].kCGWindowBounds.Height, mine[0].kCGWindowOwnerPID].join(' ') : '';
" 2>/dev/null
}

capture() { # $1 name, $2 owner name: captures only that window; refuses while locked
  if [ "$(screen_state)" != "unlocked" ]; then log "capture $1 skipped: screen not unlocked"; return 1; fi
  info="$(window_info "$2")"
  [ -n "$info" ] || { log "capture $1: no window of $2"; return 1; }
  set -- "$1" $info
  if screencapture -x -o -l"$2" "$OUT/$1.png" 2>/dev/null && [ -s "$OUT/$1.png" ]; then
    log "capture $1: window $2 via screencapture -l"
  else
    raw="$OUT/raw-$$.png"
    lina-helperctl screenshot --out "$raw" >/dev/null 2>&1 || { log "capture $1 failed"; return 1; }
    sips -c "$6" "$5" --cropOffset "$4" "$3" "$raw" --out "$OUT/$1.png" >/dev/null 2>&1
    rm -f "$raw"
    log "capture $1: helperctl screenshot cropped to window $2 ($3,$4 $5x$6)"
  fi
}

launch() { # $1 log name, rest: app flags
  name="$1"; shift
  pkill -x lina-proto 2>/dev/null; sleep 1
  open -n "$APP" --stdout "$OUT/$name.log" --stderr "$OUT/$name.log" --args "$@"
  sleep 4
  app_pid="$(pgrep -nx lina-proto)"
  log "launched $name pid ${app_pid:-none} flags: $*"
}

# 1. Captures (synthetic data only; window-only capture)
launch app-captures --conversation c-archive --log-input
capture 01-list-conversation-view "LINA Proto"
sleep 10
capture 02-after-10s-events "LINA Proto"
launch app-captures-draft --conversation c-weekly --draft "안녕하세요, 이번 주 보고 확인 부탁드립니다" --log-input
capture 03-conversation-input "LINA Proto"
sleep 6
capture 04-conversation-after-6s "LINA Proto"

# 2. Measurements: start time, 1,000-message scroll, memory at idle and after IDLE_SECS.
launch app-bench --bench
for _ in $(seq 1 60); do grep -q "lina-bench: scroll done" "$OUT/app-bench.log" && break; sleep 2; done
grep -E "lina-bench" "$OUT/app-bench.log" | tee -a "$OUT/measure.txt"
sleep 5
echo "native rss_kb_idle_start $(ps -o rss= -p "$app_pid")" | tee -a "$OUT/measure.txt"

webcontent_rss() { ps -axo rss=,comm= | awk '/WebContent/ {sum += $1} END {print sum + 0}'; }
if [ -d "$RUN/webapp-dist" ]; then
  mkdir -p "$RUN/webapp-root"; rm -rf "$RUN/webapp-root/app"; cp -R "$RUN/webapp-dist" "$RUN/webapp-root/app"
  python3 "$RUN/native/web/serve.py" "$RUN/webapp-root" 8765 > "$OUT/webapp-http.log" 2>&1 &
  server_pid=$!
  sleep 1
  before="$(webcontent_rss)"
  t0=$(python3 -c 'import time; print(time.time())')
  open -a Safari "http://127.0.0.1:8765/app/?source=synthetic"
  sleep 10
  after="$(webcontent_rss)"
  echo "webapp safari_webcontent_rss_kb before_open=$before after_open_10s=$after (all WebContent processes; other tabs included) opened_at=$t0" | tee -a "$OUT/measure.txt"
  capture 05-current-web-app-safari "Safari"
fi
log "idle for $IDLE_SECS s before the second memory reading"
sleep "$IDLE_SECS"
echo "native rss_kb_after_${IDLE_SECS}s $(ps -o rss= -p "$app_pid")" | tee -a "$OUT/measure.txt"
[ -n "${server_pid:-}" ] && echo "webapp safari_webcontent_rss_kb_after_${IDLE_SECS}s $(webcontent_rss)" | tee -a "$OUT/measure.txt"

# 3. Korean input through cua-driver (keys of the 2-set layout: dkssudgktpdy = 안녕하세요).
launch app-ime --conversation c-weekly --log-input
info="$(window_info "LINA Proto")"; set -- $info; window_id="${1:-0}"
if lina-helperctl cua.lease --arg holder=gpui-proto-pass > "$OUT/cua-lease.json" 2>&1; then leased=1; fi
cua() { "$CUA" call "$1" "$2" >> "$OUT/cua.log" 2>&1; }
key() { cua press_key "{\"pid\":$app_pid,\"window_id\":$window_id,\"key\":\"$1\",\"delivery_mode\":\"foreground\"}"; }
last_input() { grep "lina-ui: input text=" "$OUT/app-ime.log" | tail -1; }
cua bring_to_front "{\"pid\":$app_pid,\"window_id\":$window_id}"
cua hotkey "{\"pid\":$app_pid,\"window_id\":$window_id,\"keys\":[\"ctrl\",\"space\"],\"delivery_mode\":\"foreground\"}"
for k in d k s s u d g k t p d y; do key "$k"; done
sleep 1
echo "ime compose 안녕하세요: $(last_input)" | tee -a "$OUT/ime.txt"
capture 06-ime-composed "LINA Proto"
key space; key d; key k
echo "ime mid-syllable before switch: $(last_input)" | tee -a "$OUT/ime.txt"
finder_pid="$(pgrep -x Finder | head -1)"
[ -n "$finder_pid" ] && cua bring_to_front "{\"pid\":$finder_pid}"
sleep 1
cua bring_to_front "{\"pid\":$app_pid,\"window_id\":$window_id}"
sleep 1
echo "ime after app switch and back: $(last_input)" | tee -a "$OUT/ime.txt"
key g; key k; key s
echo "ime before backspace (expect 한 marked): $(last_input)" | tee -a "$OUT/ime.txt"
key delete
echo "ime after backspace in syllable (expect 하 marked): $(last_input)" | tee -a "$OUT/ime.txt"
capture 07-ime-candidate-position "LINA Proto"
cua hotkey "{\"pid\":$app_pid,\"window_id\":$window_id,\"keys\":[\"ctrl\",\"space\"],\"delivery_mode\":\"foreground\"}"
log "input source switched back with ctrl+space (check it is the original)"
[ -n "${leased:-}" ] && lina-helperctl cua.release --arg holder=gpui-proto-pass >/dev/null 2>&1 && leased=

# 4. Accessibility tree, menu bar, system notification.
launch app-a11y --conversation c-archive --notify-test
lina-helperctl ax.tree --arg bundle_id=system.lina.proto --out "$OUT/ax-tree.json" >/dev/null 2>&1 \
  || lina-helperctl ax.tree --arg bundle_id=system.lina.proto > "$OUT/ax-tree.json" 2>&1
echo "ax tree bytes: $(wc -c < "$OUT/ax-tree.json"); LINA 종료 menu item: $(grep -c 'LINA 종료' "$OUT/ax-tree.json")" | tee -a "$OUT/a11y.txt"
grep "system notification" "$OUT/app-a11y.log" | tee -a "$OUT/a11y.txt"
capture 08-after-notification "LINA Proto"
pkill -x lina-proto

# 5. The GPUI web build in Safari.
if [ -d "$RUN/web-dist" ]; then
  python3 "$RUN/native/web/serve.py" "$RUN/web-dist" 8766 > "$OUT/web-http.log" 2>&1 &
  web_server=$!
  sleep 1
  open -a Safari "http://127.0.0.1:8766/"
  sleep 12
  capture 09-gpui-web-safari "Safari"
  sleep 6
  capture 10-gpui-web-safari-after-6s "Safari"
  kill "$web_server" 2>/dev/null
fi

log "pass finished; Safari tabs opened by this pass are left open"
exit 0
