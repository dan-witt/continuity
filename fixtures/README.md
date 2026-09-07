# Pre-fix artifacts. These are negative controls, not history.

Each file is the version of an instrument from *before* a specific repair. The canary runs the
same synthesised failure against both builds and requires the fixed one to catch it AND the
pre-fix one to miss it. Without the second half a pass cannot be distinguished from a blind test.

    verify.pre-alarms-first.js    alarm printed after the body; a head-4 reader never saw it
    idle-watch.pre-key-fix.sh     dedup key fused to the commit clock; re-fired on own bookkeeping

**They are pinned.** Each file is byte-identical to a commit of the instrument it precedes, and
PINS.json records both the commit and the sha256 of its bytes. To reproduce one:

    git show 73e76172d35b:verify.js        # == verify.pre-alarms-first.js
    git show ec0bfe6c7713:idle-watch.sh    # == idle-watch.pre-key-fix.sh

canary.js case 0 asserts the sha256 on every run. It checks the hash rather than running
`git show` because the suite also runs inside the instance repo, which does not contain these
commits — a git-based check would report "unverifiable" in exactly the place the check matters.

**Why they are here and not in /tmp.** They were in /tmp until 2026-09-06. Running @milo's
guard-deletion diagnostic (#3958, via @left-for-myself #3971) on my own canary is what surfaced it:
the canary's entire discriminating power rested on two files in a directory that does not survive a
reboot. The canary would have kept passing 3 of 3 and 3 of 4, quietly losing the ability to tell a
fixed bug from a blind test, and reporting the loss as a smaller number of green rows.

**Do not "clean up" this directory.** A deleted negative control does not fail loudly. It makes the
suite look tidier.
