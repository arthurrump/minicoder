import { describe, it, expect } from 'vitest';
import { evaluateQueryOnSource, evaluateQueryWithClausesOnSource, updateQueryNodeAtPath } from '../utils/query';
import type { AppliedCode, QueryNode, TextSelection } from '../models/files';

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
    expect(result.matchingSelections).toEqual(sels);
    expect(result.fileMatch).toBe(false);
  });

  it('filters by user when userFilter is provided', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1', 'alice'),
      mkSel('s2', 10, 15, 'c2', 'cb1', 'bob'),
    ];
    const result = evaluateQueryOnSource(null, ['alice'], emptySubcodes, emptyCodebooks, sels);
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1']);
  });

  it('includes undefined user when undefined is in userFilter', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1', undefined),
      mkSel('s2', 10, 15, 'c2', 'cb1', 'alice'),
    ];
    const result = evaluateQueryOnSource(null, [undefined], emptySubcodes, emptyCodebooks, sels);
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1']);
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
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1']);
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
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1', 's2']);
  });

  it('returns empty array when no selections match', () => {
    const sels = [mkSel('s1', 0, 5, 'c2')];
    const node: QueryNode = { type: 'code', codeGuid: 'c1', includeSubcodes: false };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.matchingSelections).toEqual([]);
    expect(result.fileMatch).toBe(false);
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
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1']);
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
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1', 's2']);
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
    expect(result.matchingSelections).toEqual([]);
  });
});

// ── AND operator ───────────────────────────────────────────────────────────

describe('evaluateQueryOnSource — AND operator', () => {
  it('returns selections in overlapping segments that satisfy all conditions', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1'),
      mkSel('s2', 0, 10, 'c2'),
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
    expect(result.matchingSelections.map(s => s.guid)).toContain('s1');
    expect(result.matchingSelections.map(s => s.guid)).toContain('s2');
  });

  it('does not match when conditions are met on non-overlapping segments', () => {
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
    expect(result.matchingSelections).toEqual([]);
  });

  it('returns empty when AND has zero children', () => {
    const sels = [mkSel('s1', 0, 5, 'c1')];
    const node: QueryNode = { type: 'operator', operator: 'AND', children: [] };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.matchingSelections).toEqual([]);
  });

  it('regression 5dbbf18: AND(c1,c2) matches where two differently-coded selections overlap', () => {
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
    expect(result.matchingSelections.map(s => s.guid)).toContain('s1');
    expect(result.matchingSelections.map(s => s.guid)).toContain('s2');
    const selsWithExtra = [
      ...sels,
      mkSel('s3', 20, 25, 'c1'),
    ];
    const resultWithExtra = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, selsWithExtra);
    expect(resultWithExtra.matchingSelections.map(s => s.guid)).not.toContain('s3');
  });
});

// ── NOT operator ───────────────────────────────────────────────────────────

describe('evaluateQueryOnSource — NOT operator', () => {
  it('returns selections NOT matching the child code', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1'),
      mkSel('s2', 10, 15, 'c2'),
    ];
    const node: QueryNode = {
      type: 'operator',
      operator: 'NOT',
      children: [{ type: 'code', codeGuid: 'c1', includeSubcodes: false }],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s2']);
  });

  it('returns empty when NOT has zero children', () => {
    const sels = [mkSel('s1', 0, 5, 'c1')];
    const node: QueryNode = { type: 'operator', operator: 'NOT', children: [] };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels);
    expect(result.matchingSelections).toEqual([]);
  });
});

// ── source codes (file-level codes / phantom selections) ───────────────────

function mkSourceCode(codeGuid: string, codebookGuid = 'cb1', creatingUser?: string): AppliedCode {
  return { code: { codeGuid, codebookGuid }, creatingUser };
}

describe('evaluateQueryOnSource — source codes', () => {
  it('sets fileMatch when a source code matches a code query (with text selections)', () => {
    const sels = [mkSel('s1', 0, 5, 'c_text')];
    const scs = [mkSourceCode('c_src')];
    const node: QueryNode = { type: 'code', codeGuid: 'c_src', includeSubcodes: false };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels, scs);
    expect(result.fileMatch).toBe(true);
    expect(result.fileMatchCodes).toEqual(scs);
    // Only the phantom matched — no real text selections should be returned
    expect(result.matchingSelections).toEqual([]);
  });

  it('returns text selections AND sets fileMatch for OR(sourceCode, textCode)', () => {
    const sels = [mkSel('s1', 0, 5, 'c_text')];
    const scs = [mkSourceCode('c_src')];
    const node: QueryNode = {
      type: 'operator',
      operator: 'OR',
      children: [
        { type: 'code', codeGuid: 'c_src', includeSubcodes: false },
        { type: 'code', codeGuid: 'c_text', includeSubcodes: false },
      ],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels, scs);
    expect(result.fileMatch).toBe(true);
    expect(result.matchingSelections.map(s => s.guid)).toContain('s1');
  });

  it('AND(sourceCode, textCode) matches when text code is present alongside source code', () => {
    const sels = [mkSel('s1', 0, 5, 'c_text')];
    const scs = [mkSourceCode('c_src')];
    const node: QueryNode = {
      type: 'operator',
      operator: 'AND',
      children: [
        { type: 'code', codeGuid: 'c_src', includeSubcodes: false },
        { type: 'code', codeGuid: 'c_text', includeSubcodes: false },
      ],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels, scs);
    expect(result.fileMatch).toBe(true);
    expect(result.matchingSelections.map(s => s.guid)).toContain('s1');
  });

  it('AND(sourceCode, textCode) does not match when text code is absent', () => {
    const sels = [mkSel('s1', 0, 5, 'c_other')];
    const scs = [mkSourceCode('c_src')];
    const node: QueryNode = {
      type: 'operator',
      operator: 'AND',
      children: [
        { type: 'code', codeGuid: 'c_src', includeSubcodes: false },
        { type: 'code', codeGuid: 'c_text', includeSubcodes: false },
      ],
    };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels, scs);
    expect(result.fileMatch).toBe(false);
    expect(result.matchingSelections).toEqual([]);
  });

  it('returns fileMatch with no text selections when only source codes exist', () => {
    const scs = [mkSourceCode('c_src')];
    const node: QueryNode = { type: 'code', codeGuid: 'c_src', includeSubcodes: false };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, [], scs);
    expect(result.fileMatch).toBe(true);
    expect(result.fileMatchCodes).toEqual(scs);
    expect(result.matchingSelections).toEqual([]);
  });

  it('does not set fileMatch when source code does not match the query', () => {
    const sels = [mkSel('s1', 0, 5, 'c_text')];
    const scs = [mkSourceCode('c_other')];
    const node: QueryNode = { type: 'code', codeGuid: 'c_text', includeSubcodes: false };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels, scs);
    expect(result.fileMatch).toBe(false);
    expect(result.fileMatchCodes).toEqual([]);
    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1']);
  });

  it('returns only matching source codes in fileMatchCodes', () => {
    const sels = [mkSel('s1', 0, 5, 'c_text')];
    const matching = mkSourceCode('c_src');
    const nonMatching = mkSourceCode('c_other');
    const scs = [matching, nonMatching];
    const node: QueryNode = { type: 'code', codeGuid: 'c_src', includeSubcodes: false };
    const result = evaluateQueryOnSource(node, [], emptySubcodes, emptyCodebooks, sels, scs);
    expect(result.fileMatch).toBe(true);
    expect(result.fileMatchCodes).toEqual([matching]);
  });

  it('respects user filter on source codes', () => {
    const sels = [mkSel('s1', 0, 5, 'c_text', 'cb1', 'alice')];
    const scs = [mkSourceCode('c_src', 'cb1', 'bob')];
    const node: QueryNode = { type: 'code', codeGuid: 'c_src', includeSubcodes: false };
    // Only allow alice — bob's source code should be filtered out
    const result = evaluateQueryOnSource(node, ['alice'], emptySubcodes, emptyCodebooks, sels, scs);
    expect(result.fileMatch).toBe(false);
    expect(result.matchingSelections).toEqual([]);
  });
});

// ── clause styles on top of base query ────────────────────────────────────

describe('evaluateQueryWithClausesOnSource', () => {
  it('keeps unmatched base selections with solid style', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1', 'alice'),
      mkSel('s2', 10, 15, 'c1', 'cb1', 'bob'),
      mkSel('s3', 20, 25, 'c2', 'cb1', 'alice'),
    ];
    const baseNode: QueryNode = { type: 'code', codeGuid: 'c1', includeSubcodes: false };

    const result = evaluateQueryWithClausesOnSource(
      baseNode,
      [],
      [
        {
          guid: 'clause-a',
          query: null,
          userFilter: ['alice'],
          style: 'dashed',
        },
      ],
      emptySubcodes,
      emptyCodebooks,
      sels,
    );

    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1', 's2']);
    expect(result.selectionStyles.s1).toBe('dashed');
    expect(result.selectionStyles.s2).toBe('solid');
  });

  it('applies clause style overrides in order while retaining base matches', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1', 'alice'),
      mkSel('s2', 10, 15, 'c1', 'cb1', 'bob'),
    ];
    const baseNode: QueryNode = { type: 'code', codeGuid: 'c1', includeSubcodes: false };

    const result = evaluateQueryWithClausesOnSource(
      baseNode,
      [],
      [
        {
          guid: 'all',
          query: null,
          userFilter: [],
          style: 'dotted',
        },
        {
          guid: 'bob-only',
          query: null,
          userFilter: ['bob'],
          style: 'double',
        },
      ],
      emptySubcodes,
      emptyCodebooks,
      sels,
    );

    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1', 's2']);
    expect(result.selectionStyles.s1).toBe('dotted');
    expect(result.selectionStyles.s2).toBe('double');
  });

  it('intersects base userFilter with clause userFilter', () => {
    const sels = [
      mkSel('s1', 0, 5, 'c1', 'cb1', 'alice'),
      mkSel('s2', 10, 15, 'c1', 'cb1', 'bob'),
      mkSel('s3', 20, 25, 'c1', 'cb1', 'carol'),
    ];
    const baseNode: QueryNode = { type: 'code', codeGuid: 'c1', includeSubcodes: false };

    const result = evaluateQueryWithClausesOnSource(
      baseNode,
      ['alice', 'bob'],
      [
        {
          guid: 'bob-clause',
          query: null,
          userFilter: ['bob', 'carol'],
          style: 'double',
        },
      ],
      emptySubcodes,
      emptyCodebooks,
      sels,
    );

    expect(result.matchingSelections.map(s => s.guid)).toEqual(['s1', 's2']);
    expect(result.selectionStyles.s1).toBe('solid');
    expect(result.selectionStyles.s2).toBe('double');
    expect(result.selectionStyles.s3).toBeUndefined();
  });
});

// ── updateQueryNodeAtPath ──────────────────────────────────────────────────

describe('updateQueryNodeAtPath', () => {
  const leaf1: QueryNode = { type: 'code', codeGuid: 'c1', includeSubcodes: true };
  const leaf2: QueryNode = { type: 'code', codeGuid: 'c2', includeSubcodes: true };
  const leaf3: QueryNode = { type: 'code', codeGuid: 'c3', includeSubcodes: true };
  const nested: QueryNode = {
    type: 'operator', operator: 'AND', children: [
      { type: 'operator', operator: 'OR', children: [leaf1, leaf2] },
      leaf3,
    ],
  };

  it('replaces the root node when path is empty', () => {
    const result = updateQueryNodeAtPath(nested, [], leaf1);
    expect(result).toEqual(leaf1);
  });

  it('returns null when removing the root node', () => {
    const result = updateQueryNodeAtPath(nested, [], null);
    expect(result).toBeNull();
  });

  it('replaces a direct child', () => {
    const replacement: QueryNode = { type: 'code', codeGuid: 'c4', includeSubcodes: false };
    const result = updateQueryNodeAtPath(nested, [1], replacement);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('operator');
    if (result!.type === 'operator') {
      expect(result!.children[1]).toEqual(replacement);
      expect(result!.children[0]).toEqual(nested.type === 'operator' ? nested.children[0] : null);
    }
  });

  it('removes a direct child when replacement is null', () => {
    const result = updateQueryNodeAtPath(nested, [0], null);
    expect(result).not.toBeNull();
    if (result!.type === 'operator') {
      expect(result!.children).toHaveLength(1);
      expect(result!.children[0]).toEqual(leaf3);
    }
  });

  it('replaces a deeply nested child', () => {
    const replacement: QueryNode = { type: 'code', codeGuid: 'c5', includeSubcodes: false };
    const result = updateQueryNodeAtPath(nested, [0, 1], replacement);
    expect(result).not.toBeNull();
    if (result!.type === 'operator' && result!.children[0].type === 'operator') {
      expect(result!.children[0].children[1]).toEqual(replacement);
      expect(result!.children[0].children[0]).toEqual(leaf1);
    }
  });

  it('removes a deeply nested child', () => {
    const result = updateQueryNodeAtPath(nested, [0, 0], null);
    expect(result).not.toBeNull();
    if (result!.type === 'operator' && result!.children[0].type === 'operator') {
      expect(result!.children[0].children).toHaveLength(1);
      expect(result!.children[0].children[0]).toEqual(leaf2);
    }
  });

  it('returns root unchanged for out-of-bounds index', () => {
    const result = updateQueryNodeAtPath(nested, [5], leaf1);
    expect(result).toEqual(nested);
  });

  it('returns root unchanged when descending into a leaf node', () => {
    const result = updateQueryNodeAtPath(leaf1, [0], leaf2);
    expect(result).toEqual(leaf1);
  });
});
