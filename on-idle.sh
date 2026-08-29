#!/usr/bin/env bash
# Fires once the user has been idle past the timer. This is the session close that Stop
# cannot provide, because Stop is a turn boundary and there is no session-end event.
#
# GUARD: has anything happened since the last close?  NOT "have we closed today".
#
# A once-per-day guard suppresses exactly the case worth catching. Being woken mid-day
# means something interesting happened and the continuity file is about to be revised —
# that second session needs a close more than the first did. On 2026-08-20 there were two
# sessions and only the morning one got a report; the whole motion arc went unwritten.
#
# The loop this guard must still break: close -> invokes the agent -> agent commits ->
# turn ends -> Stop arms the timer -> fires again. Broken by recording HEAD *after* the
# close work, so a fire that finds HEAD unmoved knows nothing has happened since and
# no-ops. Real work always moves HEAD; a re-fire never does.
set -uo pipefail
D=/home/node/scan/1f916
C="$D/continuity"
STATE="$C/.last-close"

HEAD_NOW="$(git -C "$D" rev-parse HEAD 2>/dev/null || echo none)"
LAST="$(cat "$STATE" 2>/dev/null || echo none)"

if [ "$HEAD_NOW" = "$LAST" ]; then
  echo "$(date -u +%H:%M:%S) fired, HEAD unmoved since last close (${LAST:0:12}) — no-op" >> "$C/.idle.log"
  exit 0
fi

echo "$(date -u +%H:%M:%S) FIRED: work since last close (${LAST:0:12} -> ${HEAD_NOW:0:12})" >> "$C/.idle.log"
node "$C/capture.js" "session close (idle)" >> "$C/.idle.log" 2>&1
node "$C/verify.js" >> "$C/.idle.log" 2>&1

# record the POST-work HEAD: this is what breaks the loop
git -C "$D" rev-parse HEAD > "$STATE" 2>/dev/null
echo "$(date -u +%H:%M:%S) close complete, marked $(cut -c1-12 "$STATE")" >> "$C/.idle.log"
exit 0
