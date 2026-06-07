# Phase 8 — Non-Functional Acceptance & Release

**Objective:** Verify the SR-8 measured ceilings and package.

## Tasks

- Measure cold start, idle RAM, installer size, 1MB open latency.
- electron-builder packaging (Windows primary; per-OS as needed).
- Final PA-8 re-assert.

## Non-functional targets (red-flag divergence if unmet, NOT silent failure)

These are honest Electron-achievable ceilings, not UWP parity (UWP would be ~2-4x better):

- Cold start ≤ 2000 ms
- Idle RAM ≤ 250 MB
- Installer ≤ 150 MB
- 1 MB file open ≤ 300 ms

If a target cannot be met, it is a red-flag divergence requiring user sign-off — not a silent miss. Mitigations: lazy-load panes (UWP `x:Load=false` parity), V8 snapshot, defer non-critical IPC.

## VERIFICATION GATE 8

- [x] Cold start ≤ 2000 ms (**492 ms**); idle RAM ≤ 250 MB (**164 MB**); 1 MB file open ≤ 300 ms (**27 ms**) — measured via `yarn measure` (`scripts/measure-nonfunctional.mjs`) on the built app, 2026-06-07.
- [x] Installer ≤ 150 MB (**121 MB**) — NSIS installer `Notepads Setup 0.0.0.exe` built via `yarn dist` (electron-builder 26.15.0), 2026-06-07. Unsigned (no code-signing cert on this box) + default Electron icon; signing + branded icon remain release-infra follow-ups.
- [x] PA-8 green (renderer fs-free, 186 files).
- [ ] All prior `gate/*` tags present — release-tagging step (git tags), pending the commit/release decision.
