import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { useEffect, useState } from 'react';

/**
 * Walking-skeleton shell. Mounts FluentProvider with a base theme.
 *
 * NOTE: The CodeMirror 6 editor mount + open/save wiring is Lane B (task #3).
 * This placeholder only proves the renderer boots under FluentProvider and that
 * `window.notepads` is reachable. Lane B replaces the body with the CM6 surface.
 */
export function App(): JSX.Element {
  const [isDark, setIsDark] = useState<boolean>(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <FluentProvider
      theme={isDark ? webDarkTheme : webLightTheme}
      style={{ height: '100vh', backgroundColor: isDark ? '#2E2E2E' : '#F0F0F0' }}
    >
      <div id="app-shell" style={{ height: '100%' }}>
        {/* Lane B mounts the CodeMirror 6 editor here (.cm-content surface). */}
      </div>
    </FluentProvider>
  );
}
