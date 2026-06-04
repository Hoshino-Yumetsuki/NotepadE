import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  parseArgv,
  resolveCwdRelative,
  isNewInstanceProtocol,
  PROTOCOL_SCHEME,
  NEW_INSTANCE_VERB,
  type ArgvEnv,
} from './argv-parse';

/**
 * Broker argv / activation parsing parity (UWP App.xaml.cs activation argv +
 * NotepadsProtocolService). PURE — no electron, no fs. Asserts the argv→{paths,
 * protocolUrl} decision, the executable / main-entry / app-path skips, the
 * `notepads://newinstance` detection, and cwd-relative resolution (the path the
 * single-instance lock skip makes unreachable from a second e2e launch — covered
 * here as defense-in-depth alongside the in-process MAIN seam).
 */

const ENV: ArgvEnv = { execPath: '/opt/electron/electron', appPath: '/app/notepads' };

describe('resolveCwdRelative', () => {
  it('returns an absolute token unchanged', () => {
    const abs = resolve('/tmp/some/file.txt');
    expect(resolveCwdRelative(abs, '/other/cwd')).toBe(abs);
  });

  it('resolves a bare relative token against the supplied cwd (captured cwd parity)', () => {
    expect(resolveCwdRelative('notes.txt', '/work/dir')).toBe(resolve('/work/dir', 'notes.txt'));
  });

  it('resolves a nested relative token against cwd', () => {
    expect(resolveCwdRelative('sub/notes.txt', '/work')).toBe(resolve('/work', 'sub/notes.txt'));
  });

  it('does NOT use the primary process cwd — only the passed cwd', () => {
    const out = resolveCwdRelative('rel.txt', '/captured/cwd');
    expect(out).toBe(resolve('/captured/cwd', 'rel.txt'));
    expect(out).not.toBe(resolve(process.cwd(), 'rel.txt'));
  });
});

describe('isNewInstanceProtocol', () => {
  it('is false for a null protocol url', () => {
    expect(isNewInstanceProtocol(null)).toBe(false);
  });

  it('is true for the newinstance verb', () => {
    expect(isNewInstanceProtocol(`${PROTOCOL_SCHEME}://${NEW_INSTANCE_VERB}`)).toBe(true);
  });

  it('tolerates a trailing slash', () => {
    expect(isNewInstanceProtocol(`${PROTOCOL_SCHEME}://${NEW_INSTANCE_VERB}/`)).toBe(true);
    expect(isNewInstanceProtocol(`${PROTOCOL_SCHEME}://${NEW_INSTANCE_VERB}///`)).toBe(true);
  });

  it('is case-insensitive on the verb', () => {
    expect(isNewInstanceProtocol(`${PROTOCOL_SCHEME}://NewInstance`)).toBe(true);
    expect(isNewInstanceProtocol(`${PROTOCOL_SCHEME}://NEWINSTANCE`)).toBe(true);
  });

  it('is false for a non-newinstance protocol url (e.g. an open-file verb)', () => {
    expect(isNewInstanceProtocol(`${PROTOCOL_SCHEME}://open?path=x`)).toBe(false);
    expect(isNewInstanceProtocol(`${PROTOCOL_SCHEME}://`)).toBe(false);
  });
});

describe('parseArgv', () => {
  it('captures a single absolute file path', () => {
    const abs = resolve('/docs/readme.txt');
    const out = parseArgv(['/opt/electron/electron', abs], '/cwd', ENV);
    expect(out).toEqual({ paths: [abs], protocolUrl: null });
  });

  it('resolves a bare relative path against cwd (cold-launch file open)', () => {
    const out = parseArgv(['/opt/electron/electron', 'notes.txt'], '/work', ENV);
    expect(out.paths).toEqual([resolve('/work', 'notes.txt')]);
    expect(out.protocolUrl).toBeNull();
  });

  it('skips the electron executable (execPath)', () => {
    const keep = resolve('/a.txt');
    const out = parseArgv([ENV.execPath, keep], '/cwd', ENV);
    expect(out.paths).toEqual([keep]);
  });

  it('skips electron switches (leading dash)', () => {
    const keep = resolve('/keep.txt');
    const out = parseArgv([ENV.execPath, '--enable-foo', '-bar', keep], '/cwd', ENV);
    expect(out.paths).toEqual([keep]);
  });

  it('skips the bundled main entry (.js/.cjs/.mjs) and the app path and "."', () => {
    const real = resolve('/real.txt');
    const out = parseArgv(
      [ENV.execPath, '/app/notepads/out/main/index.js', ENV.appPath, '.', real],
      '/cwd',
      ENV,
    );
    expect(out.paths).toEqual([real]);
  });

  it('captures the notepads:// protocol url and does NOT treat it as a path', () => {
    const url = `${PROTOCOL_SCHEME}://${NEW_INSTANCE_VERB}`;
    const out = parseArgv([ENV.execPath, url], '/cwd', ENV);
    expect(out).toEqual({ paths: [], protocolUrl: url });
  });

  it('captures BOTH a protocol url and file paths in one argv', () => {
    const url = `${PROTOCOL_SCHEME}://open`;
    const out = parseArgv([ENV.execPath, url, 'rel.txt'], '/w', ENV);
    expect(out.protocolUrl).toBe(url);
    expect(out.paths).toEqual([resolve('/w', 'rel.txt')]);
  });

  it('returns empty paths + null url for a bare launch (no file/protocol args)', () => {
    const out = parseArgv([ENV.execPath], '/cwd', ENV);
    expect(out).toEqual({ paths: [], protocolUrl: null });
  });

  it('keeps multiple file paths in order (absolute kept, relative resolved vs cwd)', () => {
    const a = resolve('/a.txt');
    const b = resolve('/b.txt');
    const out = parseArgv([ENV.execPath, a, b, 'c.txt'], '/w', ENV);
    expect(out.paths).toEqual([a, b, resolve('/w', 'c.txt')]);
  });
});
