/**
 * SettingsSurface — the settings pane shell (Phase 5, Stream C; UI-fidelity pass).
 *
 * A RIGHT-side overlay pane (1:1 UWP RootSplitView DisplayMode=Overlay,
 * PanePlacement=Right, OpenPaneLength=385): a dim scrim covers the app and the
 * ~385px pane slides in from the right edge, full height. Dismisses on Esc or a
 * scrim click. Inside it keeps the UWP SettingsPage layout — a vertical nav rail
 * (TextAndEditor / Personalization / Advanced / About) on the left and the active
 * pane on the right.
 *
 * (Replaces the prior centered modal Dialog; the open/close contract — the `open`
 * + `onOpenChange` props the App drives via Ctrl+, / the hamburger menu and
 * the installSettingsTestHook seam — is unchanged, as are every data-testid the
 * Gate-5 e2e relies on: settings-surface / settings-nav / settings-nav-${id} /
 * settings-close.)
 *
 * All four panes read/write the SAME live settings bag (useSettings, lifted to
 * the App so the bag is shared with the live theme + status-bar wiring). Changes
 * persist immediately via settings.set and reconcile via settings.onChanged.
 *
 * PA-8: renderer-only — consumes the settings bag + update callback (window.notepads
 * lives in useSettings/useAppTheme). No fs/path/child_process here.
 */

import { useEffect, useRef, useState } from 'react';
import type { FC } from 'react';
import { Button, FluentProvider, type Theme } from '@fluentui/react-components';
import {
  DismissRegular,
  NavigationRegular,
  TextEditStyleRegular,
  DarkThemeRegular,
  WrenchRegular,
  InfoRegular
} from '@fluentui/react-icons';
import type { Settings } from '@shared/ipc-contract';
import { TextEditorPane } from './TextEditorPane';
import { PersonalizationPane } from './PersonalizationPane';
import { AdvancedPane } from './AdvancedPane';
import { AboutPane } from './AboutPane';
import { acrylicVars, type AppTheme } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import { usePrefersReducedMotion } from '../theme/usePrefersReducedMotion';

/** The four settings sections (UWP SettingsPage NavigationViewItem tags). */
type SectionId = 'textEditor' | 'personalization' | 'advanced' | 'about';

/**
 * Section nav metadata. `labelKey` is the ported UWP NavigationViewItem.Content
 * resource (verified present in all 29 locale tables) so the rail re-localizes
 * live on a language switch; `Icon` is the Fluent UI SVG icon component replacing
 * the Windows-only Segoe MDL2 font glyphs for cross-platform rendering.
 */
const SECTIONS: readonly { id: SectionId; labelKey: string; Icon: FC }[] = [
  { id: 'textEditor', labelKey: 'TextAndEditorPage_Title.Content', Icon: TextEditStyleRegular },
  { id: 'personalization', labelKey: 'PersonalizationPage_Title.Content', Icon: DarkThemeRegular },
  { id: 'advanced', labelKey: 'AdvancedPage_Title.Content', Icon: WrenchRegular },
  { id: 'about', labelKey: 'AboutPage_Title.Content', Icon: InfoRegular }
];

/** UWP RootSplitView.OpenPaneLength — the right pane is 385px wide. */
const PANE_WIDTH = 385;

/** UWP NavigationView PaneDisplayMode=LeftCompact rail widths (compact / expanded). */
const RAIL_COMPACT_WIDTH = 48;
const RAIL_EXPANDED_WIDTH = 200;

export interface SettingsSurfaceProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  settings: Settings;
  update(patch: Partial<Settings>): void;
  /** The Fluent theme to render the surface with (kept in sync with the app). */
  theme: Theme;
  /**
   * Resolved app theme bucket ('light'|'dark'|'hc') — selects the acrylic
   * approximation tint/blur (Phase 7, Task #26). Optional + defaults to 'dark'
   * so existing call sites/tests are unaffected.
   */
  resolvedTheme?: AppTheme;
}

export function SettingsSurface(props: SettingsSurfaceProps): JSX.Element | null {
  const [section, setSection] = useState<SectionId>('textEditor');
  // Rail expand state (UWP NavigationView LeftCompact: a hamburger toggles the rail
  // between an icon-only compact strip and the 200px icon+label open pane).
  const [expanded, setExpanded] = useState(false);
  const { settings, update, open, onOpenChange } = props;
  const resolvedTheme: AppTheme = props.resolvedTheme ?? 'dark';
  const { t } = useT();

  // The active section's localized title (UWP SettingsPanel header TextBlock,
  // FontSize 24, updated per ContentFrame navigation).
  const sectionTitle = SECTIONS.find((s) => s.id === section)?.labelKey ?? '';

  // Slide-in is a CSS keyframe (np-settings-enter, chrome.css) whose RESTING
  // transform is translateX(0) — on-screen. The prior approach held the pane at a
  // React-state translateX(100%) until a double-rAF flipped it; that raced React
  // re-renders (any reconcile while not-yet-entered rewrote the inline transform
  // back off-screen, clobbering the e2e capture pin and dropping nav clicks). With
  // the keyframe, React never writes transform, so the box is always on-screen.
  //
  // `settled` is the perf gate for the heavy backdrop blur: the .np-acrylic
  // backdrop-filter(blur 30px) is suppressed (via data-acrylic-animating) while the
  // pane is in motion and switched on only once it stops (animationend), since
  // re-blurring the full pane each frame as it travels is what stutters.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!open) {
      setSettled(false);
      return;
    }
    // Fallback: guarantee the settled blur even if animationend never arrives
    // (reduced-motion engines skip the animation entirely). Longer than the slide.
    const id = window.setTimeout(() => setSettled(true), 240);
    return () => window.clearTimeout(id);
  }, [open]);

  // Close exit animation (C2). When `open` flips to false we DON'T unmount
  // immediately — we keep the surface rendered and play the reverse slide
  // (np-settings-exit) + scrim fade-out, then unmount on animationend (with a timer
  // fallback for skipped/instant animations). Under reduced motion we unmount at
  // once (no `closing` phase), preserving the historical instant close. `closing`
  // is the gate: render continues while it is true even though `open` is false.
  const reducedMotion = usePrefersReducedMotion();
  const [closing, setClosing] = useState(false);
  // Tracks the previous `open` so we only START a close on a true→false edge (not
  // on the initial false, and not while already closing).
  const wasOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (wasOpen && !open) {
      // Just requested a close.
      if (reducedMotion) {
        setClosing(false);
      } else {
        setClosing(true);
      }
    } else if (open) {
      // Re-opened (possibly mid-close): cancel any pending close phase.
      setClosing(false);
    }
  }, [open, reducedMotion]);

  // Fallback unmount timer for the close slide (animationend is the common path).
  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(() => setClosing(false), 240);
    return () => window.clearTimeout(id);
  }, [closing]);

  // Esc closes the pane (UWP SettingsPage back/close). Bound only while open so it
  // never competes with the editor's own Esc handling (find-bar dismiss etc.).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    // Capture phase so the pane wins Esc over editor-level listeners while open.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onOpenChange]);

  if (!open && !closing) return null;

  return (
    <div
      data-testid="settings-overlay"
      // Dim scrim over the whole app; a click on it (outside the pane) closes.
      onClick={() => onOpenChange(false)}
      className={closing ? 'np-scrim-out' : 'np-scrim-in'}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'flex-end'
      }}
    >
      <FluentProvider
        theme={props.theme}
        data-testid="settings-surface"
        // Fluent's default `applyStylesToPortals` copies THIS provider's className
        // onto the portal mount node it appends to <body> for popups (Dropdown/Menu
        // listboxes). That leaked our slide/acrylic classes (np-settings-enter
        // transform, np-acrylic backdrop-filter) onto the portal node, turning it
        // into a containing block floating-ui doesn't account for — so the
        // language/font/theme dropdowns landed ~a viewport off and drifted on every
        // open. Disabling it makes portals inherit ONLY the theme tokens, so popups
        // anchor to the viewport correctly. The pane itself still themes normally.
        applyStylesToPortals={false}
        className={`np-acrylic ${closing ? 'np-settings-exit' : 'np-settings-enter'}`}
        // While the slide is in flight the heavy backdrop blur is suppressed (see
        // the `settled` gate above + acrylic.css). The attribute is omitted once
        // settled, so the expensive blur only kicks in on the stationary pane.
        data-acrylic-animating={settled && !closing ? undefined : ''}
        // Switch the blur on the moment the slide keyframe finishes (the timeout
        // above is the belt-and-braces fallback for a skipped/instant animation).
        // The exit keyframe finishing unmounts the pane (close C2).
        onAnimationEnd={(e) => {
          if (e.animationName === 'np-settings-enter') setSettled(true);
          else if (e.animationName === 'np-settings-exit') setClosing(false);
        }}
        // Stop scrim-dismiss when the click lands inside the pane itself.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: PANE_WIDTH,
          maxWidth: '100vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          // The slide is owned by the np-settings-enter CSS keyframe (chrome.css);
          // the resting transform is translateX(0), so React never writes an
          // off-screen inline transform that could race a re-render.
          boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
          ...acrylicVars(resolvedTheme)
        }}
      >
        {/* Pane chrome bar: title + close (UWP SplitView pane header). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 12px 8px 16px',
            flex: '0 0 auto'
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 600 }}>
            {t('MainMenu_Button_Settings.Text')}
          </span>
          <Button
            appearance="subtle"
            aria-label={t('SettingsShell_Close.AutomationProperties.Name')}
            data-testid="settings-close"
            icon={<DismissRegular />}
            onClick={() => onOpenChange(false)}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 0,
            flex: '1 1 auto',
            minHeight: 0
          }}
        >
          {/* UWP NavigationView PaneDisplayMode=LeftCompact: a hamburger toggles the
              rail between a 48px icon-only strip and a 200px icon+label pane. The rail
              overlays nothing — it just widens — and items show a selection pill
              (Fluent `secondary` appearance) + keep localized aria-labels/tooltips. */}
          <div
            role="tablist"
            aria-orientation="vertical"
            data-testid="settings-nav"
            style={{
              width: expanded ? RAIL_EXPANDED_WIDTH : RAIL_COMPACT_WIDTH,
              flex: '0 0 auto',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '0 4px',
              boxSizing: 'border-box',
              transition: 'width 150ms ease',
              overflow: 'hidden'
            }}
          >
            <Button
              appearance="subtle"
              aria-label={t('SettingsNav_Expand.AutomationProperties.Name')}
              aria-expanded={expanded}
              data-testid="settings-nav-toggle"
              icon={<NavigationRegular />}
              onClick={() => setExpanded((v) => !v)}
              style={{
                minWidth: 0,
                width: '100%',
                justifyContent: expanded ? 'flex-start' : 'center',
                paddingLeft: expanded ? 10 : 0,
                paddingRight: 0,
                marginBottom: 4
              }}
            />
            {SECTIONS.map((s) => (
              <Button
                key={s.id}
                role="tab"
                aria-selected={section === s.id}
                aria-label={t(s.labelKey)}
                title={t(s.labelKey)}
                appearance={section === s.id ? 'secondary' : 'subtle'}
                icon={<s.Icon />}
                data-testid={`settings-nav-${s.id}`}
                onClick={() => setSection(s.id)}
                style={{
                  minWidth: 0,
                  width: '100%',
                  justifyContent: expanded ? 'flex-start' : 'center',
                  paddingLeft: expanded ? 10 : 0,
                  paddingRight: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden'
                }}
              >
                {/* Label appears only when expanded (icon-only rail otherwise). */}
                {expanded ? t(s.labelKey) : null}
              </Button>
            ))}
          </div>
          {/* Content column: per-section 24px title + bottom-border header
              (UWP SettingsPanel.xaml 60px header row), then the scrolling pane. */}
          <div
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              padding: '0 8px 0 12px'
            }}
          >
            <div
              data-testid="settings-section-title"
              style={{
                flex: '0 0 auto',
                fontSize: 24,
                lineHeight: '1.2',
                fontWeight: 600,
                padding: '0 0 10px 0',
                marginBottom: 8,
                borderBottom: '1px solid var(--colorNeutralStroke2)'
              }}
            >
              {t(sectionTitle)}
            </div>
            <div style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
              {/* Opacity-only cross-fade on section switch (C3). Keying on the
                  section id remounts this wrapper so the np-settings-section
                  keyframe replays for the incoming pane. Compositor-cheap (no
                  layout), and a no-op under reduced motion (CSS @media guard). */}
              <div key={section} className="np-settings-section">
                {section === 'textEditor' ? (
                  <TextEditorPane settings={settings} update={update} />
                ) : null}
                {section === 'personalization' ? (
                  <PersonalizationPane settings={settings} update={update} />
                ) : null}
                {section === 'advanced' ? (
                  <AdvancedPane settings={settings} update={update} />
                ) : null}
                {section === 'about' ? <AboutPane /> : null}
              </div>
            </div>
          </div>
        </div>
      </FluentProvider>
    </div>
  );
}
