import { buildSegments } from '../helpers';
import type { AppliedCode, QueryNode, TextSelection } from '../models/files';

export interface QueryResult {
  matchingSelections: TextSelection[];
  fileMatch: boolean;
  fileMatchCodes: AppliedCode[];
}

/**
 * Evaluate a query node against a single atomic segment (a region of text
 * covered by a known set of selections). Returns the set of selection GUIDs
 * that contribute to the match. An empty set means no match.
 *
 * - code / codebook leaf: return GUIDs of covering selections whose code matches.
 * - OR:  union of all children's results (any child matching is sufficient).
 * - AND: if every child matches (non-empty), return the union; otherwise empty.
 * - NOT: if the child does NOT match (empty), return all covering selection GUIDs
 *        (the segment "survived" the negation); if it does match, return empty.
 */
function evaluateQueryOnSegment(
  node: QueryNode,
  subcodeIndex: Record<string, Set<string>>,
  codebookIndex: Record<string, Set<string>>,
  coveringSelections: TextSelection[],
): Set<string> {
  if (node.type === 'code') {
    const result = new Set<string>();
    if (node.includeSubcodes === false) {
      for (const sel of coveringSelections) {
        if (sel.code.codeGuid === node.codeGuid) result.add(sel.guid);
      }
    } else {
      const subcodeGuids = subcodeIndex[node.codeGuid];
      if (subcodeGuids) {
        for (const sel of coveringSelections) {
          if (subcodeGuids.has(sel.code.codeGuid)) result.add(sel.guid);
        }
      }
    }
    return result;
  }

  if (node.type === 'codebook') {
    const result = new Set<string>();
    const codeGuids = codebookIndex[node.codebookGuid];
    if (codeGuids) {
      for (const sel of coveringSelections) {
        if (codeGuids.has(sel.code.codeGuid)) result.add(sel.guid);
      }
    }
    return result;
  }

  // Operator node
  switch (node.operator) {
    case 'AND': {
      if (node.children.length === 0) return new Set();
      const childResults = node.children.map(child =>
        evaluateQueryOnSegment(child, subcodeIndex, codebookIndex, coveringSelections)
      );
      // Every child must match (non-empty)
      if (childResults.some(r => r.size === 0)) return new Set();
      // Union all contributing GUIDs
      const union = new Set<string>();
      for (const r of childResults) for (const guid of r) union.add(guid);
      return union;
    }
    case 'OR': {
      const union = new Set<string>();
      for (const child of node.children) {
        for (const guid of evaluateQueryOnSegment(child, subcodeIndex, codebookIndex, coveringSelections)) {
          union.add(guid);
        }
      }
      return union;
    }
    case 'NOT': {
      if (node.children.length === 0) return new Set();
      const childResult = evaluateQueryOnSegment(node.children[0], subcodeIndex, codebookIndex, coveringSelections);
      if (childResult.size > 0) {
        // Child matched → negation fails
        return new Set();
      }
      // Child didn't match → all covering selections survive the negation
      return new Set(coveringSelections.map(s => s.guid));
    }
    default:
      return new Set();
  }
}

/**
 * Evaluate a query against a source's selections using segment-based logic.
 *
 * Instead of testing each selection independently (which breaks AND — a single
 * selection only has one code), this decomposes the selections into atomic
 * segments where each segment knows all covering selections. The query tree
 * is then evaluated per-segment, and the union of contributing selections
 * across all segments is returned.
 *
 * Source codes (file-level codes) are injected as phantom selections that span
 * the full range of all text selections. If a phantom contributes to the match,
 * the result's `fileMatch` flag is set to true. The phantom selections
 * themselves are stripped from the returned selections.
 */
export function evaluateQueryOnSource(
  node: QueryNode | null,
  userFilter: (string | undefined)[],
  subcodeIndex: Record<string, Set<string>>,
  codebookIndex: Record<string, Set<string>>,
  selections: TextSelection[],
  sourceCodes?: AppliedCode[],
): QueryResult {
  // Pre-filter by user
  let filtered = selections;
  if (userFilter.length > 0) {
    filtered = selections.filter(s => userFilter.includes(s.creatingUser));
  }

  // No query node → include all filtered selections, fileMatch if any sourceCodes exist
  if (!node) return { matchingSelections: filtered, fileMatch: false, fileMatchCodes: [] };

  // Filter source codes by user and build phantom selections
  const phantomPrefix = '__phantom__';
  const filteredSourceCodes = (sourceCodes ?? []).filter(
    sc => userFilter.length === 0 || userFilter.includes(sc.creatingUser),
  );
  let allSelections = filtered;
  if (filteredSourceCodes.length > 0 && filtered.length > 0) {
    const minStart = filtered.reduce((min, s) => Math.min(min, s.start), Infinity);
    const maxEnd = filtered.reduce((max, s) => Math.max(max, s.end), 0);
    const phantoms: TextSelection[] = filteredSourceCodes.map((sc, i) => ({
      guid: `${phantomPrefix}${i}`,
      start: minStart,
      end: maxEnd,
      code: sc.code,
      creatingUser: sc.creatingUser,
      note: sc.note,
    }));
    allSelections = [...filtered, ...phantoms];
  }

  // Build atomic segments from the combined selections (no content needed)
  const segments = buildSegments(allSelections);

  // Evaluate each segment, collecting the union of contributing selection GUIDs
  const contributingGuids = new Set<string>();
  for (const segment of segments) {
    if (segment.selections.length === 0) continue;
    const guids = evaluateQueryOnSegment(node, subcodeIndex, codebookIndex, segment.selections);
    for (const guid of guids) contributingGuids.add(guid);
  }

  // Collect contributing phantom indices
  const matchingPhantomIndices = new Set<number>();
  for (const guid of contributingGuids) {
    if (guid.startsWith(phantomPrefix)) {
      matchingPhantomIndices.add(Number(guid.slice(phantomPrefix.length)));
    }
  }

  // Also handle source-code-only queries when there are no text selections:
  // create a single zero-width segment with just the phantoms
  if (filtered.length === 0 && filteredSourceCodes.length > 0 && matchingPhantomIndices.size === 0) {
    const phantoms: TextSelection[] = filteredSourceCodes.map((sc, i) => ({
      guid: `${phantomPrefix}${i}`,
      start: 0,
      end: 0,
      code: sc.code,
      creatingUser: sc.creatingUser,
      note: sc.note,
    }));
    const guids = evaluateQueryOnSegment(node, subcodeIndex, codebookIndex, phantoms);
    for (const guid of guids) {
      if (guid.startsWith(phantomPrefix)) {
        matchingPhantomIndices.add(Number(guid.slice(phantomPrefix.length)));
      }
    }
  }

  const fileMatch = matchingPhantomIndices.size > 0;
  const fileMatchCodes = Array.from(matchingPhantomIndices).map(i => filteredSourceCodes[i]);

  // Return the filtered selections whose GUIDs ended up in the contributing set
  // (phantom GUIDs are naturally excluded since they are not in `filtered`)
  const matchingSelections = filtered.filter(s => contributingGuids.has(s.guid));
  return { matchingSelections, fileMatch, fileMatchCodes };
}

export function parseFilterList(filter: string | undefined): string[] {
  if (!filter) return [];
  return filter
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withDoubleStar = escaped.replace(/\*\*/g, '___DOUBLE_STAR___');
  const withSingleStar = withDoubleStar.replace(/\*/g, '[^/]*');
  const withQuestion = withSingleStar.replace(/\?/g, '.');
  const finalPattern = withQuestion.replace(/___DOUBLE_STAR___/g, '.*');
  return new RegExp(`^${finalPattern}$`, 'i');
}

export function compileGlobs(patterns: string[]): RegExp[] {
  return patterns.map(p => globToRegExp(p));
}

export function matchesAnyGlob(path: string, compiled: RegExp[]): boolean {
  if (compiled.length === 0) return true;
  return compiled.some(re => re.test(path));
}

/**
 * Navigate to a node in a query tree by index path and replace or remove it.
 * - path [] targets the root node itself.
 * - path [i] targets child i of the root operator node.
 * - path [i, j] targets child j of child i, etc.
 * - If replacement is null the child is removed from its parent's children.
 *   Removing the root (path []) returns null.
 */
export function updateQueryNodeAtPath(
  root: QueryNode,
  path: number[],
  replacement: QueryNode | null,
): QueryNode | null {
  if (path.length === 0) return replacement;

  if (root.type !== 'operator') return root; // can't descend into non-operator

  const [head, ...rest] = path;
  if (head < 0 || head >= root.children.length) return root;

  if (rest.length === 0) {
    // Direct child — replace or remove
    if (replacement === null) {
      return { ...root, children: root.children.filter((_, i) => i !== head) };
    }
    const newChildren = [...root.children];
    newChildren[head] = replacement;
    return { ...root, children: newChildren };
  }

  // Recurse into the child at head
  const updatedChild = updateQueryNodeAtPath(root.children[head], rest, replacement);
  if (updatedChild === null) {
    // Child was removed — remove from this level
    return { ...root, children: root.children.filter((_, i) => i !== head) };
  }
  const newChildren = [...root.children];
  newChildren[head] = updatedChild;
  return { ...root, children: newChildren };
}
