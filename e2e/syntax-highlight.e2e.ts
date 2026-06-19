import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';

/**
 * Syntax highlighting (task #8): opening a file with a recognized code
 * extension mounts the extension-matched language and paints token spans;
 * .txt stays plain (Notepad parity).
 */

test('opening a .json file paints syntax-token spans; a .txt stays plain', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notepads-syntax-'));
  const jsonPath = join(dir, 'sample.json');
  const txtPath = join(dir, 'sample.txt');
  writeFileSync(jsonPath, '{"name": "notepads", "count": 42, "ok": true}\n', 'utf8');
  writeFileSync(txtPath, 'plain text body with words 42 true\n', 'utf8');

  const { app, page } = await launchApp();
  try {
    await expect
      .poll(() => page.evaluate(() => !!window.__notepadsTest?.openFileIntoEditor))
      .toBe(true);

    /** Count tokenized spans inside the ACTIVE editor's .cm-content. */
    const tokenSpanCount = () =>
      page.evaluate(() => {
        const host = document.querySelector(
          '[data-testid="editor-host"]:not([style*="display: none"])'
        );
        if (!host) return -1;
        // Lezer highlighting emits class-bearing spans (style-mod ͼ-prefixed
        // classes) inside .cm-line; a plain document has bare text nodes only.
        return host.querySelectorAll('.cm-line span[class]').length;
      });

    // Open the JSON file: tokens must appear (lazy parser chunk loads first).
    await page.evaluate(
      (p) => window.__notepadsTest!.openFileIntoEditor(p),
      jsonPath.replace(/\\/g, '/')
    );
    await expect
      .poll(() => page.evaluate(() => window.__notepadsTest!.getEditorDocText()))
      .toContain('notepads');
    await expect.poll(tokenSpanCount, { timeout: 15_000 }).toBeGreaterThan(2);

    // Open the TXT file: no tokenization (Notepad parity).
    await page.evaluate(
      (p) => window.__notepadsTest!.openFileIntoEditor(p),
      txtPath.replace(/\\/g, '/')
    );
    await expect
      .poll(() => page.evaluate(() => window.__notepadsTest!.getEditorDocText()))
      .toContain('plain text body');
    await expect.poll(tokenSpanCount).toBe(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
