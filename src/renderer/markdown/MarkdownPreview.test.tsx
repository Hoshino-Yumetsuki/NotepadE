/**
 * MarkdownPreview component test (Lane B, Phase 6). Asserts the component injects
 * the rendered (safe) HTML returned by the Rust bridge, applies the theme class,
 * re-renders on text change, and threads `hardBreaks` through to the bridge.
 *
 * Render correctness (markdown → HTML, sanitization) is owned by the Rust side
 * (`src-tauri/src/markdown/mod.rs` tests); this asserts only the React wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MarkdownPreview } from './MarkdownPreview';

type RenderResult = { ok: true; data: string } | { ok: false; error: string };
type RenderMock = ReturnType<typeof vi.fn<(text: string, hardBreaks: boolean) => Promise<RenderResult>>>;

function installBridge(impl: (text: string, hardBreaks: boolean) => string): RenderMock {
  const mock: RenderMock = vi.fn(async (text: string, hardBreaks: boolean) => ({
    ok: true as const,
    data: impl(text, hardBreaks)
  }));
  (window as unknown as Record<string, unknown>).notepads = {
    markdown: { render: mock }
  };
  return mock;
}

describe('MarkdownPreview', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).notepads;
  });

  it('renders the HTML returned by the bridge into the preview host', async () => {
    installBridge((text) => `<h1>${text.split('\n')[0].replace(/^#\s*/, '')}</h1>\n<p>world</p>`);
    render(<MarkdownPreview text={'# Hello\n\nworld'} />);
    await waitFor(() => {
      expect(
        screen.getByTestId('markdown-preview').querySelector('h1')?.textContent
      ).toBe('Hello');
    });
  });

  it('applies the dark theme class when isDark', async () => {
    installBridge(() => '<p>hi</p>');
    render(<MarkdownPreview text="hi" isDark />);
    expect(screen.getByTestId('markdown-preview').className).toContain('np-md-dark');
  });

  it('applies the light theme class by default', async () => {
    installBridge(() => '<p>hi</p>');
    render(<MarkdownPreview text="hi" />);
    expect(screen.getByTestId('markdown-preview').className).toContain('np-md-light');
  });

  it('passes hardBreaks=false to the bridge when strictLineBreaks is true (default)', async () => {
    const mock = installBridge(() => '<p>x</p>');
    render(<MarkdownPreview text="x" />);
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith('x', false);
    });
  });

  it('passes hardBreaks=true to the bridge when strictLineBreaks is false', async () => {
    const mock = installBridge(() => '<p>x</p>');
    render(<MarkdownPreview text="x" strictLineBreaks={false} />);
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith('x', true);
    });
  });

  it('re-invokes the bridge when text changes', async () => {
    const mock = installBridge((text) => `<p>${text}</p>`);
    const { rerender } = render(<MarkdownPreview text="first" />);
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith('first', false);
    });
    rerender(<MarkdownPreview text="second" />);
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith('second', false);
    });
  });
});
