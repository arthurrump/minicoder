import { createMemo, type Component } from 'solid-js';
import { useStore } from '../../store';
import { findOverlapping, MatchingSelectionsList, type MatchGroup } from '../MatchingSelections';
import { evaluateQueryOnSource, parseFilterList, compileGlobs, matchesAnyGlob } from '../../utils/query';

interface QueryMatchingSelectionsProps {
  query: Query;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

const QueryMatchingSelections: Component<QueryMatchingSelectionsProps> = (props) => {
  const { store, indices } = useStore();

  // Compute match groups via query evaluation
  const matches = createMemo((): { matchCount: number, groups: MatchGroup[] } => {
    const groups: MatchGroup[] = [];
    let matchCount = 0;

    const query = props.query;
    const queryNode = query.query;
    const fileFilter = compileGlobs(parseFilterList(query.fileFilter));
    
    for (const [sourcePath, source] of Object.entries(store.sources).sort()) {
      // Skip files that don't match any of the file filters
      if (!matchesAnyGlob(sourcePath, fileFilter)) continue;

      // Skip empty files (shouldn't happen, just to be sure)
      const fc = store.fileContents[sourcePath];
      const content = fc?.type === 'plain-text' ? fc.content : '';
      if (!content) continue;
      
      // Evaluate the query on all source selections
      const subcodeIndex = indices.subcodesByGuid();
      const codebookIndex = indices.codesByCodebook();
      const selections = evaluateQueryOnSource(queryNode, query.userFilter, subcodeIndex, codebookIndex, source.selections);
      matchCount += selections.length;
      // And short-circuit if none match
      if (selections.length === 0) continue;

      // Capture the directly-matching GUIDs before transitive expansion
      const matchingGuids = new Set(selections.map(s => s.guid));

      // Extend with all selections that transitively overlap the matches.
      // We need a closure: overlapping selections may extend the range,
      // pulling in further selections that overlap the extended range.
      if (!query.showOnlyMatching) {
        const seen = new Set(selections.map(s => s.guid));
        // Merge matched selections into contiguous ranges
        let ranges: { start: number; end: number }[] = [];
        for (const s of selections) {
          const last = ranges[ranges.length - 1];
          if (last && s.start <= last.end) {
            last.end = Math.max(last.end, s.end);
          } else {
            ranges.push({ start: s.start, end: s.end });
          }
        }
        // Repeatedly expand ranges with overlapping selections until stable
        let changed = true;
        while (changed) {
          changed = false;
          const newRanges: { start: number; end: number }[] = [];
          for (const range of ranges) {
            const overlapping = findOverlapping(source.selections, range.start, range.end);
            let rStart = range.start, rEnd = range.end;
            for (const s of overlapping) {
              if (!seen.has(s.guid)) {
                seen.add(s.guid);
                selections.push(s);
                changed = true;
              }
              rStart = Math.min(rStart, s.start);
              rEnd = Math.max(rEnd, s.end);
            }
            // Merge with previous range if now overlapping
            const prev = newRanges[newRanges.length - 1];
            if (prev && rStart <= prev.end) {
              prev.end = Math.max(prev.end, rEnd);
            } else {
              newRanges.push({ start: rStart, end: rEnd });
            }
          }
          ranges = newRanges;
        }
        selections.sort((a, b) => a.start - b.start || b.end - a.end);
      }
      
      // Merge overlapping selections into groups
      for (const sel of selections) {
        const group = groups[groups.length - 1];

        // Discard duplicates which we just added in the last group
        if (group && group.selections[group.selections.length - 1].guid === sel.guid)
          continue;

        // If this selection overlaps with the last group,
        if (group && group.sourcePath === sourcePath && sel.start <= group.end) {
          // then add the selection
          group.selections.push({ ...sel, start: sel.start - group.start, end: sel.end - group.start });
          // and adjust the end position
          group.end = Math.max(group.end, sel.end);
        } else {
          // If we need to start a new group,
          // first set the content for the previous group now that we know the full range
          if (group && group.sourcePath === sourcePath) {
            group.content = content.slice(group.start, group.end);
          }

          // then create the new group, leaving the content to be set until we know the range
          groups.push({
            sourcePath,
            start: sel.start,
            end: sel.end,
            content: "",
            selections: [{ ...sel, start: 0, end: sel.end - sel.start }],
            matchingGuids,
          });
        }
      }

      // Set the content of the final group in this block
      const lastGroup = groups[groups.length - 1];
      lastGroup.content = content.slice(lastGroup.start, lastGroup.end);
    }
    
    return { matchCount, groups };
  });

  return (
    <MatchingSelectionsList
      matchGroups={matches().groups}
      title={`Matching Selections (${matches().matchCount})`}
      expandedKeys={props.expandedKeys}
      onExpandedKeysChange={props.onExpandedKeysChange}
      onOpenSource={props.onOpenSource}
      onSelectionCreate={props.onSelectionCreate}
      onSelectionUpdate={props.onSelectionUpdate}
      onSelectionClear={props.onSelectionClear}
      selectedCode={props.selectedCode}
    />
  );
};

export default QueryMatchingSelections;
