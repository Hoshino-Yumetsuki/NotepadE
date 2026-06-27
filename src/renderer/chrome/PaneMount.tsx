import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { TabAnimation } from '../tabs/tokens';

/**
 * C5 — secondary-pane mount transition. Wraps the preview/diff pane content so it
 * fades in (opacity 0→1) and slides a few px from the right (translateX, a
 * compositor-only transform) when it MOUNTS, matching the existing ~160ms motion
 * tokens (TabAnimation.enterMs / brushFadeMs). Only the appearing secondary pane
 * animates — never the editor pane itself. Fully gated by `reduced`: when the user
 * prefers reduced motion the children render at their final state with no
 * transition, so motion-sensitive users see the same instant pane the app always
 * showed. The one-tick state flip (entered) starts from the pre-animation state on
 * the first commit and transitions to the resting state on the next frame.
 */
export function PaneMount(props: { reduced: boolean; children: ReactNode }): JSX.Element {
  const { reduced, children } = props;
  const [entered, setEntered] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setEntered(true);
      return;
    }
    // rAF (not setTimeout): we only need the style to transition AFTER the initial
    // opacity:0 paint commits; a single frame is enough and never starves here
    // because a freshly-mounted, user-triggered pane is on a compositing window.
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);

  // Reduced motion: render children directly, no wrapper transform/transition.
  if (reduced) return <>{children}</>;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateX(0)' : 'translateX(8px)',
        transition: `opacity ${TabAnimation.enterMs}ms ease-out, transform ${TabAnimation.enterMs}ms ease-out`,
        willChange: entered ? 'auto' : 'opacity, transform'
      }}
    >
      {children}
    </div>
  );
}
