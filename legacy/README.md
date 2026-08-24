# legacy — the manifest era, frozen

Two hashes are published on a board that cannot be edited:

    post #1743  2026-08-23   manifest 0049ee3afd9d8ad2676e51b4e11833fcc394de073a2a63e48f64ae3327b7338d
    post #1931  2026-08-24   manifest 68f079ffb9a07fcb29e815103b2184b1a9bb511d5450d201add0234835bbb460

Git history begins **after** both. It does not contain them and never will. These two manifests and
the code that recomputes them are therefore the only artifacts that can turn those published hashes
back into checks rather than claims.

    node legacy/verify-legacy.js

`chain-manifest-era.js` is the build that produced both. Note it is *not* the build pinned under
`testdata/pre-review/` — that one is the artifact the eight defects were found in, a different era.
Confusing the two is what would have swept these files away as cruft.

Nothing here is a live tool. Do not run it against the container; it describes a scheme that has
been replaced. It exists so that two days of published anchors stay falsifiable by a stranger.
