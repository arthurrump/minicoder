import { describe, it, expect } from 'vitest';
import {
  findOverlapping,
  flattenCodes,
  computeCollapsedRegions,
  buildMatchGroups,
  type MatchGroup,
} from '../components/MatchingSelections';
import { FileContent } from '../store';

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

  // Regression test for commit 95f524e ("Fix overlap finding in query matches").
  // The old implementation binary-searched on `end` values, but selections are
  // sorted by `start`.  When end values are not monotone (an early wide-span
  // selection is followed by a narrow one), the binary search would jump past
  // the wide selection and miss it entirely.
  //
  // Input:  [{s:0,e:10}, {s:2,e:3}, {s:8,e:20}]  (sorted by start; end NOT monotone)
  // Query:  [4, 7)
  //
  // The old code binary-searched for the first entry with end > 4:
  //   mid=1 → end=3 ≤ 4 → lo=2
  //   mid=2 → end=20 > 4 → hi=2  →  floor index = 2
  // Then scanned from i=2: start=8 ≥ end=7 → immediate break → returned []  ← WRONG
  //
  // The fix binary-searches for start ≥ 7 (the upper bound), then scans 0..upperBound
  // checking end > 4, which correctly picks up {s:0,e:10}.
  it('regression 95f524e: finds wide-span selections when ends are not monotone', () => {
    // Sorted by start; end is deliberately NOT monotone: 10, 3, 20
    const nonMonotoneEnds = [
      mkSel('wide',  0,  10), // wide span — easy to miss with old binary-search-on-end
      mkSel('narrow', 2, 3),  // narrow, ends before query start
      mkSel('late',  8, 20),  // starts after query end=7
    ];
    // Query [4, 7): only 'wide' (end=10>4, start=0<7) qualifies
    const result = findOverlapping(nonMonotoneEnds, 4, 7);
    expect(result.map(s => s.guid)).toEqual(['wide']);
  });

  // Related: a selection whose end exactly equals the query start does NOT overlap.
  // (The old code used `end <= start` as the binary-search cutoff, so borderline
  //  selections could be included incorrectly; the fix uses `end > start` strictly.)
  it('regression 6809dcf: selection ending exactly at query start is excluded', () => {
    // s_touch ends at exactly 5 (= query start); s_overlap ends at 8 (> 5)
    const withTouching = [mkSel('s_touch', 0, 5), mkSel('s_overlap', 3, 8)];
    const result = findOverlapping(withTouching, 5, 7);
    expect(result.map(s => s.guid)).toEqual(['s_overlap']);
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

  // Regression test for commit 95f524e ("Fix overlap finding in query matches").
  // The old expansion logic was a single-level flatMap:
  //   selections = selections.flatMap(s => [s, ...findOverlapping(allSorted, s.start, s.end)])
  // This only expanded one hop.  If A overlaps B and B overlaps C but A doesn't
  // overlap C directly, C would be missed from the group context.
  //
  // New code performs a transitive fixed-point loop until no new selections are added.
  it('regression 95f524e: transitively expands context through a chain of overlapping selections', () => {
    // A [0,5) matches query (c1)
    // B [3,10) doesn't match (c2) — overlaps A
    // C [7,15) doesn't match (c3) — overlaps B but NOT A directly
    const sels = [
      mkSel('A', 0, 5, 'c1'),
      mkSel('B', 3, 10, 'c2'),
      mkSel('C', 7, 15, 'c3'),
    ];
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: sels },
    };
    const fileContents: Record<string, FileContent> = {
      'a.txt': plainContent('0123456789abcde'), // 15 chars
    };
    const { groups } = buildMatchGroups(new Set(['c1']), sources, fileContents);
    expect(groups).toHaveLength(1);
    const groupGuids = groups[0].selections.map(s => s.guid);
    // All three selections should be in the group (A matched, B+C pulled in transitively)
    expect(groupGuids).toContain('A');
    expect(groupGuids).toContain('B');
    expect(groupGuids).toContain('C');
  });

  // Regression test for commit 95f524e: when the only non-matching selection is found
  // through the repaired findOverlapping (non-monotone ends), it must still be included.
  //
  // Old findOverlapping did a binary search on `end` values. In a start-sorted array
  // the end values are not necessarily monotone, so it could miss a wide-span selection
  // (e.g. [0,10)) when a later entry has a smaller end (e.g. [2,3)).  The fix uses
  // binary search on `start` (which IS monotone), then scans 0..upperBound.
  it('regression 95f524e: context expansion uses corrected findOverlapping', () => {
    // M [4,7) matches the query (c1).
    // W [0,10) is context (c2) — its end=10 is larger than M's end=7, so in
    //   a start-sorted array the ends are NOT monotone: W.end=10, then M.end=7.
    //   The old binary search on `end` could skip W and return no context.
    // After the fix, W is correctly found and the range expands to [0,10).
    const sels = [
      mkSel('W',  0, 10, 'c2'), // wide context (end NOT monotone in start-sorted order)
      mkSel('M',  4,  7, 'c1'), // the match
    ];
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: sels },
    };
    const fileContents: Record<string, FileContent> = {
      'a.txt': plainContent('0123456789'), // 10 chars
    };
    const { groups } = buildMatchGroups(new Set(['c1']), sources, fileContents);
    expect(groups).toHaveLength(1);
    const groupGuids = groups[0].selections.map(s => s.guid);
    // W overlaps M so it must be included as context
    expect(groupGuids).toContain('M');
    expect(groupGuids).toContain('W');
  });

  // Regression test for commit 6809dcf ("Update sorting logic").
  // Selections are sorted by start ascending, then by end DESCENDING (wider first).
  // buildMatchGroups sorts its allSelections this way before building groups, and
  // the resulting group.selections should reflect that order.
  it('regression 6809dcf: group selections are sorted wider-first for same start', () => {
    // Both selections start at 0; the wider one (end=10) should appear first.
    const sels = [
      mkSel('narrow', 0, 5, 'c1'),
      mkSel('wide',   0, 10, 'c1'),
    ];
    const sources: Record<string, Source> = {
      'a.txt': { guid: 'src1', fileHash: 'h1', selections: sels },
    };
    const fileContents: Record<string, FileContent> = {
      'a.txt': plainContent('0123456789'), // 10 chars
    };
    const { groups } = buildMatchGroups(new Set(['c1']), sources, fileContents);
    expect(groups).toHaveLength(1);
    const guids = groups[0].selections.map(s => s.guid);
    expect(guids[0]).toBe('wide');
    expect(guids[1]).toBe('narrow');
  });
});
