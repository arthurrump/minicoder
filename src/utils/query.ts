import { buildSegments } from '../helpers';
import type { QueryNode, TextSelection } from '../models/files';

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
 */
export function evaluateQueryOnSource(
  node: QueryNode | null,
  userFilter: (string | undefined)[],
  subcodeIndex: Record<string, Set<string>>,
  codebookIndex: Record<string, Set<string>>,
  selections: TextSelection[],
): TextSelection[] {
  // Pre-filter by user
  let filtered = selections;
  if (userFilter.length > 0) {
    filtered = selections.filter(s => userFilter.includes(s.creatingUser));
  }

  // No query node → include all filtered selections
  if (!node) return filtered;

  // Build atomic segments from the filtered selections (no content needed)
  const segments = buildSegments(filtered);

  // Evaluate each segment, collecting the union of contributing selection GUIDs
  const contributingGuids = new Set<string>();
  for (const segment of segments) {
    if (segment.selections.length === 0) continue;
    const guids = evaluateQueryOnSegment(node, subcodeIndex, codebookIndex, segment.selections);
    for (const guid of guids) contributingGuids.add(guid);
  }

  // Return the filtered selections whose GUIDs ended up in the contributing set
  return filtered.filter(s => contributingGuids.has(s.guid));
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
