# Tab-strip golden-image baselines (VERIFICATION GATE 2)

PNG baselines for the tab-strip visual-diff gate (`docs/plan/03` §GATE 2):
`tab strip ≤0.1% pixel delta per theme` (Light / Dark / High-Contrast).

## How these are produced

- The visual e2e (`e2e/tabs-visual.e2e.ts`) screenshots the rendered tab strip
  (`[data-testid="tab-strip"]`) per theme and diffs it against the matching
  `tab-strip-{light,dark,hc}.png` here using pixelmatch (`scripts/visual-diff.ts`),
  threshold ≤0.1% of pixels.
- Files in this directory are tracked via **Git LFS** (see `.gitattributes`:
  `e2e/visual/baselines/**/*.png filter=lfs`). Run `git lfs install` once per clone
  and `git lfs pull` before running the visual suite / in CI.

## Capturing / updating baselines

```
# (re)write any MISSING baseline from the current render, then commit via LFS
npm run visual:capture
```

`visual:capture` sets `NOTEPADS_VISUAL_UPDATE=1`, which only fills in baselines that
do not yet exist. It never overwrites an existing baseline and CI never sets this
flag (no auto-bless). To intentionally re-bless after a deliberate visual change,
delete the stale PNG and re-run capture, then commit.

## ⚠ REQUIRES_UWP_REFERENCE (fidelity sign-off gap)

The initial baselines are captured from THIS React component — a self-referential
regression guard that catches unintended drift between commits. They do **not** yet
prove 1:1 parity with the real UWP `SetsView`.

For true fidelity sign-off, each baseline must be **replaced** with a reference
capture of the real UWP SetsView strip at the same DPI/scale and theme. Those
captures are not yet available and are flagged to the lead (risk register).
