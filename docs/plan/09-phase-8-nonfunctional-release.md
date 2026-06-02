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
- [ ] Cold start ≤ 2000 ms; idle RAM ≤ 250 MB; installer ≤ 150 MB; 1MB file open ≤ 300 ms.
- [ ] PA-8 green; all prior `gate/*` tags present.
