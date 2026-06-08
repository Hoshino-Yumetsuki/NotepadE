import { test, expect, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { driveOsTheme } from './helpers/settings';
import { TAB_SELECTORS, resetToSingleTab, seedTabs } from './helpers/tabs';

/**
 * VERIFICATION GATE 7 — Reveal brush BEHAVIORAL coverage (lane-h, Task #38).
 *
 * The cursor-follow reveal brush (src/renderer/theme/reveal.ts, Task #27) is
 * GOLDEN-EXCLUDED BY DESIGN: its radial highlight paints at opacity 0 at rest and
 * only lights up while a pointer is genuinely inside a reveal host, so the
 * Gate-2/4/5 golden captures (which never move the mouse before the screenshot)
 * see nothing of it. A golden baseline therefore cannot guard reveal at all.
 *
 * The correct coverage is BEHAVIORAL — drive a real pointer over a real reveal
 * host and assert the live CSS-variable contract `useReveal()` writes:
 *
 *   - REST            : the reveal layer is fully transparent (--reveal-opacity
 *                       unset → the layer's `opacity: var(--reveal-opacity, 0)`
 *                       resolves to 0).
 *   - POINTER INSIDE  : --reveal-opacity === 1, and --reveal-x / --reveal-y hold
 *                       the cursor offset (px) from the host's top-left, so the
 *                       radial-gradient centers under the cursor.
 *   - POINTER LEAVE   : the host's onMouseLeave writes (0,0,0) → layer back to 0.
 *   - HIGH CONTRAST   : tokensForReveal('hc') collapses both tints to transparent,
 *                       so even WITH the pointer inside, the reveal layer's
 *                       radial-gradient paints no color (UWP HC has no material).
 *
 * The reveal host is the tab element itself (data-testid="tab"): useReveal()'s
 * hostRef is composed onto that div, which spreads onPointerMove + onMouseEnter/
 * onMouseLeave and contains the `[data-reveal-layer]` span. We drive trusted mouse
 * events via a CDP session (Input.dispatchMouseEvent) rather than page.mouse.move:
 * the strip's ResizeObserver re-measures on every layout tick, so Playwright's
 * per-action stability auto-wait can stall page.mouse.move (same reason the dnd
 * drag helper uses CDP). Trusted CDP mouse events fire the genuine React handlers.
 *
 * THEME drive: the HC case uses driveOsTheme(app,'dark') + emulateMedia(forced-
 * colors:'active') + page.reload(), matching the Gate-7 golden harness R10/R9
 * flow (useAppTheme only resolves the 'hc' bucket by reading forced-colors AT
 * MOUNT, so HC needs a reload). Light is the default; no golden, no baseline file.
 */

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
});

/** Center of the first tab's bounding box, in viewport px (for trusted moves). */
async function firstTabCenter(
  page: Page
): Promise<{ x: number; y: number; box: { x: number; y: number; width: number; height: number } }> {
  const tab = page.locator(TAB_SELECTORS.tab).first();
  await expect(tab).toBeVisible();
  const box = await tab.boundingBox();
  if (!box) throw new Error('first tab has no bounding box (not laid out)');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/**
 * Move a TRUSTED mouse pointer to (x,y) via CDP, so the React onPointerMove +
 * onMouseEnter handlers fire (page.mouse.move auto-waits on the churning strip
 * and can stall — the dnd helper hits the same wall and also uses CDP).
 */
async function trustedMoveTo(page: Page, x: number, y: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  } finally {
    await client.detach();
  }
}

/** Read a --reveal-* custom property as written on the reveal host (the tab div). */
async function revealVar(
  page: Page,
  name: '--reveal-x' | '--reveal-y' | '--reveal-opacity'
): Promise<string> {
  return page
    .locator(TAB_SELECTORS.tab)
    .first()
    .evaluate((el, prop) => el.style.getPropertyValue(prop).trim(), name);
}

test.describe('reveal brush — live behavioral contract @reveal', () => {
  test('rest → pointer-inside → leave drives --reveal-opacity 0 → 1 → 0', async () => {
    const { app, page } = launched;
    await driveOsTheme(app, 'light');
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    await resetToSingleTab(page);
    await seedTabs(page, 3);

    // REST: nothing has touched the host, so useReveal has never written the var
    // → --reveal-opacity is unset (the layer's `opacity: var(--reveal-opacity, 0)`
    // then resolves to a transparent 0 by its own fallback).
    expect(await revealVar(page, '--reveal-opacity')).toBe('');

    // POINTER INSIDE: a trusted move into the tab lights the reveal to full
    // intensity and records the cursor offset for the radial-gradient center.
    const { x, y, box } = await firstTabCenter(page);
    await trustedMoveTo(page, x, y);
    await expect
      .poll(async () => revealVar(page, '--reveal-opacity'), {
        message: 'pointer inside the tab should set --reveal-opacity to 1'
      })
      .toBe('1');

    // --reveal-x/y are the cursor offset from the host's top-left (clientX-rect.left).
    // Assert they land within the host box and near the tab-center offset we drove to.
    const rx = Number.parseFloat(await revealVar(page, '--reveal-x'));
    const ry = Number.parseFloat(await revealVar(page, '--reveal-y'));
    expect(rx, `--reveal-x should be inside the host width (${box.width})`).toBeGreaterThanOrEqual(
      0
    );
    expect(rx).toBeLessThanOrEqual(Math.ceil(box.width));
    expect(
      ry,
      `--reveal-y should be inside the host height (${box.height})`
    ).toBeGreaterThanOrEqual(0);
    expect(ry).toBeLessThanOrEqual(Math.ceil(box.height));
    // Drove to the center, so the recorded offset should be ~half the box.
    expect(Math.abs(rx - box.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(ry - box.height / 2)).toBeLessThanOrEqual(2);

    // LEAVE: move the pointer far off the strip; onMouseLeave writes (0,0,0).
    await trustedMoveTo(page, x, y + box.height * 6);
    await expect
      .poll(async () => revealVar(page, '--reveal-opacity'), {
        message: 'leaving the tab should reset --reveal-opacity to 0'
      })
      .toBe('0');
    // x/y are also zeroed on leave (write(0,0,0)), parking the gradient center.
    expect(Number.parseFloat(await revealVar(page, '--reveal-x'))).toBe(0);
    expect(Number.parseFloat(await revealVar(page, '--reveal-y'))).toBe(0);
  });

  test('high contrast → reveal tint collapses to transparent even under the pointer', async () => {
    const { app, page } = launched;
    // R10 + R9: drive HC exactly like the Gate-7 golden harness (nativeTheme seam +
    // emulateMedia + reload so useAppTheme resolves the 'hc' bucket at mount).
    await driveOsTheme(app, 'dark');
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await resetToSingleTab(page);
    await seedTabs(page, 3);

    // Confirm HC is genuinely live, else the assertion below is meaningless.
    const forcedActive = await page.evaluate(
      () => window.matchMedia('(forced-colors: active)').matches
    );
    expect(forcedActive, 'HC reveal check requires forced-colors: active to be live').toBe(true);

    // Drive the pointer INTO the tab (the only state where reveal would paint).
    const { x, y } = await firstTabCenter(page);
    await trustedMoveTo(page, x, y);

    // The brush still tracks the pointer (opacity var goes to 1) — useReveal is
    // theme-agnostic — but tokensForReveal('hc') made the gradient's hover tint
    // 'transparent', so the radial-gradient paints NO color. Assert the layer's
    // background gradient carries no non-transparent color stop (HC = inert layer).
    await expect.poll(async () => revealVar(page, '--reveal-opacity')).toBe('1');

    const bg = await page
      .locator(`${TAB_SELECTORS.tab} [data-reveal-layer="true"]`)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);

    // revealGradient('hc') = radial-gradient(... transparent 0%, transparent 100%).
    // Either the engine collapses it to 'none', or it serializes a gradient whose
    // only color stops are transparent / rgba(...,0). In NO case may an opaque
    // black/white reveal tint (the light/dark RealHoverColor) appear in HC.
    const hasOpaqueTint =
      /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.\d+/.test(bg) || // light tint rgba(0,0,0,.06)
      /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.\d+/.test(bg); // dark tint rgba(255,255,255,.08)
    expect(hasOpaqueTint, `HC reveal layer must carry no opaque tint (got: ${bg})`).toBe(false);
  });
});
