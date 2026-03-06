import { createSignal, createMemo, For, Index, Show, onMount, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import styles from './QueryEditor.module.css';
import ColorChip from './ColorChip';
import { flattenCodes, findOverlapping, MatchingSelectionsList, buildMatchGroups, type MatchGroup } from './MatchingSelections';
import { buildSegments } from '../helpers';

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

function parseFilterList(filter: string | undefined): string[] {
  if (!filter) return [];
  return filter
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withDoubleStar = escaped.replace(/\*\*/g, '___DOUBLE_STAR___');
  const withSingleStar = withDoubleStar.replace(/\*/g, '[^/]*');
  const withQuestion = withSingleStar.replace(/\?/g, '.');
  const finalPattern = withQuestion.replace(/___DOUBLE_STAR___/g, '.*');
  return new RegExp(`^${finalPattern}$`, 'i');
}

function compileGlobs(patterns: string[]): RegExp[] {
  return patterns.map(p => globToRegExp(p));
}

function matchesAnyGlob(path: string, compiled: RegExp[]): boolean {
  if (compiled.length === 0) return true;
  return compiled.some(re => re.test(path));
}

interface QueryNodeEditorProps {
  node: QueryNode;
  onUpdate: (node: QueryNode) => void;
  onDelete: () => void;
  depth: number;
}

const QueryNodeEditor: Component<QueryNodeEditorProps> = (props) => {
  const { store, indices } = useStore();
  const [showCodePicker, setShowCodePicker] = createSignal(false);
  const allCodes = createMemo(() => flattenCodes(indices.sortedCodebooks()));
  
  const isCodeLike = () => props.node.type === 'code' || props.node.type === 'codebook';

  const codeInfo = createMemo(() => {
    if (props.node.type === 'code') {
      return indices.codeByGuid()[props.node.codeGuid] ?? null;
    }
    return null;
  });

  const codebookInfo = createMemo(() => {
    if (props.node.type === 'codebook') {
      return store.codebooks[props.node.codebookGuid] ?? null;
    }
    return null;
  });

  const handleOperatorChange = (operator: QueryOperator) => {
    const children = props.node.type === 'operator' ? props.node.children : [];
    props.onUpdate({
      type: 'operator',
      operator,
      children,
    });
  };

  const handleAddChild = (type: 'code' | 'operator') => {
    if (props.node.type === 'operator') {
      const newChild: QueryNode = type === 'code' 
        ? { type: 'code', codeGuid: '', includeSubcodes: true } // Empty codeGuid will show picker
        : { type: 'operator', operator: 'AND', children: [] };
      props.onUpdate({
        type: 'operator',
        operator: props.node.operator,
        children: [...props.node.children, newChild],
      });
    }
  };

  const handleChildUpdate = (index: number, updatedChild: QueryNode) => {
    if (props.node.type === 'operator') {
      const newChildren = [...props.node.children];
      newChildren[index] = updatedChild;
      props.onUpdate({ type: 'operator', operator: props.node.operator, children: newChildren });
    }
  };

  const handleChildDelete = (index: number) => {
    if (props.node.type === 'operator') {
      const newChildren = props.node.children.filter((_, i) => i !== index);
      props.onUpdate({ type: 'operator', operator: props.node.operator, children: newChildren });
    }
  };

  const handleCodeSelect = (codeGuid: string) => {
    props.onUpdate({
      type: 'code',
      codeGuid,
      includeSubcodes: props.node.type === 'code' ? (props.node.includeSubcodes !== false) : true,
    });
    setShowCodePicker(false);
  };

  const handleCodebookSelect = (codebookGuid: string) => {
    props.onUpdate({ type: 'codebook', codebookGuid });
    setShowCodePicker(false);
  };

  const handleWrapWithOperator = (operator: QueryOperator) => {
    // If this is currently a code node, wrap it in an operator
    props.onUpdate({
      type: 'operator',
      operator,
      children: [ props.node ],
    });
  };

  return (
    <div class={styles.queryNode}>
      <div class={styles.queryNodeHeader}>
        <Show when={props.node.type === 'operator'}>
          <select
            class={styles.operatorSelect}
            value={props.node.type === 'operator' ? props.node.operator : 'AND'}
            onChange={(e) => handleOperatorChange(e.target.value as QueryOperator)}
          >
            <option value="AND">AND</option>
            <option value="OR">OR</option>
            <option value="NOT">NOT</option>
          </select>
        </Show>
        
        <Show when={isCodeLike()}>
          <div class={styles.codeDisplay}>
            <Show when={codeInfo()}>
              {(info) => (
                <div class={styles.selectedCode} onClick={() => setShowCodePicker(true)}>
                  <ColorChip color={info().code.color} class={styles.codeChip} />
                  <span>{info().code.name}</span>
                  <span class={styles.codebookName}>({info().codebook.name})</span>
                </div>
              )}
            </Show>
            <Show when={codebookInfo()}>
              {(cb) => (
                <div class={styles.selectedCode} onClick={() => setShowCodePicker(true)}>
                  <span>{cb().name}</span>
                  <span class={styles.codebookName}>(codebook)</span>
                </div>
              )}
            </Show>
            <Show when={!codeInfo() && !codebookInfo()}>
              <button class={styles.selectCodeBtn} onClick={() => setShowCodePicker(true)}>
                Select Code...
              </button>
            </Show>
          </div>
        </Show>
        <Show when={isCodeLike()}>
          <label class={styles.subcodeToggle}>
            <input
              type="checkbox"
              checked={props.node.type === 'codebook' || (props.node.type === 'code' ? props.node.includeSubcodes !== false : true)}
              disabled={props.node.type === 'codebook'}
              onChange={(e) => {
                if (props.node.type === 'code') {
                  props.onUpdate({
                    type: 'code',
                    codeGuid: props.node.codeGuid,
                    includeSubcodes: (e.target as HTMLInputElement).checked,
                  });
                }
              }}
            />
            <span>Include subcodes</span>
          </label>
        </Show>
        
        <div class={styles.nodeActions}>
          <button
            class={styles.convertBtn}
            onClick={() => handleWrapWithOperator('AND')}
            title="Wrap in AND"
          >
            AND
          </button>
          <button
            class={styles.convertBtn}
            onClick={() => handleWrapWithOperator('OR')}
            title="Wrap in OR"
          >
            OR
          </button>
          <button
            class={styles.convertBtn}
            onClick={() => handleWrapWithOperator('NOT')}
            title="Wrap in NOT"
          >
            NOT
          </button>
          <button
            class={styles.deleteBtn}
            onClick={props.onDelete}
            title="Remove"
            innerHTML={octicons.trash.toSVG({ width: 14 })}
          />
        </div>
      </div>
      
      {/* Code picker dropdown */}
      <Show when={showCodePicker()}>
        <div class={styles.codePicker}>
          <div class={styles.codePickerHeader}>
            <span>Select a code or codebook:</span>
            <button onClick={() => setShowCodePicker(false)}>×</button>
          </div>
          <div class={styles.codePickerList}>
            <For each={indices.sortedCodebooks()}>
              {(codebook) => (
                <>
                  <div
                    class={`${styles.codePickerItem} ${styles.codePickerCodebook}`}
                    onClick={() => handleCodebookSelect(codebook.guid)}
                  >
                    <span>{codebook.name}</span>
                  </div>
                  <For each={allCodes().filter(c => c.codebook.guid === codebook.guid)}>
                    {(item) => (
                      <div
                        class={styles.codePickerItem}
                        onClick={() => handleCodeSelect(item.code.guid)}
                      >
                        <ColorChip color={item.code.color} class={styles.codeChip} />
                        <span>{item.path.slice(1).join(' › ')}</span>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
          </div>
        </div>
      </Show>
      
      {/* Children for operator nodes */}
      <Show when={props.node.type === 'operator'}>
        <div class={styles.queryChildren}>
          <For each={props.node.type === 'operator' ? props.node.children : []}>
            {(child, index) => (
              <QueryNodeEditor
                node={child}
                onUpdate={(updated) => handleChildUpdate(index(), updated)}
                onDelete={() => handleChildDelete(index())}
                depth={props.depth + 1}
              />
            )}
          </For>
          <Show when={props.node.type === 'operator' && (props.node.operator !== 'NOT' || props.node.children.length < 1)}>
            <div class={styles.addChildButtons}>
              <button class={styles.addChildBtn} onClick={() => handleAddChild('code')}>
                + Add Code
              </button>
              <button class={styles.addChildBtn} onClick={() => handleAddChild('operator')}>
                + Add Operator
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

// Query-specific matching selections - computes match groups via query evaluation
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
      let selections = evaluateQueryOnSource(queryNode, query.userFilter, subcodeIndex, codebookIndex, source.selections);
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

interface QueryEditorProps {
  queryGuid: string;
  scrollRef?: (el: HTMLDivElement) => void;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

const QueryEditor: Component<QueryEditorProps> = (props) => {
  const { store, actions } = useStore();
  const [editingName, setEditingName] = createSignal(false);

  const query = createMemo(() => {
    return store.queries[props.queryGuid] || null;
  });

  const updateName = (newName: string) => {
    const q = query();
    if (!q || !newName.trim()) return;
    actions.updateQuery({ ...q, name: newName.trim() });
    setEditingName(false);
  };

  const updateQueryNode = (queryNode: QueryNode | null) => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, query: queryNode });
  };

  const updateFileFilter = (value: string) => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, fileFilter: value });
  };

  const updateUserFilter = (value: (string | undefined)[]) => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, userFilter: value });
  };

  const updateShowOnlyMatching = (value: boolean) => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, showOnlyMatching: value });
  };

  // Collect all unique user IDs from selections
  const allUsers = createMemo(() => {
    const users = new Set<string>();
    for (const source of Object.values(store.sources)) {
      for (const selection of source.selections) {
        if (selection.creatingUser) {
          users.add(selection.creatingUser);
        }
      }
    }
    return Array.from(users).sort();
  });

  const clearQuery = () => {
    updateQueryNode(null);
  };

  const deleteQuery = async () => {
    const q = query();
    if (!q) return;
    if (!confirm('Are you sure you want to delete this query? This cannot be undone.')) {
      return;
    }
    await actions.deleteQuery(q.guid);
  };

  return (
    <div class={styles.queryEditorMain} ref={props.scrollRef}>
      <Show when={query()} fallback={
        <div class={styles.queryEditorEmpty}>
          <p>Query not found.</p>
        </div>
      }>
        {(q) => (
          <>
            <div class={styles.queryEditorHeader}>
              <Show when={editingName()} fallback={
                <h2 
                  class={styles.queryTitle}
                  onClick={() => setEditingName(true)}
                  title="Click to rename"
                >
                  {q().name}
                </h2>
              }>
                <input
                  type="text"
                  class={styles.queryTitleInput}
                  value={q().name}
                  onBlur={(e) => updateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateName((e.target as HTMLInputElement).value);
                    }
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  autofocus
                />
              </Show>
              
              <div class={styles.queryHeaderActions}>
                <Show when={q().query}>
                  <button 
                    class={`${styles.btnSmall}`}
                    onClick={clearQuery}
                  >
                    Clear Query
                  </button>
                </Show>
                <button 
                  class={`${styles.btnSmall} ${styles.btnDanger}`}
                  onClick={deleteQuery}
                >
                  Delete Query
                </button>
              </div>
            </div>

            <div class={styles.queryFilterGrid}>
              <label class={styles.queryFilterLabel}>Filter files</label>
              <input
                class={styles.queryFilterInput}
                type="text"
                placeholder="e.g. interviews/**/*.txt, notes/*.md"
                value={q().fileFilter}
                onInput={(e) => updateFileFilter((e.target as HTMLInputElement).value)}
              />
              <Show when={allUsers().length > 0}>
                  <label class={styles.queryFilterLabel}>Filter users</label>
                  <div class={styles.userFilterContainer}>
                    <div class={styles.userChips}>
                      <For each={[ undefined, ...allUsers() ]}>
                        {(user) => {
                          const isSelected = () => q().userFilter.includes(user);
                          return (
                            <label
                              class={styles.userChip}
                              classList={{ [styles.userChipChecked]: isSelected() }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected()}
                                onChange={() => {
                                  if (q().userFilter.includes(user)) {
                                    // Remove user
                                    updateUserFilter(q().userFilter.filter(u => u !== user));
                                  } else {
                                    // Add user
                                    updateUserFilter([...q().userFilter, user]);
                                  }
                                }}
                              />
                              <span>{user || <code>undefined</code>}</span>
                            </label>
                          );
                        }}
                      </For>
                    </div>
                  </div>
              </Show>
              <label class={styles.queryFilterLabel}>Show only matching</label>
              <input
                class={styles.queryFilterCheckbox}
                type="checkbox"
                checked={q().showOnlyMatching || false} 
                onChange={(e) => updateShowOnlyMatching(e.target.checked)} 
              />
            </div>
            
            
            <div class={styles.queryBuilder}>
              <Show when={q().query} fallback={
                <div class={styles.addChildButtons}>
                  <button class={styles.addChildBtn} onClick={() => updateQueryNode({ type: 'code', codeGuid: '', includeSubcodes: true })}>
                    + Add Code
                  </button>
                  <button class={styles.addChildBtn} onClick={() => updateQueryNode({ type: 'operator', operator: 'AND', children: [] })}>
                    + Add Operator
                  </button>
                </div>
              }>
                <QueryNodeEditor
                  node={q().query!}
                  onUpdate={(updated) => updateQueryNode(updated)}
                  onDelete={() => clearQuery()}
                  depth={0}
                />
              </Show>
            </div>
            
            {/* Display matching selections */}
            <QueryMatchingSelections
              query={q()}
              expandedKeys={props.expandedKeys}
              onExpandedKeysChange={props.onExpandedKeysChange}
              onOpenSource={props.onOpenSource}
              onSelectionCreate={props.onSelectionCreate}
              onSelectionUpdate={props.onSelectionUpdate}
              onSelectionClear={props.onSelectionClear}
              selectedCode={props.selectedCode}
            />
          </>
        )}
      </Show>
    </div>
  );
};

export default QueryEditor;
