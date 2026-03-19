import type { FileContent } from '../store';
import type { Source, TextSelection } from '../models/files';

// A match group represents a contiguous region of text that matches the query
export interface MatchGroup {
  sourcePath: string;
  start: number;
  end: number;
  content: string;
  selections: TextSelection[]; // All selections that overlap with this region (with adjusted offsets)
  matchingGuids?: Set<string>; // GUIDs of selections that directly match the query (vs overlapping context)
}

/** A sub-region of a MatchGroup shown in the collapsed view. */
export interface CollapsedRegion {
  /** Text content for this sub-region */
  content: string;
  /** Selections with offsets relative to this sub-region's content */
  selections: TextSelection[];
  /** Offset of this sub-region within the parent MatchGroup's content */
  offsetInGroup: number;
  /** GUIDs of selections that were clipped to fit this sub-region */
  clippedGuids: Set<string>;
}

export interface BuildMatchGroupsResult {
  matchCount: number;
  groups: MatchGroup[];
}

/**
 * Given selections sorted by start, find all that overlap the interval [start, end).
 * Uses binary search on `start` to find the upper bound, then scans checking end.
 */
export function findOverlapping(
  sorted: TextSelection[],
  start: number,
  end: number,
): TextSelection[] {
  // Binary search: find first selection whose start >= end
  // (all selections from this point onward can't overlap)
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].start < end) lo = mid + 1;
    else hi = mid;
  }
  const upperBound = lo;
  const result: TextSelection[] = [];
  for (let i = 0; i < upperBound; i++) {
    if (sorted[i].end > start) result.push(sorted[i]);
  }
  return result;
}

/**
 * Compute a global layer index for each selection using greedy interval coloring.
 * Each selection gets the lowest layer index that doesn't conflict with overlapping selections.
 * This minimizes the total number of layers needed.
 */
export function computeSelectionLayers(selections: TextSelection[]): { layers: Map<string, number>; maxLayer: number } {
    if (selections.length === 0) {
        return { layers: new Map(), maxLayer: 0 };
    }
    
    // Selections are kept sorted by start position in the store
    const sorted = selections;
    
    const layers = new Map<string, number>();
    // Track which selections are assigned to each layer (for overlap checking)
    const layerAssignments: TextSelection[][] = [];
    
    for (const sel of sorted) {
        // Find the lowest layer where this selection doesn't overlap with existing assignments
        let assignedLayer = 0;
        
        while (true) {
            // Ensure layer array exists
            if (!layerAssignments[assignedLayer]) {
                layerAssignments[assignedLayer] = [];
            }
            
            // Check if this selection overlaps with any selection already in this layer
            const hasConflict = layerAssignments[assignedLayer].some(
                existing => sel.start < existing.end && sel.end > existing.start
            );
            
            if (!hasConflict) {
                // Found a free layer
                break;
            }
            
            // Try next layer
            assignedLayer++;
        }
        
        layers.set(sel.guid, assignedLayer);
        layerAssignments[assignedLayer].push(sel);
    }
    
    return { 
        layers, 
        maxLayer: layerAssignments.length 
    };
}

/**
 * Compute the collapsed sub-regions for a MatchGroup.
 * Each sub-region covers one or more matching selections extended to line boundaries,
 * with gaps between non-adjacent matches omitted (shown as ellipsis separators).
 * If no matchingGuids are set, returns a single region covering the whole group.
 */
export function computeCollapsedRegions(group: MatchGroup): CollapsedRegion[] {
  const matchingGuids = group.matchingGuids;
  if (!matchingGuids || matchingGuids.size === 0) {
    // No matching info — treat entire group as one region
    return [{ content: group.content, selections: group.selections, offsetInGroup: 0, clippedGuids: new Set() }];
  }

  // Find the matching selections (offsets are relative to group content)
  const matchingSels = group.selections.filter(s => matchingGuids.has(s.guid));
  if (matchingSels.length === 0) {
    return [{ content: group.content, selections: group.selections, offsetInGroup: 0, clippedGuids: new Set() }];
  }

  // Merge matching selections into contiguous ranges
  const sorted = [...matchingSels].sort((a, b) => a.start - b.start);
  const ranges: { start: number; end: number }[] = [];
  for (const sel of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && sel.start <= last.end) {
      last.end = Math.max(last.end, sel.end);
    } else {
      ranges.push({ start: sel.start, end: sel.end });
    }
  }

  // Extend each range to line boundaries within group.content
  const content = group.content;
  for (const range of ranges) {
    // Extend start to the character after the previous newline (or 0)
    let lineStart = range.start;
    while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
    range.start = lineStart;

    // Extend end to the next newline (or content length)
    let lineEnd = range.end;
    while (lineEnd < content.length && content[lineEnd] !== '\n') lineEnd++;
    range.end = lineEnd;
  }

  // Merge ranges that became adjacent or overlapping after line extension
  const merged: { start: number; end: number }[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    if (ranges[i].start <= prev.end) {
      prev.end = Math.max(prev.end, ranges[i].end);
    } else {
      merged.push(ranges[i]);
    }
  }

  // Build CollapsedRegion for each merged range
  return merged.map(range => {
    const subContent = content.slice(range.start, range.end);
    // Collect all selections (matching and non-matching) overlapping this sub-range
    const clippedGuids = new Set<string>();
    const subSelections = group.selections
      .filter(s => s.end > range.start && s.start < range.end)
      .map(s => {
        const clampedStart = Math.max(0, s.start - range.start);
        const clampedEnd = Math.min(subContent.length, s.end - range.start);
        // Track if this selection was clipped (its range extends beyond the sub-region)
        if (s.start < range.start || s.end > range.end) {
          clippedGuids.add(s.guid);
        }
        return { ...s, start: clampedStart, end: clampedEnd };
      });
    return { content: subContent, selections: subSelections, offsetInGroup: range.start, clippedGuids };
  });
}

/**
 * Build match groups for selections that match the given code GUIDs.
 * Performs transitive expansion: overlapping non-matching selections widen
 * the group range so the expanded view shows full context.
 * When showOnlyMatching is true, skips transitive expansion and only includes
 * the directly matching selections.
 * Returns grouped selections with content slices, matchingGuids, and total match count.
 */
export function buildMatchGroups(
  codeGuids: Set<string>,
  sources: Record<string, Source>,
  fileContents: Record<string, FileContent>,
  showOnlyMatching?: boolean,
): BuildMatchGroupsResult {
  const groups: MatchGroup[] = [];
  let matchCount = 0;

  for (const [sourcePath, source] of Object.entries(sources)) {
    const fc = fileContents[sourcePath];
    const content = fc?.type === 'plain-text' ? fc.content : '';
    if (!content) continue;

    // Selections are kept sorted by start position in the store
    const allSorted = source.selections;

    // Find all selections matching any of the target code GUIDs
    const matchingSelections = allSorted.filter(s => codeGuids.has(s.code.codeGuid));
    if (matchingSelections.length === 0) continue;

    matchCount += matchingSelections.length;

    // Collect matching GUIDs
    const matchingGuidSet = new Set(matchingSelections.map(s => s.guid));

    // Group overlapping matched selections into contiguous ranges (already sorted)
    let ranges: { start: number; end: number }[] = [];
    for (const sel of matchingSelections) {
      const last = ranges[ranges.length - 1];
      if (last && sel.start <= last.end) {
        last.end = Math.max(last.end, sel.end);
      } else {
        ranges.push({ start: sel.start, end: sel.end });
      }
    }

    const allSelections = [...matchingSelections];

    if (!showOnlyMatching) {
      // Transitively expand ranges with overlapping non-matching selections
      const seen = new Set(matchingGuidSet);
      let changed = true;
      while (changed) {
        changed = false;
        const newRanges: { start: number; end: number }[] = [];
        for (const range of ranges) {
          const overlapping = findOverlapping(allSorted, range.start, range.end);
          let rStart = range.start, rEnd = range.end;
          for (const s of overlapping) {
            if (!seen.has(s.guid)) {
              seen.add(s.guid);
              allSelections.push(s);
              changed = true;
            }
            rStart = Math.min(rStart, s.start);
            rEnd = Math.max(rEnd, s.end);
          }
          const prev = newRanges[newRanges.length - 1];
          if (prev && rStart <= prev.end) {
            prev.end = Math.max(prev.end, rEnd);
          } else {
            newRanges.push({ start: rStart, end: rEnd });
          }
        }
        ranges = newRanges;
      }
    }

    allSelections.sort((a, b) => a.start - b.start || b.end - a.end);

    // Build MatchGroups from the final expanded ranges
    for (const range of ranges) {
      const groupSelections = findOverlapping(allSelections, range.start, range.end);
      groups.push({
        sourcePath,
        start: range.start,
        end: range.end,
        content: content.slice(range.start, range.end),
        selections: groupSelections.map(s => ({
          ...s,
          start: s.start - range.start,
          end: s.end - range.start,
        })),
        matchingGuids: matchingGuidSet,
      });
    }
  }

  // Sort by filepath, then by start index
  groups.sort((a, b) => {
    const pathCompare = a.sourcePath.localeCompare(b.sourcePath);
    if (pathCompare !== 0) return pathCompare;
    return a.start - b.start;
  });

  return { matchCount, groups };
}
