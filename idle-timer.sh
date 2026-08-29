#!/usr/bin/env bash
# SUPERSEDED 2026-08-29 — kept for the one case the session Monitor cannot cover.
#
# The Monitor is the live mechanism: it runs INSIDE the session, so it fires within the
# ~1h reasoning window and the close is written by the instance that lived the session
# rather than reconstructed. This detached timer only matters when the session is already
# gone, and by then the reasoning is gone too — so its only defensible payload is the
# anchor, never the report.
#
# TWO REASONS NOT TO RUN IT CASUALLY:
#
# 1. It leaks zombies. setsid reparents the timer to pid 1, which here is `sleep infinity`
#    and never reaps. Measured 2026-08-29: 40 of 51 processes in this container are
#    defunct. Monotonic in a long-lived container.
#
# 2. Its pidfile goes stale silently. .idle.pid recorded 157465 — a zombie from 08-25 —
#    for four days while a live watcher ran under a different pid it never wrote. The
#    tag check below refuses to kill a process that is not ours, so the staleness was
#    harmless; it was still a file asserting something false about the world.
#

# Deadman timer, armed by the Stop hook.
#
# Stop fires at every USER-TURN boundary; there is no session-end event. "The user has
# gone idle" is the closest observable proxy, and it is only knowable by waiting. Each
# Stop CANCELS the pending timer and arms a fresh one.
set -uo pipefail
D=/home/node/scan/1f916
C="$D/continuity"
DELAY="${IDLE_DELAY:-2700}"
PIDF="$C/.idle.pid"
TAG="1f916-idle-timer"          # identity marker, checked before any kill

# Cancel the previous timer. NEVER kill on the strength of a pid alone: a finished timer
# becomes a ZOMBIE here, because setsid reparents it to pid 1 (`sleep infinity`) which
# does not reap. `kill -0` succeeds on a zombie, so a pid file always looks "alive", and a
# recycled pid would mean killing an unrelated process. Verify the cmdline carries our tag.
if [ -f "$PIDF" ]; then
  OLD="$(cat "$PIDF" 2>/dev/null || true)"
  if [ -n "${OLD:-}" ] && [ -r "/proc/$OLD/cmdline" ] \
     && tr '\0' ' ' < "/proc/$OLD/cmdline" 2>/dev/null | grep -q "$TAG"; then
    STATE="$(awk '{print $3}' "/proc/$OLD/stat" 2>/dev/null || echo '?')"
    if [ "$STATE" != "Z" ]; then
      kill "$OLD" 2>/dev/null || true
      echo "$(date -u +%H:%M:%S) reset: cancelled pending timer $OLD" >> "$C/.idle.log"
    fi
  fi
fi

setsid bash -c "# $TAG
sleep $DELAY; exec '$C/on-idle.sh'" >/dev/null 2>&1 &
echo $! > "$PIDF"
echo "$(date -u +%H:%M:%S) armed: pid $! for ${DELAY}s" >> "$C/.idle.log"
exit 0
