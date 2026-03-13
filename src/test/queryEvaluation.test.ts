import { describe, it, expect } from 'vitest';
import { evaluateQueryOnSource } from '../components/QueryEditor';

// ── Helpers ────────────────────────────────────────────────────────────────

const mkSel = (
  guid: string,
  start: number,
  end: number,
  codeGuid: string,
  codebookGuid = 'cb1',
  creatingUser?: string,
): TextSelection => ({
  guid,
  start,
  end,
  code: { codebookGuid, codeGuid },
  creatingUser,
});

/**
 * Build subcodeIndex: each code points to itself and all its descendants.
 * Format: { parentGuid: Set([parentGuid, child1Guid, ...]) }
 */
function mkSubcodeIndex(
  entries: { parent: string; children: string[] }[],
): Record<string, Set<string>> {
  const index: Record<string, Set<string>> = {};
  for (const { parent, children } of entries) {
    index[parent] = new Set([parent, ...children]);
  }
  return index;
}

/**
 * Build codebookIndex: each codebook points to all its code GUIDs.
 */
function mkCodebookIndex(
  entries: { codebook: string; codes: string[] }[],
): Record<string, Set<string>> {
  const index: Record<string, Set<string>> = {};
  for (const { codebook, codes } of entries) {
    index[codebook] = new Set(codes);
  }
  return index;
}

const emptySubcodes: Record<string, Set<string>> = {};
const emptyCodebooks: Record<string, Set<string>> = {};

// ── null query → return all (filtered) selections ─────────────────────────

describe('evaluateQueryOnSource — null query', () => {
  it('returns all selections when query is null and no user filter', () => {
    const sels = [mkSel('s1', 0, 5, 'c1'), mkSel('s2', 10, 15, 'c2')];
    const result = evaluateQueryOnSource(null, [], emptySubcodes, emptyCodebooks, sels);
    expect(result).toEqual(sels);
  });

  it('filters by user when userFilter is provided', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1', 'alice'),
      mkSel('s2', 10, 15, 'c2', 'cb1', 'bob'),
    ];
    const result = evaluateQueryOnSource(null, ['alice'], emptySubcodes, emptyCodebooks, sels);
    expect(result.map(s => s.guid)).toEqual(['s1']);
  });

  it('includes undefined user when undefined is in userFilter', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1', undefined),
      mkSel('s2', 10, 15, 'c2', 'cb1', 'alice'),
    ];
    const result = evaluateQueryOnSource(null, [undefined], emptySubcodes, emptyCodebooks, sels);
    expect(result.map(s => s.guid)).toEqual(['s1']);
  });
});

// ── code leaf node (includeSubcodes default = true) ───────────────────────

describe('evaluateQueryOnSource — code node', () => {
  it('returns selections matching the exact code (includeSubcodes = false)', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1'),
      mkSel('s2', 10, 15, 'c2'),
    ];
    const node: QueryNode = { type: 'code', codeGuid: 'c1', includeSubcodes: false };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.map(s => s.guid)).toEqual(['s1']);
  });

  it('includes subcodes when includeSubcodes is true (default)', () => {
    // c_parent has subcode c_child
    const subcodes = mkSubcodeIndex([{ parent: 'c_parent', children: ['c_child'] }]);
    const sels = [
      mkSel('s1', 0, 5, 'c_parent'),
      mkSel('s2', 10, 15, 'c_child'),
      mkSel('s3', 20, 25, 'c_other'),
    ];
    const node: QueryNode = { type: 'code', codeGuid: 'c_parent', includeSubcodes: true };
    const result = evaluateQueryOnSource(node, [], subcodes, emptyCodebooks, sels);
    expect(result.map(s => s.guid)).toEqual(['s1', 's2']);
  });

  it('returns empty array when no selections match', () => {
    const sels = [mkSel('s1', 0, 5, 'c2')];
    const node: QueryNode = { type: 'code', codeGuid: 'c1', includeSubcodes: false };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result).toEqual([]);
  });
});

// ── codebook leaf node ─────────────────────────────────────────────────────

describe('evaluateQueryOnSource — codebook node', () => {
  it('returns selections whose code belongs to the codebook', () => {
    const codebooks = mkCodebookIndex([{ codebook: 'cb1', codes: ['c1', 'c2'] }]);
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1'),
      mkSel('s2', 10, 15, 'c3', 'cb2'), // different codebook
    ];
    const node: QueryNode = { type: 'codebook', codebookGuid: 'cb1' };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, codebooks, sels);
    expect(result.map(s => s.guid)).toEqual(['s1']);
  });
});

// ── OR operator ────────────────────────────────────────────────────────────

describe('evaluateQueryOnSource — OR operator', () => {
  it('returns union of matching selections', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1'),
      mkSel('s2', 10, 15, 'c2'),
      mkSel('s3', 20, 25, 'c3'),
    ];
    const node: QueryNode = {
      type: 'operator',
      operator: 'OR',
      children: [
        { type: 'code', codeGuid: 'c1', includeSubcodes: false },
        { type: 'code', codeGuid: 'c2', includeSubcodes: false },
      ],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.map(s => s.guid)).toEqual(['s1', 's2']);
  });

  it('returns empty array when no children match', () => {
    const sels = [mkSel('s1', 0, 5, 'c_other')];
    const node: QueryNode = {
      type: 'operator',
      operator: 'OR',
      children: [
        { type: 'code', codeGuid: 'c1', includeSubcodes: false },
        { type: 'code', codeGuid: 'c2', includeSubcodes: false },
      ],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result).toEqual([]);
  });
});

// ── AND operator ───────────────────────────────────────────────────────────

describe('evaluateQueryOnSource — AND operator', () => {
  it('returns selections in overlapping segments that satisfy all conditions', () => {
    // s1 and s2 overlap [0,10): a segment [0,5) has s1+s2, [5,10) has s2 only
    const sels = [
      mkSel('s1', 0, 5, 'c1'),   // [0,5)
      mkSel('s2', 0, 10, 'c2'),  // [0,10)
    ];
    const node: QueryNode = {
      type: 'operator',
      operator: 'AND',
      children: [
        { type: 'code', codeGuid: 'c1', includeSubcodes: false },
        { type: 'code', codeGuid: 'c2', includeSubcodes: false },
      ],
    };
    // Segment [0,5) is covered by both s1 (c1) and s2 (c2) → matches AND
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.map(s => s.guid)).toContain('s1');
    expect(result.map(s => s.guid)).toContain('s2');
  });

  it('does not match when conditions are met on non-overlapping segments', () => {
    // s1 and s2 do NOT overlap
    const sels = [
      mkSel('s1', 0, 5, 'c1'),
      mkSel('s2', 10, 15, 'c2'),
    ];
    const node: QueryNode = {
      type: 'operator',
      operator: 'AND',
      children: [
        { type: 'code', codeGuid: 'c1', includeSubcodes: false },
        { type: 'code', codeGuid: 'c2', includeSubcodes: false },
      ],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result).toEqual([]);
  });

  it('returns empty when AND has zero children', () => {
    const sels = [mkSel('s1', 0, 5, 'c1')];
    const node: QueryNode = { type: 'operator', operator: 'AND', children: [] };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result).toEqual([]);
  });

  // Regression test for commit 5dbbf18 ("Fix AND queries").
  // The old implementation evaluated each TextSelection independently:
  //   evaluateQuery(node, selection)  →  AND checked every child against the SAME selection
  // Since each selection has exactly ONE code, an AND(c1, c2) query would ALWAYS return
  // empty — no single selection satisfies two different codes simultaneously.
  //
  // The fix rewrites query evaluation to use atomic text segments.  Each segment knows
  // ALL selections covering it; AND passes when every child matches at least one
  // covering selection.  Two overlapping selections with different codes now satisfy AND.
  it('regression 5dbbf18: AND(c1,c2) matches where two differently-coded selections overlap', () => {
    // The only way for AND(c1, c2) to produce results is via overlapping segments.
    // Old code: each selection tested independently → AND always empty.
    // New code: segment [0,5) is covered by both s1(c1) and s2(c2) → AND matches.
    const sels = [
      mkSel('s1', 0, 5, 'c1'),
      mkSel('s2', 2, 8, 'c2'),
    ];
    const node: QueryNode = {
      type: 'operator',
      operator: 'AND',
      children: [
        { type: 'code', codeGuid: 'c1', includeSubcodes: false },
        { type: 'code', codeGuid: 'c2', includeSubcodes: false },
      ],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    // Both selections should be returned because the overlap region satisfies AND
    expect(result.map(s => s.guid)).toContain('s1');
    expect(result.map(s => s.guid)).toContain('s2');
    // A third selection with no overlap must NOT be returned
    const selsWithExtra = [
      ...sels,
      mkSel('s3', 20, 25, 'c1'), // isolated, no c2 overlap
    ];
    const resultWithExtra = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, selsWithExtra);
    expect(resultWithExtra.map(s => s.guid)).not.toContain('s3');
  });
});

// ── NOT operator ───────────────────────────────────────────────────────────

describe('evaluateQueryOnSource — NOT operator', () => {
  it('returns selections NOT matching the child code', () => {
    // s1: c1, s2: c2 — segments are non-overlapping
    const sels = [
      mkSel('s1', 0, 5, 'c1'),
      mkSel('s2', 10, 15, 'c2'),
    ];
    const node: QueryNode = {
      type: 'operator',
      operator: 'NOT',
      children: [{ type: 'code', codeGuid: 'c1', includeSubcodes: false }],
    };
    // Segment [0,5) has c1 → NOT fails
    // Segment [10,15) has c2 → NOT passes → s2 is returned
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.map(s => s.guid)).toEqual(['s2']);
  });

  it('returns empty when NOT has zero children', () => {
    const sels = [mkSel('s1', 0, 5, 'c1')];
    const node: QueryNode = { type: 'operator', operator: 'NOT', children: [] };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result).toEqual([]);
  });
});
