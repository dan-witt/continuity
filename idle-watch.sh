#!/usr/bin/env bash
# Session monitor: emit an event ONLY when the user is idle past the threshold AND there is
# real work to close out.
#
# WHY THE WORK CHECK IS IN HERE AND NOT DOWNSTREAM. The close is itself a turn, so it moves
# the turn stamp and re-arms this watch — which fires again 45 minutes later, forever, once
# per idle period for the life of the session. Each fire costs a turn even when it correctly
# no-ops. Observed 2026-08-25: fired 08:55 (real work, closed), then again 09:42 with
# HEAD == .last-close and nothing to do. The guard existed in on-idle.sh and this path
# bypassed it, which is the operator's predicted failure mode arriving by the side door.
#
# Idle alone is not a reason to wake anyone. Idle PLUS unclosed work is.
set -uo pipefail
D=/home/node/scan/1f916
C="$D/continuity"
STAMP="$C/.last-turn"
CLOSED="$C/.last-close"
THRESH="${IDLE_THRESHOLD:-2700}"
POLL="${IDLE_POLL:-60}"
last_emit=""

# One line at startup. Added 2026-09-05. This watch is SILENT in three states — not idle,
# idle-but-already-closed, and dead — and on 09-04 the third one held all day while I read
# the silence as the first. Silence cannot distinguish them, so at minimum make ARMED
# observable: if this line never appears the watch never started, which is now a different
# observation from "nothing to close".
echo "ARMED idle-watch: threshold ${THRESH}s, poll ${POLL}s, last close $(cut -c1-12 "$CLOSED" 2>/dev/null || echo none)"

while true; do
  if [ -f "$STAMP" ]; then
    # Idle is measured from the LATER of the turn stamp and the last commit.
    #
    # RETRACTED 2026-08-29: an earlier version of this comment said hooks "have died
    # twice in three days." They had not. Stop fires once per USER TURN, so a quiet
    # operator and a dead hook are indistinguishable on that signal — see verify.js 4c,
    # which now reports turn-recency with no verdict. Firings/day 08-24..08-28:
    # 10, 16, 15, 2, 2; the 26h "outage" was the gap between my operator's messages.
    #
    # The max() below is still correct, for a weaker and real reason: the turn stamp is
    # sparse. On 2026-08-27 this watch reported 65,287s of idle DURING AN ACTIVE SESSION
    # because the stamp had not moved since the previous turn boundary. Commits track
    # activity between turns; the stamp does not.
    #
    # Commits track activity whether or not the hook lives, so max() degrades to the
    # commit clock instead of to a lie. It cannot see a session that is talking without
    # committing; that is a narrower blind spot than one that grows without bound.
    # TWO CLOCKS, DELIBERATELY SEPARATE — see the key note below. `stamp` is the turn
    # boundary and nothing else; `m` is the activity clock and may be dragged forward by
    # commits. Fusing them is what broke the dedup key on 2026-09-05.
    stamp=$(stat -c %Y "$STAMP" 2>/dev/null || echo 0)
    m="$stamp"
    c=$(git -C "$D" log -1 --format=%ct 2>/dev/null || echo 0)
    [ "$c" -gt "$m" ] && m="$c"
    now=$(date -u +%s)
    idle=$(( now - m ))
    if [ "$idle" -ge "$THRESH" ]; then
      head="$(git -C "$D" rev-parse HEAD 2>/dev/null || echo none)"
      closed="$(cat "$CLOSED" 2>/dev/null || echo none)"
      # emit once per (turn-stamp, HEAD) pair, and only when work is genuinely unclosed
      # Key on the TURN STAMP ALONE, not on (stamp, HEAD). Keying on HEAD meant any
      # commit after the close minted a new key and re-fired — including the close's own
      # bookkeeping, which is guaranteed to exist because closing writes a report and a log.
      # Observed twice: 04:55 fired and closed, 05:0x fired again on the commits the close
      # itself had just made. One idle period deserves one event; the user returning is what
      # earns another, and that is exactly what moves the stamp.
      # FIXED 2026-09-05. This line read key="${m}" while the comment above it said the key
      # was the turn stamp alone. It had not been, since 08-27, when max() began dragging m
      # forward with the commit clock for a different and valid reason (a sparse stamp
      # reported 65,287s of idle mid-session). That max() silently put commit-sensitivity
      # back into the key this comment claims to have removed — and the comment went on
      # asserting the repair for nine days.
      #
      # It re-fired tonight on exactly the predicted path: the close ran at 05:53 and marked
      # HEAD, then the close NOTE was committed, the commit clock moved, m changed, a new key
      # was minted, and 45 minutes later the watch announced unclosed work that was its own
      # bookkeeping. The failure mode the comment describes, arriving by the mechanism it
      # believed it had ruled out.
      key="${stamp}"
      if [ "$head" != "$closed" ] && [ "$last_emit" != "$key" ]; then
        echo "IDLE ${idle}s with unclosed work (${closed:0:12} -> ${head:0:12}) — window open, thinking intact."
        last_emit="$key"
      fi
    fi
  fi
  sleep "$POLL"
done
