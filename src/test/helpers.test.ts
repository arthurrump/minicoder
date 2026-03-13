import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashBytes, debounce, buildSegments, isPlainText, fileTreeCompare, sanitizeFileName } from '../helpers';

// ── hashBytes ──────────────────────────────────────────────────────────────

describe('hashBytes', () => {
  it('returns a hex string for known input', async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('hello').buffer;
    const hash = await hashBytes(data as ArrayBuffer);
    // SHA-256 of 'hello' is well-known
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns a 64-character lowercase hex string', async () => {
    const data = new Uint8Array(32).buffer;
    const hash = await hashBytes(data);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', async () => {
    const a = new TextEncoder().encode('abc').buffer;
    const b = new TextEncoder().encode('xyz').buffer;
    const hashA = await hashBytes(a as ArrayBuffer);
    const hashB = await hashBytes(b as ArrayBuffer);
    expect(hashA).not.toBe(hashB);
  });

  it('produces the same hash for the same input', async () => {
    const data = new TextEncoder().encode('consistent').buffer;
    const hash1 = await hashBytes(data as ArrayBuffer);
    const hash2 = await hashBytes(data as ArrayBuffer);
    expect(hash1).toBe(hash2);
  });
});

// ── debounce ───────────────────────────────────────────────────────────────

describe('debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not call fn immediately', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls fn after the delay', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('only calls fn once for rapid successive calls (uses latest args)', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    d('b');
    d('c');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('calls fn again after the delay resets', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('first');
    vi.advanceTimersByTime(100);
    d('second');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'first');
    expect(fn).toHaveBeenNthCalledWith(2, 'second');
  });

  it('flush() immediately executes pending call and returns result', () => {
    const fn = vi.fn().mockReturnValue(42);
    const d = debounce(fn, 100);
    d('x');
    const result = d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('x');
    expect(result).toBe(42);
    // Timer should not fire again
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() returns undefined when no pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    expect(d.flush()).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() prevents the pending call from running', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('y');
    d.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() is safe to call when nothing is pending', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    expect(() => d.cancel()).not.toThrow();
  });
});

// ── buildSegments ──────────────────────────────────────────────────────────

describe('buildSegments', () => {
  const mkSel = (guid: string, start: number, end: number): TextSelection => ({
    guid,
    start,
    end,
    code: { codebookGuid: 'cb1', codeGuid: 'c1' },
  });

  it('returns empty array when no selections and no content', () => {
    expect(buildSegments([])).toEqual([]);
  });

  it('returns one segment covering the whole content when no selections given', () => {
    const segs = buildSegments([], 'hello');
    // One segment covering the whole text, no covering selections
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 0, end: 5, text: 'hello', selections: [] });
  });

  it('splits content into three segments around a partial selection', () => {
    const sel = mkSel('s1', 1, 4);
    const segs = buildSegments([sel], 'hello');
    // Expected segments: [0,1), [1,4), [4,5)
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ start: 0, end: 1, text: 'h', selections: [] });
    expect(segs[1]).toMatchObject({ start: 1, end: 4, text: 'ell', selections: [sel] });
    expect(segs[2]).toMatchObject({ start: 4, end: 5, text: 'o', selections: [] });
  });

  it('handles two non-overlapping selections', () => {
    const s1 = mkSel('s1', 0, 2);
    const s2 = mkSel('s2', 3, 5);
    const segs = buildSegments([s1, s2], 'hello');
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ start: 0, end: 2, selections: [s1] });
    expect(segs[1]).toMatchObject({ start: 2, end: 3, selections: [] });
    expect(segs[2]).toMatchObject({ start: 3, end: 5, selections: [s2] });
  });

  it('handles overlapping selections — shared segment has both', () => {
    const s1 = mkSel('s1', 0, 4);
    const s2 = mkSel('s2', 2, 6);
    const segs = buildSegments([s1, s2], 'abcdef');
    // [0,2)→s1, [2,4)→s1+s2, [4,6)→s2
    expect(segs).toHaveLength(3);
    expect(segs[0].selections).toEqual([s1]);
    expect(segs[1].selections).toEqual([s1, s2]);
    expect(segs[2].selections).toEqual([s2]);
  });

  it('omits text when content is not provided', () => {
    const s1 = mkSel('s1', 0, 3);
    const segs = buildSegments([s1]);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('');
  });
});

// ── isPlainText ────────────────────────────────────────────────────────────

describe('isPlainText', () => {
  it('returns true for plain ASCII text', () => {
    expect(isPlainText('Hello, World!\n')).toBe(true);
  });

  it('returns false for strings containing null bytes', () => {
    expect(isPlainText('hello\0world')).toBe(false);
  });

  it('returns true for text with tabs and newlines', () => {
    expect(isPlainText('line1\n\tline2\r\n')).toBe(true);
  });

  it('returns false for high density of non-printable characters', () => {
    // Build a string where > 30% chars are non-printable (e.g. chr(1)–chr(8))
    const nonPrintable = Array.from({ length: 100 }, (_, i) => String.fromCharCode((i % 8) + 1)).join('');
    expect(isPlainText(nonPrintable)).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isPlainText('')).toBe(true);
  });

  it('returns true for Unicode text', () => {
    expect(isPlainText('こんにちは 世界')).toBe(true);
  });
});

// ── fileTreeCompare ────────────────────────────────────────────────────────

describe('fileTreeCompare', () => {
  const sort = (...paths: string[]) => [...paths].sort(fileTreeCompare);

  it('files at root come before subdirectory entries', () => {
    const result = sort('dir/file.txt', 'file.txt');
    expect(result).toEqual(['file.txt', 'dir/file.txt']);
  });

  it('sorts files alphabetically within same directory', () => {
    const result = sort('b.txt', 'a.txt', 'c.txt');
    expect(result).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('sorts subdirectory files before deeper nested files', () => {
    const result = sort('a/b/c.txt', 'a/file.txt');
    expect(result).toEqual(['a/file.txt', 'a/b/c.txt']);
  });

  it('returns 0 for identical paths', () => {
    expect(fileTreeCompare('a/b.txt', 'a/b.txt')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(fileTreeCompare('A.txt', 'a.txt')).toBe(0);
  });

  it('complex mixed scenario', () => {
    const result = sort(
      'z/nested/deep.txt',
      'z/top.txt',
      'alpha.txt',
      'beta/item.txt',
    );
    expect(result).toEqual([
      'alpha.txt',
      'beta/item.txt',
      'z/top.txt',
      'z/nested/deep.txt',
    ]);
  });
});

// ── sanitizeFileName ───────────────────────────────────────────────────────

describe('sanitizeFileName', () => {
  it('lowercases the name', () => {
    expect(sanitizeFileName('My Codebook')).toBe('my codebook');
  });

  it('replaces filesystem-invalid characters with underscores', () => {
    expect(sanitizeFileName('file<>:"/\\|?*name')).toBe('file_name');
  });

  it('replaces control characters', () => {
    expect(sanitizeFileName('hello\x00world')).toBe('hello_world');
  });

  it('collapses repeated underscores', () => {
    expect(sanitizeFileName('a***b')).toBe('a_b');
  });

  it('removes leading/trailing dots and underscores', () => {
    expect(sanitizeFileName('.hidden.')).toBe('hidden');
    expect(sanitizeFileName('__name__')).toBe('name');
  });

  it('returns null for empty-after-sanitization names', () => {
    expect(sanitizeFileName('***')).toBe(null);
    expect(sanitizeFileName('...')).toBe(null);
    expect(sanitizeFileName('')).toBe(null);
  });

  it('normalizes whitespace', () => {
    expect(sanitizeFileName('hello   world')).toBe('hello world');
  });

  it('handles typical codebook names', () => {
    expect(sanitizeFileName('Themes & Topics')).toBe('themes & topics');
    expect(sanitizeFileName("User's Notes")).toBe("user's notes");
  });
});
