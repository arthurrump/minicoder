import { describe, it, expect } from 'vitest';
import {
  findOverlapping,
  flattenCodes,
  computeCollapsedRegions,
  buildMatchGroups,
  type MatchGroup,
} from '../components/MatchingSelections';

// ── Helpers ────────────────────────────────────────────────────────────────

const mkSel = (
  guid: string,
  start: number,
  end: number,
  codeGuid = 'c1',
  codebookGuid = 'cb1',
): TextSelection => ({ guid, start, end, code: { codebookGuid, codeGuid } });

const mkCode = (guid: string, name: string, color = '#ff0000', subcodes: Code[] = []): Code => ({
  guid,
  name,
  color,
  description: '',
  subcodes,
});

const mkCodebook = (guid: string, name: string, codes: Code[]): Codebook => ({
  guid,
  name,
  codes,
});

// ── findOverlapping ────────────────────────────────────────────────────────

describe('findOverlapping', () => {
  const sorted = [
    mkSel('s1', 0, 5),
    mkSel('s2', 3, 10),
    mkSel('s3', 8, 15),
    mkSel('s4', 20, 30),
  ];

  it('returns all selections that overlap the query interval', () => {
    const result = findOverlapping(sorted, 4, 9);
    expect(result.map(s => s.guid)).toEqual(['s1', 's2', 's3']);
  });

  it('returns empty array when no selection overlaps', () => {
    expect(findOverlapping(sorted, 16, 19)).toEqual([]);
  });

  it('handles exact boundary matches (inclusive start, exclusive end)', () => {
    // [5,8): overlaps s2 [3,10) but not s1 [0,5) (s1.end === interval.start)
    const result = findOverlapping(sorted, 5, 8);
    expect(result.map(s => s.guid)).toEqual(['s2']);
  });

  it('returns empty for empty sorted array', () => {
    expect(findOverlapping([], 0, 10)).toEqual([]);
  });
});

// ── flattenCodes ──────────────────────────────────────────────────────────

describe('flattenCodes', () => {
  it('returns empty array for codebooks with no codes', () => {
    expect(flattenCodes([mkCodebook('cb1', 'Book', [])])).toEqual([]);
  });

  it('returns flat list for codes without subcodes', () => {
    const codes = [mkCode('c1', 'Alpha'), mkCode('c2', 'Beta')];
    const result = flattenCodes([mkCodebook('cb1', 'Book', codes)]);
    expect(result.map(r => r.code.guid)).toEqual(['c1', 'c2']);
  });

  it('includes subcodes with correct path', () => {
    const child = mkCode('c1_1', 'Child');
    const parent = mkCode('c1', 'Parent', '#ff0000', [child]);
    const result = flattenCodes([mkCodebook('cb1', 'Book', [parent])]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ code: parent, path: ['Book', 'Parent'] });
    expect(result[1]).toMatchObject({ code: child, path: ['Book', 'Parent', 'Child'] });
  });

  it('handles multiple codebooks', () => {
    const cb1 = mkCodebook('cb1', 'A', [mkCode('c1', 'Code1')]);
    const cb2 = mkCodebook('cb2', 'B', [mkCode('c2', 'Code2')]);
    const result = flattenCodes([cb1, cb2]);
    expect(result.map(r => r.code.guid)).toEqual(['c1', 'c2']);
  });
});

// ── computeCollapsedRegions ────────────────────────────────────────────────

describe('computeCollapsedRegions', () => {
  const mkGroup = (
    content: string,
    selections: TextSelection[],
    matchingGuids?: Set<string>,
  ): MatchGroup => ({
    sourcePath: 'test.txt',
    start: 0,
    end: content.length,
    content,
    selections,
    matchingGuids,
  });

  it('returns single full region when no matchingGuids', () => {
    const group = mkGroup('hello world', [mkSel('s1', 0, 5)]);
    const regions = computeCollapsedRegions(group);
    expect(regions).toHaveLength(1);
    expect(regions[0].content).toBe('hello world');
    expect(regions[0].offsetInGroup).toBe(0);
  });

  it('returns single full region when matchingGuids is empty', () => {
    const group = mkGroup('hello', [], new Set());
    const regions = computeCollapsedRegions(group);
    expect(regions).toHaveLength(1);
    expect(regions[0].content).toBe('hello');
  });

  it('extends matching selection to line boundaries', () => {
    // "line one\nline two\nline three"
    //  01234567 8 9...17  18...27
    const content = 'line one\nline two\nline three';
    const sel = mkSel('s1', 14, 17); // "two"
    const group = mkGroup(content, [sel], new Set(['s1']));
    const regions = computeCollapsedRegions(group);
    expect(regions).toHaveLength(1);
    // Should extend to cover "line two"
    expect(regions[0].content).toBe('line two');
  });

  it('produces multiple regions for non-adjacent matches', () => {
    // Three lines; match first and third line selections
    const content = 'first line\nsecond line\nthird line';
    const s1 = mkSel('s1', 0, 5);    // "first" on line 1
    const s2 = mkSel('s2', 23, 28);  // "third" on line 3
    const group = mkGroup(content, [s1, s2], new Set(['s1', 's2']));
    const regions = computeCollapsedRegions(group);
    expect(regions).toHaveLength(2);
    expect(regions[0].content).toBe('first line');
    expect(regions[1].content).toBe('third line');
  });

  it('adjusts selection offsets relative to the sub-region', () => {
    const content = 'hello\nworld';
    const sel = mkSel('s1', 6, 11); // "world"
    const group = mkGroup(content, [sel], new Set(['s1']));
    const regions = computeCollapsedRegions(group);
    expect(regions).toHaveLength(1);
    expect(regions[0].content).toBe('world');
    expect(regions[0].selections[0].start).toBe(0);
    expect(regions[0].selections[0].end).toBe(5);
  });

  it('marks clipped guids when selection extends beyond the sub-region', () => {
    // Match is mid-line. A non-matching selection spans across the whole content.
    const content = 'line one\nline two';
    const matchSel = mkSel('m1', 5, 8);   // "one" on line 1
    const longSel = mkSel('l1', 0, 17);   // spans everything
    const group = mkGroup(content, [matchSel, longSel], new Set(['m1']));
    const regions = computeCollapsedRegions(group);
    expect(regions[0].clippedGuids.has('l1')).toBe(true);
    expect(regions[0].clippedGuids.has('m1')).toBe(false);
  });
});

// ── buildMatchGroups ───────────────────────────────────────────────────────

describe('buildMatchGroups', () => {
  const plainContent = (content: string): FileContent => ({
    type: 'plain-text',
    hash: 'abc',
    content,
  });

  it('returns empty groups when no sources have matching selections', () => {
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: [mkSel('s1', 0, 5, 'other')] },
    };
    const fileContents: Record<string, FileContent> = {
      'a.txt': plainContent('hello world'),
    };
    const { groups, matchCount } = buildMatchGroups(new Set(['c1']), sources, fileContents);
    expect(groups).toHaveLength(0);
    expect(matchCount).toBe(0);
  });

  it('returns a group for each source that has matching selections', () => {
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: [mkSel('s1', 0, 5, 'c1')] },
      'b.txt': { guid: 'src2', fileHash: 'h2', selections: [mkSel('s2', 0, 5, 'c1')] },
    };
    const fileContents: Record<string, FileContent> = {
      'a.txt': plainContent('hello world'),
      'b.txt': plainContent('other text!'),
    };
    const { groups, matchCount } = buildMatchGroups(new Set(['c1']), sources, fileContents);
    expect(groups).toHaveLength(2);
    expect(matchCount).toBe(2);
  });

  it('sets matchingGuids on each group', () => {
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: [mkSel('s1', 0, 5, 'c1')] },
    };
    const fileContents: Record<string, FileContent> = {
      'a.txt': plainContent('hello world'),
    };
    const { groups } = buildMatchGroups(new Set(['c1']), sources, fileContents);
    expect(groups[0].matchingGuids?.has('s1')).toBe(true);
  });

  it('skips sources with no file content', () => {
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: [mkSel('s1', 0, 5, 'c1')] },
    };
    const { groups } = buildMatchGroups(new Set(['c1']), sources, {});
    expect(groups).toHaveLength(0);
  });

  it('skips binary file content', () => {
    const sources: Record<string, Source> = {
      'a.bin': { guid: 'src1', fileHash: 'h1', selections: [mkSel('s1', 0, 5, 'c1')] },
    };
    const fileContents: Record<string, FileContent> = {
      'a.bin': { type: 'binary', hash: 'h1' },
    };
    const { groups } = buildMatchGroups(new Set(['c1']), sources, fileContents);
    expect(groups).toHaveLength(0);
  });

  it('with showOnlyMatching=true, does not expand to overlapping non-matching selections', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1'),    // matching
      mkSel('s2', 0, 20, 'other'), // overlapping, non-matching
    ];
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: sels },
    };
    const fileContents: Record<string, FileContent> = {
      'a.txt': plainContent('hello world, more text here!'),
    };
    const { groups } = buildMatchGroups(new Set(['c1']), sources, fileContents, true);
    // With showOnlyMatching, only the matching selection range is used
    expect(groups[0].selections.map(s => s.guid)).not.toContain('s2');
  });
});
