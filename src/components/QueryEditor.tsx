import { createSignal, createMemo, For, Show, onMount, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import styles from './QueryEditor.module.css';
import ColorChip from './ColorChip';
import TextView from './TextView';

// Helper to find a code by guid across all codebooks
function findCodeByGuid(codebooks: Codebook[], guid: string): { code: Code; codebook: Codebook } | null {
  for (const codebook of codebooks) {
    const found = findCodeInTree(codebook.codes, guid);
    if (found) {
      return { code: found, codebook };
    }
  }
  return null;
}

function findCodeInTree(codes: Code[], guid: string): Code | null {
  for (const code of codes) {
    if (code.guid === guid) return code;
    if (code.subcodes) {
      const found = findCodeInTree(code.subcodes, guid);
      if (found) return found;
    }
  }
  return null;
}

function collectCodeAndSubcodes(root: Code | null): string[] {
  if (!root) return [];
  const guids: string[] = [root.guid];
  if (root.subcodes) {
    for (const sub of root.subcodes) {
      guids.push(...collectCodeAndSubcodes(sub));
    }
  }
  return guids;
}

// Flatten all codes from all codebooks for the picker
function flattenCodes(codebooks: Codebook[]): { code: Code; codebook: Codebook; path: string[] }[] {
  const results: { code: Code; codebook: Codebook; path: string[] }[] = [];
  
  function traverse(codes: Code[], codebook: Codebook, path: string[]) {
    for (const code of codes) {
      results.push({ code, codebook, path: [...path, code.name] });
      if (code.subcodes) {
        traverse(code.subcodes, codebook, [...path, code.name]);
      }
    }
  }
  
  for (const codebook of codebooks) {
    traverse(codebook.codes, codebook, [codebook.name]);
  }
  
  return results;
}

// Evaluate a query against a set of code GUIDs
export function evaluateQuery(node: QueryNode | null, selectionCodeGuids: Set<string>, codebooks: Codebook[]): boolean {
  if (!node) return false;
  
  if (node.type === 'code') {
    const includeSubcodes = node.includeSubcodes !== false;
    if (!includeSubcodes) {
      return selectionCodeGuids.has(node.codeGuid);
    }

    const info = findCodeByGuid(codebooks, node.codeGuid);
    const targetGuids = collectCodeAndSubcodes(info?.code || null);
    return targetGuids.some(guid => selectionCodeGuids.has(guid));
  }
  
  if (node.type === 'operator') {
    switch (node.operator) {
      case 'AND':
        return node.children.length > 0 && node.children.every(child => evaluateQuery(child, selectionCodeGuids, codebooks));
      case 'OR':
        return node.children.some(child => evaluateQuery(child, selectionCodeGuids, codebooks));
      case 'NOT':
        // NOT operates on the first child only
        return node.children.length > 0 ? !evaluateQuery(node.children[0], selectionCodeGuids, codebooks) : false;
      default:
        return false;
    }
  }
  
  return false;
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

function matchesAnyGlob(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some(pattern => globToRegExp(pattern).test(path));
}

// Component for initial query creation - choose between code or operator
interface QueryInitialPickerProps {
  codebooks: Codebook[];
  onSelect: (node: QueryNode) => void;
}

const QueryInitialPicker: Component<QueryInitialPickerProps> = (props) => {
  const [mode, setMode] = createSignal<'choose' | 'code'>('choose');
  const allCodes = createMemo(() => flattenCodes(props.codebooks));

  const handleCodeSelect = (codeGuid: string) => {
    props.onSelect({ type: 'code', codeGuid, includeSubcodes: true });
  };

  const handleOperatorSelect = () => {
    // Use AND as default, matching the default when adding operators inside a query
    props.onSelect({ type: 'operator', operator: 'AND', children: [] });
  };

  return (
    <div class={styles.initialPicker}>
      <Show when={mode() === 'choose'}>
        <div class={styles.pickerButtons}>
          <button class={styles.pickerBtn} onClick={() => setMode('code')}>
            <span innerHTML={octicons.code.toSVG({ width: 16 })} />
            Select a Code
          </button>
          <button class={styles.pickerBtn} onClick={() => handleOperatorSelect()}>
            <span innerHTML={octicons['git-merge'].toSVG({ width: 16 })} />
            Start with Operator
          </button>
        </div>
      </Show>
      
      <Show when={mode() === 'code'}>
        <div class={styles.codePickerInline}>
          <div class={styles.codePickerHeader}>
            <button onClick={() => setMode('choose')}>← Back</button>
            <span>Select a code:</span>
          </div>
          <div class={styles.codePickerList}>
            <For each={allCodes()}>
              {(item) => (
                <div
                  class={styles.codePickerItem}
                  onClick={() => handleCodeSelect(item.code.guid)}
                >
                  <ColorChip color={item.code.color} class={styles.codeChip} />
                  <span>{item.path.join(' › ')}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

interface QueryNodeEditorProps {
  node: QueryNode;
  onUpdate: (node: QueryNode) => void;
  onDelete: () => void;
  codebooks: Codebook[];
  depth: number;
  showDelete?: boolean;
}

const QueryNodeEditor: Component<QueryNodeEditorProps> = (props) => {
  const [showCodePicker, setShowCodePicker] = createSignal(false);
  const allCodes = createMemo(() => flattenCodes(props.codebooks));
  
  const codeInfo = createMemo(() => {
    if (props.node.type === 'code') {
      return findCodeByGuid(props.codebooks, props.node.codeGuid);
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

  const handleConvertToOperator = (operator: QueryOperator) => {
    // If this is currently a code node, wrap it in an operator
    if (props.node.type === 'code') {
      props.onUpdate({
        type: 'operator',
        operator,
        children: [{ type: 'code', codeGuid: props.node.codeGuid, includeSubcodes: props.node.includeSubcodes }],
      });
    } else {
      handleOperatorChange(operator);
    }
  };

  return (
    <div class={styles.queryNode} style={{ "margin-left": `${props.depth * 16}px` }}>
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
        
        <Show when={props.node.type === 'code'}>
          <div class={styles.codeDisplay}>
            <Show when={codeInfo()} fallback={
              <button class={styles.selectCodeBtn} onClick={() => setShowCodePicker(true)}>
                Select Code...
              </button>
            }>
              {(info) => (
                <div class={styles.selectedCode} onClick={() => setShowCodePicker(true)}>
                  <ColorChip color={info().code.color} class={styles.codeChip} />
                  <span>{info().code.name}</span>
                  <span class={styles.codebookName}>({info().codebook.name})</span>
                </div>
              )}
            </Show>
          </div>
        </Show>
        <Show when={props.node.type === 'code'}>
          <label class={styles.subcodeToggle}>
            <input
              type="checkbox"
              checked={props.node.type === 'code' ? props.node.includeSubcodes !== false : true}
              onChange={(e) =>
                props.onUpdate({
                  type: 'code',
                  codeGuid: props.node.type === 'code' ? props.node.codeGuid : '',
                  includeSubcodes: (e.target as HTMLInputElement).checked,
                })
              }
            />
            <span>Include subcodes</span>
          </label>
        </Show>
        
        <div class={styles.nodeActions}>
          <Show when={props.node.type === 'code'}>
            <button
              class={styles.convertBtn}
              onClick={() => handleConvertToOperator('AND')}
              title="Wrap in AND"
            >
              AND
            </button>
            <button
              class={styles.convertBtn}
              onClick={() => handleConvertToOperator('OR')}
              title="Wrap in OR"
            >
              OR
            </button>
            <button
              class={styles.convertBtn}
              onClick={() => handleConvertToOperator('NOT')}
              title="Wrap in NOT"
            >
              NOT
            </button>
          </Show>
          <Show when={props.showDelete || props.depth > 0}>
            <button
              class={styles.deleteBtn}
              onClick={props.onDelete}
              title="Remove"
              innerHTML={octicons.trash.toSVG({ width: 14 })}
            />
          </Show>
        </div>
      </div>
      
      {/* Code picker dropdown */}
      <Show when={showCodePicker()}>
        <div class={styles.codePicker}>
          <div class={styles.codePickerHeader}>
            <span>Select a code:</span>
            <button onClick={() => setShowCodePicker(false)}>×</button>
          </div>
          <div class={styles.codePickerList}>
            <For each={allCodes()}>
              {(item) => (
                <div
                  class={styles.codePickerItem}
                  onClick={() => handleCodeSelect(item.code.guid)}
                >
                  <ColorChip color={item.code.color} class={styles.codeChip} />
                  <span>{item.path.join(' › ')}</span>
                </div>
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
                codebooks={props.codebooks}
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

// Component to display matching selections
// A match group represents a contiguous region of text that matches the query
interface MatchGroup {
  sourcePath: string;
  start: number;
  end: number;
  content: string;
  selections: TextSelection[]; // All selections that overlap with this region (with adjusted offsets)
}

interface MatchingSelectionsListProps {
  query: Query;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionRemove?: (sourcePath: string, selectionGuid: string) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number, note?: string) => void;
  onSelectionClear?: () => void;
}

// Single match item component with expand functionality
interface MatchItemProps {
  group: MatchGroup;
  codebooks: Codebook[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEnsureExpanded: () => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionRemove?: (sourcePath: string, selectionGuid: string) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number, note?: string) => void;
  onSelectionClear?: () => void;
}

const MatchItem: Component<MatchItemProps> = (props) => {
  let contentRef: HTMLDivElement | undefined;
  const [needsExpand, setNeedsExpand] = createSignal(false);
  
  // Check if content exceeds 200px height
  const checkOverflow = () => {
    if (contentRef) {
      setNeedsExpand(contentRef.scrollHeight > 200);
    }
  };
  
  // Build code map for this group
  const codeMap = createMemo(() => {
    const map = new Map<string, { code: Code; codebook: Codebook }>();
    for (const sel of props.group.selections) {
      if (!map.has(sel.code_guid)) {
        const info = findCodeByGuid(props.codebooks, sel.code_guid);
        if (info) map.set(sel.code_guid, info);
      }
    }
    return map;
  });
  
  // Get unique codes for the header display
  const uniqueCodes = createMemo(() => {
    return Array.from(codeMap().values());
  });
  
  onMount(() => {
    checkOverflow();
  });
  
  return (
    <div class={styles.matchItem}>
      <div class={styles.matchHeader}>
        <span class={styles.matchSource}>{props.group.sourcePath}</span>
        <div class={styles.matchCodes}>
          <For each={uniqueCodes()}>
            {(info) => (
              <span class={styles.matchCodeTag}>
                <ColorChip color={info.code.color} class={styles.codeChip} />
                <span>{info.code.name}</span>
              </span>
            )}
          </For>
        </div>
      </div>
      <div 
        class={`${styles.matchContent} ${!props.isExpanded && needsExpand() ? styles.matchContentCollapsed : ''}`}
        ref={contentRef}
      >
        <TextView
          content={props.group.content}
          selections={props.group.selections}
          codebooks={props.codebooks}
          onSelectionCreate={(start, end) => {
            props.onEnsureExpanded();
            props.onSelectionCreate?.(props.group.sourcePath, props.group.start + start, props.group.start + end);
          }}
          onSelectionRemove={(selectionGuid) =>
            props.onSelectionRemove?.(props.group.sourcePath, selectionGuid)
          }
          onSelectionUpdate={(selectionGuid, start, end, note) =>
            props.onSelectionUpdate?.(props.group.sourcePath, selectionGuid, props.group.start + start, props.group.start + end, note)
          }
          onSelectionClear={props.onSelectionClear}
        />
      </div>
      <Show when={needsExpand()}>
        <button class={styles.expandBtn} onClick={props.onToggleExpand}>
          {props.isExpanded ? 'Show less' : 'Show more'}
        </button>
      </Show>
    </div>
  );
};

const MatchingSelectionsList: Component<MatchingSelectionsListProps> = (props) => {
  const { store, actions } = useStore();
  const [localExpandedKeys, setLocalExpandedKeys] = createSignal<Set<string>>(new Set());

  const getGroupKey = (group: MatchGroup) => `${group.sourcePath}::${group.start}-${group.end}`;

  const getExpandedKeys = () => props.expandedKeys ?? localExpandedKeys();
  const setExpandedKeys = (next: Set<string>) => {
    props.onExpandedKeysChange ? props.onExpandedKeysChange(next) : setLocalExpandedKeys(next);
  };

  const isExpanded = (group: MatchGroup) => getExpandedKeys().has(getGroupKey(group));

  const ensureExpanded = (group: MatchGroup) => {
    const key = getGroupKey(group);
    const current = getExpandedKeys();
    if (current.has(key)) return;
    const next = new Set(current);
    next.add(key);
    setExpandedKeys(next);
  };

  const toggleExpanded = (group: MatchGroup) => {
    const key = getGroupKey(group);
    const current = getExpandedKeys();
    const next = new Set(current);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedKeys(next);
  };
  
  // Compute match groups - groups of overlapping selections that match the query
  const matchGroups = createMemo(() => {
    const groups: MatchGroup[] = [];
    const queryNode = props.query.query;
    const filterPatterns = parseFilterList(props.query.fileFilter);
    const matchAll = !queryNode;
    
    // Iterate over all sources
    for (const [sourcePath, source] of Object.entries(store.sources)) {
      if (!matchesAnyGlob(sourcePath, filterPatterns)) continue;
      const content = store.fileContents[sourcePath] || '';
      if (!content) continue;
      
      // Find all selections that match when considering overlapping codes
      const matchingSelectionGuids = new Set<string>();
      
      for (const selection of source.selections) {
        if (matchAll) {
          matchingSelectionGuids.add(selection.guid);
          continue;
        }

        const overlappingSelections = source.selections.filter(s => 
          !(s.end <= selection.start || s.start >= selection.end)
        );
        const codeGuids = new Set(overlappingSelections.map(s => s.code_guid));
        
        if (evaluateQuery(queryNode, codeGuids, store.codebooks)) {
          matchingSelectionGuids.add(selection.guid);
        }
      }
      
      if (matchingSelectionGuids.size === 0) continue;
      
      // Group overlapping matching selections together
      const matchingSelections = source.selections.filter(s => matchingSelectionGuids.has(s.guid));
      const sortedSelections = [...matchingSelections].sort((a, b) => a.start - b.start);
      
      const mergedGroups: { start: number; end: number; selections: TextSelection[] }[] = [];
      
      for (const sel of sortedSelections) {
        // Check if this selection overlaps with the last group
        const lastGroup = mergedGroups[mergedGroups.length - 1];
        if (lastGroup && sel.start <= lastGroup.end) {
          // Merge into existing group
          lastGroup.end = Math.max(lastGroup.end, sel.end);
          lastGroup.selections.push(sel);
        } else {
          // Start new group
          mergedGroups.push({ start: sel.start, end: sel.end, selections: [sel] });
        }
      }
      
      // Convert to MatchGroup with content and adjusted offsets
      for (const group of mergedGroups) {
        const groupSelections = source.selections.filter(s =>
          !(s.end <= group.start || s.start >= group.end)
        );
        groups.push({
          sourcePath,
          start: group.start,
          end: group.end,
          content: content.slice(group.start, group.end),
          selections: groupSelections.map(s => ({
            ...s,
            // Adjust offsets to be relative to the group content
            start: s.start - group.start,
            end: s.end - group.start,
          })),
        });
      }
    }
    
    // Sort by filepath, then by start index
    groups.sort((a, b) => {
      const pathCompare = a.sourcePath.localeCompare(b.sourcePath);
      if (pathCompare !== 0) return pathCompare;
      return a.start - b.start;
    });
    
    return groups;
  });

  // Ensure file content is loaded for sources
  createMemo(() => {
    for (const sourcePath of Object.keys(store.sources)) {
      if (!store.fileContents[sourcePath]) {
        actions.loadFileContent(sourcePath);
      }
    }
  });

  return (
    <div class={styles.matchingSelections}>
      <div class={styles.matchingHeader}>
        <h3>Matching Selections ({matchGroups().length})</h3>
        <div class={styles.matchingHeaderActions}>
          <button
            class={styles.expandBtnSmall}
            onClick={() => {
              const next = new Set(getExpandedKeys());
              for (const group of matchGroups()) {
                next.add(getGroupKey(group));
              }
              setExpandedKeys(next);
            }}
          >
            Expand all
          </button>
          <button
            class={styles.expandBtnSmall}
            onClick={() => setExpandedKeys(new Set())}
          >
            Collapse all
          </button>
        </div>
      </div>
      <Show when={matchGroups().length > 0} fallback={
        <p class={styles.noMatches}>No matching selections found.</p>
      }>
        <div class={styles.matchingList}>
          <For each={matchGroups()}>
            {(group) => (
              <MatchItem
                group={group}
                codebooks={store.codebooks}
                isExpanded={isExpanded(group)}
                onToggleExpand={() => toggleExpanded(group)}
                onEnsureExpanded={() => ensureExpanded(group)}
                onSelectionCreate={props.onSelectionCreate}
                onSelectionRemove={props.onSelectionRemove}
                onSelectionUpdate={props.onSelectionUpdate}
                onSelectionClear={props.onSelectionClear}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

interface QueryEditorProps {
  queryPath: string;
  scrollRef?: (el: HTMLDivElement) => void;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionRemove?: (sourcePath: string, selectionGuid: string) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number, note?: string) => void;
  onSelectionClear?: () => void;
}

const QueryEditor: Component<QueryEditorProps> = (props) => {
  const { store, actions } = useStore();
  const [editingName, setEditingName] = createSignal(false);

  // Find query by matching the path (filename should be {name}.mcq)
  const query = createMemo(() => {
    const pathParts = props.queryPath.split('/');
    const filename = pathParts[pathParts.length - 1];
    const queryName = filename.replace(/\.mcq$/, '');
    
    // Case-insensitive comparison since filenames are lowercased
    return store.queries.find(q => q.name.toLowerCase() === queryName.toLowerCase()) || null;
  });

  const updateQueryName = async (newName: string) => {
    const q = query();
    if (!q || !newName.trim()) return;
    
    // Delete old file first (it has the old name)
    await actions.deleteQuery(q.guid);
    
    // Save with new name
    const updatedQuery = { ...q, name: newName.trim() };
    await actions.saveQuery(updatedQuery);
    setEditingName(false);
  };

  const updateQuery = async (queryNode: QueryNode | null) => {
    const q = query();
    if (!q) return;
    const updatedQuery = { ...q, query: queryNode };
    await actions.saveQuery(updatedQuery);
  };


  const updateQueryFilter = async (value: string) => {
    const q = query();
    if (!q) return;
    const updatedQuery = { ...q, fileFilter: value };

    if (props.queryPath.startsWith('untitled:')) {
      actions.saveUnsavedQuery(props.queryPath, updatedQuery);
    } else {
      await actions.saveQuery(updatedQuery);
    }
  };
  const clearQuery = async () => {
    await updateQuery(null);
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
                  onBlur={(e) => updateQueryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateQueryName((e.target as HTMLInputElement).value);
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

            <div class={styles.queryFilterRow}>
              <label class={styles.queryFilterLabel}>Filter files</label>
              <input
                class={styles.queryFilterInput}
                type="text"
                placeholder="e.g. interviews/**/*.txt, notes/*.md"
                value={q().fileFilter || ''}
                onInput={(e) => updateQueryFilter((e.target as HTMLInputElement).value)}
              />
            </div>
            
            <div class={styles.queryBuilder}>
              <Show when={q().query} fallback={
                <QueryInitialPicker 
                  codebooks={store.codebooks}
                  onSelect={(node) => updateQuery(node)}
                />
              }>
                <QueryNodeEditor
                  node={q().query!}
                  onUpdate={(updated) => updateQuery(updated)}
                  onDelete={() => clearQuery()}
                  codebooks={store.codebooks}
                  depth={0}
                  showDelete
                />
              </Show>
            </div>
            
            {/* Display matching selections */}
            <MatchingSelectionsList
              query={q()}
              expandedKeys={props.expandedKeys}
              onExpandedKeysChange={props.onExpandedKeysChange}
              onSelectionCreate={props.onSelectionCreate}
              onSelectionRemove={props.onSelectionRemove}
              onSelectionUpdate={props.onSelectionUpdate}
              onSelectionClear={props.onSelectionClear}
            />
          </>
        )}
      </Show>
    </div>
  );
};

export default QueryEditor;
