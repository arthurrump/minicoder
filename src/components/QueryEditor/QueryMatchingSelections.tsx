import { createMemo, type Component } from 'solid-js';
import { useStore } from '../../store';
import { findOverlapping, MatchingSelectionsList, type MatchGroup, type FileMatch } from '../MatchingSelections';
import { evaluateQueryWithClausesOnSource, parseFilterList, compileGlobs, matchesAnyGlob } from '../../utils/query';
import type { Code, Codebook, Query, QueryClause } from '../../models/files';

interface QueryMatchingSelectionsProps {
  query: Query;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

const QueryMatchingSelections: Component<QueryMatchingSelectionsProps> = (props) => {
  const { store, indices } = useStore();

  const exampleSelectionGuids = createMemo(() => {
    const guids = new Set<string>();

    function collectExamples(code: Code) {
      if (Array.isArray(code.examples)) {
        for (const example of code.examples) {
          guids.add(example.textSelectionGuid);
        }
      }
      const subcodes = Array.isArray(code.subcodes) ? code.subcodes : [];
      for (const subcode of subcodes) {
        collectExamples(subcode);
      }
    }

    for (const codebook of Object.values(store.codebooks)) {
      const codes = Array.isArray(codebook.codes) ? codebook.codes : [];
      for (const code of codes) {
        collectExamples(code);
      }
    }

    return guids;
  });

  // Compute match groups via query evaluation
  const matches = createMemo((): { matchCount: number, groups: MatchGroup[], fileMatches: FileMatch[] } => {
    const groups: MatchGroup[] = [];
    const fileMatches: FileMatch[] = [];
    let matchCount = 0;

    const query = props.query;
    const baseQueryNode = query.query;
    const baseFileFilter = compileGlobs(parseFilterList(query.fileFilter));
    const clauses = query.clauses ?? [];
    
    for (const [sourcePath, source] of Object.entries(store.sources).sort(([a], [b]) => a.localeCompare(b))) {
      // Skip files that don't match the base file filter
      if (!matchesAnyGlob(sourcePath, baseFileFilter)) continue;

      const fc = store.fileContents[sourcePath];
      const content = fc?.type === 'plain-text' ? fc.content : '';
      
      const subcodeIndex = indices.subcodesByGuid();
      const codebookIndex = indices.codesByCodebook();

      const applicableClauses: QueryClause[] = clauses.filter((clause) => {
        const clauseFileFilter = compileGlobs(parseFilterList(clause.fileFilter));
        return matchesAnyGlob(sourcePath, clauseFileFilter);
      });

      const result = evaluateQueryWithClausesOnSource(
        baseQueryNode,
        query.userFilter,
        applicableClauses,
        subcodeIndex,
        codebookIndex,
        source.selections,
        source.sourceCodes,
      );

      const selections = query.showOnlyExampleQuotes
        ? result.matchingSelections.filter(sel => exampleSelectionGuids().has(sel.guid))
        : result.matchingSelections;
      const selectionStyles = result.selectionStyles;
      matchCount += selections.length;

      if (!query.showOnlyExampleQuotes && result.fileMatch) {
        fileMatches.push({ path: sourcePath, sourceCodes: result.fileMatchCodes });
      }

      // Short-circuit if no text selections match and no file match
      if (selections.length === 0) continue;

      // Skip text-level grouping if no content (binary files)
      if (!content) continue;

      // Capture the directly-matching GUIDs before transitive expansion
      const matchingGuids = new Set(selections.map(s => s.guid));

      // Extend with all selections that transitively overlap the matches.
      // We need a closure: overlapping selections may extend the range,
      // pulling in further selections that overlap the extended range.
      if (!query.showOnlyMatching && !query.showOnlyExampleQuotes) {
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
            selectionStyles,
          });
        }
      }

      // Set the content of the final group in this block
      const lastGroup = groups[groups.length - 1];
      lastGroup.content = content.slice(lastGroup.start, lastGroup.end);
    }
    
    return { matchCount, groups, fileMatches };
  });

  return (
    <MatchingSelectionsList
      matchGroups={matches().groups}
      fileMatches={matches().fileMatches}
      title={`Matching Selections (${matches().matchCount})`}
      expandedKeys={props.expandedKeys}
      onExpandedKeysChange={props.onExpandedKeysChange}
      onOpenSource={props.onOpenSource}
      onSelectionCreate={props.onSelectionCreate}
      onSelectionClear={props.onSelectionClear}
      selectedCode={props.selectedCode}
    />
  );
};

export default QueryMatchingSelections;
