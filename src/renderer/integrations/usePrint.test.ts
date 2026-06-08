import { describe, it, expect, vi, afterEach } from 'vitest';
import { printDocuments } from './usePrint';

/**
 * Print integration test (Lane B, Phase 6). Asserts printDocuments lays out the
 * print host with the (escaped) document content, drives MAIN's shell.print(), and
 * clears the host afterward — without touching the live app DOM.
 */

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).notepads;
  document.getElementById('np-print-host')?.remove();
  document.getElementById('np-print-style')?.remove();
});

function stubPrintBridge(): ReturnType<typeof vi.fn> {
  const print = vi.fn().mockResolvedValue({ ok: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).notepads = { shell: { print } };
  return print;
}

describe('printDocuments', () => {
  it('is a no-op for an empty document list', async () => {
    const print = stubPrintBridge();
    const result = await printDocuments([]);
    expect(result.ok).toBe(true);
    expect(print).not.toHaveBeenCalled();
  });

  it('populates the print host and invokes the bridge for a single document', async () => {
    const print = stubPrintBridge();
    let hostHtmlDuringPrint = '';
    print.mockImplementation(() => {
      // Capture the host content at the moment MAIN is asked to print.
      hostHtmlDuringPrint = document.getElementById('np-print-host')?.innerHTML ?? '';
      return Promise.resolve({ ok: true });
    });
    await printDocuments([{ title: 'note.txt', text: 'hello' }]);
    expect(print).toHaveBeenCalledTimes(1);
    expect(hostHtmlDuringPrint).toContain('note.txt');
    expect(hostHtmlDuringPrint).toContain('hello');
  });

  it('escapes document title + text in the print host (no HTML injection)', async () => {
    const print = stubPrintBridge();
    let hostHtml = '';
    print.mockImplementation(() => {
      hostHtml = document.getElementById('np-print-host')?.innerHTML ?? '';
      return Promise.resolve({ ok: true });
    });
    await printDocuments([{ title: '<b>t</b>', text: '<script>x</script>' }]);
    expect(hostHtml).not.toContain('<script>');
    expect(hostHtml).toContain('&lt;script&gt;');
    expect(hostHtml).toContain('&lt;b&gt;');
  });

  it('renders one section per document for print-all', async () => {
    const print = stubPrintBridge();
    let count = 0;
    print.mockImplementation(() => {
      count = document.querySelectorAll('#np-print-host .np-print-doc').length;
      return Promise.resolve({ ok: true });
    });
    await printDocuments([
      { title: 'a', text: '1' },
      { title: 'b', text: '2' },
      { title: 'c', text: '3' }
    ]);
    expect(count).toBe(3);
  });

  it('clears the print host after printing resolves', async () => {
    stubPrintBridge();
    await printDocuments([{ title: 'a', text: '1' }]);
    expect(document.getElementById('np-print-host')?.innerHTML).toBe('');
  });

  it('clears the print host even if the bridge rejects', async () => {
    const print = stubPrintBridge();
    print.mockRejectedValue(new Error('boom'));
    await expect(printDocuments([{ title: 'a', text: '1' }])).rejects.toThrow('boom');
    expect(document.getElementById('np-print-host')?.innerHTML).toBe('');
  });

  it('injects the print-only stylesheet that hides app chrome', async () => {
    stubPrintBridge();
    await printDocuments([{ title: 'a', text: '1' }]);
    const style = document.getElementById('np-print-style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('@media print');
    expect(style?.textContent).toContain('np-print-host');
  });
});
