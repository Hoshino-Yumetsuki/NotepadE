# Sign-Off Items & Risk Register

## Items Requiring USER SIGN-OFF Before Build

1. **Acrylic substitute** — static blurred-tint + opacity tokens; wallpaper-sampling host-backdrop dropped. (Phase 0 decision, Phase 7 build.)
2. **Write-restriction divergence** — UWP's block on system32 / `.bat`/`.cmd` associations were sandbox artifacts, not product intent; the rewrite is deliberately *more capable* (Node fs, no re-imposed block). The one intentional 1:1 deviation. **Needs explicit sign-off.** DoD: (a) saving to a path UWP blocked succeeds; (b) opening/associating .bat/.cmd works; (c) session stores absolute paths re-validated on load; (d) one-line release note documents divergence.
3. **Perf targets (SR-8)** — cold start ≤2000ms / RAM ≤250MB / installer ≤150MB / 1MB open ≤300ms are honest Electron ceilings, not UWP parity. Confirm acceptable.
4. **CM6 visual deltas** — CodeMirror 6 caret/selection/line-rendering will not be pixel-identical to RichEditBox; golden-image threshold ≤0.1% is the agreed tolerance. Confirm.
5. **Regex flavor deltas** — JS RegExp cannot express .NET RightToLeft (shimmed), balancing groups, `\Z`/`\z`, .NET named-group syntax. Document + accept.
6. **Smart Copy semantics correction** — confirm we replicate the *actual* trim-on-copy behavior (not "paragraph expansion").
7. **F5 datetime format** — confirm OS-culture-default (source behavior) rather than a fixed string.
8. **Other substitutes (batch sign-off):** compact-overlay → frameless alwaysOnTop; FutureAccessList → re-validated absolute paths (missing = unavailable tab); markdown-it; JS diff lib; middle-click autoscroll → OS-native; jump list → OS recents; share → OS share/clipboard; title bar → `titleBarStyle:hidden`+overlay.
9. **Out-of-scope confirmation:** Game Bar widget, Store/AppCenter telemetry (no-op shims), multi-line handwriting.

## Scope Ledger (settled)

**IN-SCOPE (full behavior parity):** tabbed editing/SetsView; all editor commands + shortcuts; find/replace (incl. regex + find-previous); encoding read/write/convert + EOL; session snapshot + crash recovery; cross-window full-state drag; status bar (8-column flyouts); all settings panes + live theme + accent; markdown preview + diff viewer (functional); print; 29-locale i18n; file associations + `notepads://` + CLI argv/cwd; multi-instance broker; custom title bar; 1MB limit = 1,024,000 bytes.

**IN-SCOPE-WITH-SUBSTITUTE (documented divergence + sign-off):** host-backdrop acrylic → static blurred-tint; compact-overlay F12 → frameless alwaysOnTop; FutureAccessList → absolute paths re-validated; markdown engine → markdown-it; diff engine → JS diff lib; middle-click autoscroll → OS-native; jump list → OS recents; share → OS share/clipboard; title bar → titleBarStyle:hidden+overlay.

**OUT-OF-SCOPE:** Game Bar widget; Store/AppCenter telemetry (no-op shim); multi-line handwriting; RichEditBox internal quirks as such (replicate observable behavior only); Win32 read-only-file write exploit.

## Risk Register

| # | Riskiest unknown | De-risking spike (Phase 0) | Gate that proves it | Rollback / contingency |
|---|---|---|---|---|
| R1 | **Editor-core behavioral parity** (shadow-buffer offsets, undo granularity) | 0.D — CRLF/LF offset map + 4 undo cases | Gate 0 + Gate 3 (line/col match, undo granularity, golden ≤0.1%) | If CM6 offset model can't match UWP line/col on CRLF, fall back to an EOL-aware position-mapping layer; worst case document divergence for sign-off |
| R2 | **Encoding heuristic fidelity** | 0.E — port confidence ladder, 20-file pilot | Gate 3 (0% byte round-trip; ≤2% detection miss) | If jschardet diverges >2%, pin to chardet or port UTF.Unknown's scorer; detection misses documented-acceptable, round-trip must stay 0% |
| R3 | **Cross-window transfer + broker** | 0.C — argv/cwd parse + envelope round-trip across 2 windows | Gate 0 + Gate 6 (full-state adopt/release, void cases) | Route all transfers through MAIN registry (already the design); degrade to "duplicate-to-target + close-source" if live handle transfer fails |
| R4 | **Acrylic feasibility** | 0.A decision spike (translucency approach) | Gate 0 decision + Gate 7 golden (substitute baseline) | Decided as substitute; if static blur underperforms, drop to flat tinted opacity (no blur) — cosmetic only |
| R5 | **.NET regex reverse search** | 0.F — forward-match-all + pick-last shim | Gate 0 + Gate 3 regex-parity fixture (incl. RTL row) | Shim is the rollback; remaining flavor gaps are documented sign-off items (#5), not blockers |
| R6 | **PA-8 retrofit risk** | Built into walking skeleton (Phase 1) | Gate 1 + re-assert every IPC-adding phase | Non-negotiable; if a dependency forces a violation, replace the dependency — build stays broken until clean |
| R7 | **Perf ceiling miss (SR-8)** | Measured continuously from Phase 1 | Gate 8 | Red-flag to user (not silent); mitigations: lazy-load panes, V8 snapshot, defer non-critical IPC |
