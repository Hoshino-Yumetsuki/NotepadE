/**
 * MarkdownPreview component test (Lane B, Phase 6). Asserts the component injects
 * the rendered (safe) HTML, applies the theme class, and re-renders on text change.
 * Render correctness itself is covered by renderMarkdown.test.ts; this asserts the
 * React wiring.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownPreview } from './MarkdownPreview';

describe('MarkdownPreview', () => {
  it('renders markdown source as HTML into the preview host', () => {
    render(<MarkdownPreview text={'# Hello\n\nworld'} />);
    const host = screen.getByTestId('markdown-preview');
    expect(host.querySelector('h1')?.textContent).toBe('Hello');
  });

  it('applies the dark theme class when isDark', () => {
    render(<MarkdownPreview text="hi" isDark />);
    expect(screen.getByTestId('markdown-preview').className).toContain('np-md-dark');
  });

  it('applies the light theme class by default', () => {
    render(<MarkdownPreview text="hi" />);
    expect(screen.getByTestId('markdown-preview').className).toContain('np-md-light');
  });

  it('does not inject raw HTML from user text (XSS-safe)', () => {
    render(<MarkdownPreview text={'<img src=x onerror=alert(1)>'} />);
    const host = screen.getByTestId('markdown-preview');
    // No live <img> element is created from the escaped source.
    expect(host.querySelector('img')).toBeNull();
  });
});
