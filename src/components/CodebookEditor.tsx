import { createSignal, createMemo, Index, Show, For, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import { generateTopLevelColor, generateSubcodeColor } from '../utils/colors';
import { flattenCodesWithDepth } from '../utils/codeTree';
import styles from './CodebookEditor.module.css';
import CodeSelectionsModal from './CodeSelectionsModal';
import ColorChip from './ColorChip';

interface MergeTargetPickerProps {
  sourceCodeGuid: string;
  allCodes: { code: Code; depth: number }[];
  onSelect: (targetGuid: string) => void;
  onCancel: () => void;
}

const MergeTargetPicker: Component<MergeTargetPickerProps> = (props) => {
  const availableTargets = createMemo(() =>
    props.allCodes.filter(c => c.code.guid !== props.sourceCodeGuid)
  );

  return (
    <div class={styles.mergeOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={styles.mergePanel}>
        <div class={styles.mergePanelHeader}>
          <span>Merge into…</span>
          <button class={styles.codeActionBtn} onClick={props.onCancel}>
            ✕
          </button>
        </div>
        <div class={styles.mergePanelList}>
          <For each={availableTargets()}>
            {(item) => (
              <button
                class={styles.mergeTargetItem}
                style={{ "padding-left": `${12 + item.depth * 16}px` }}
                onClick={() => props.onSelect(item.code.guid)}
              >
                <ColorChip color={item.code.color} />
                <span>{item.code.name}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

interface CodebookMergeTargetPickerProps {
  sourceCodebookGuid: string;
  codebooks: Codebook[];
  onSelect: (targetGuid: string) => void;
  onCancel: () => void;
}

const CodebookMergeTargetPicker: Component<CodebookMergeTargetPickerProps> = (props) => {
  const availableTargets = createMemo(() =>
    props.codebooks.filter(cb => cb.guid !== props.sourceCodebookGuid)
  );

  return (
    <div class={styles.mergeOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={styles.mergePanel}>
        <div class={styles.mergePanelHeader}>
          <span>Merge codebook into…</span>
          <button class={styles.codeActionBtn} onClick={props.onCancel}>
            ✕
          </button>
        </div>
        <div class={styles.mergePanelList}>
          <For each={availableTargets()}>
            {(cb) => (
              <button
                class={styles.mergeTargetItem}
                onClick={() => props.onSelect(cb.guid)}
              >
                <span>{cb.name}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

interface MoveToCodebookPickerProps {
  sourceCodebookGuid: string;
  codebooks: Codebook[];
  onSelect: (targetCodebookGuid: string) => void;
  onCancel: () => void;
}

const MoveToCodebookPicker: Component<MoveToCodebookPickerProps> = (props) => {
  const availableTargets = createMemo(() =>
    props.codebooks.filter(cb => cb.guid !== props.sourceCodebookGuid)
  );

  return (
    <div class={styles.mergeOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={styles.mergePanel}>
        <div class={styles.mergePanelHeader}>
          <span>Move to codebook…</span>
          <button class={styles.codeActionBtn} onClick={props.onCancel}>
            ✕
          </button>
        </div>
        <div class={styles.mergePanelList}>
          <For each={availableTargets()}>
            {(cb) => (
              <button
                class={styles.mergeTargetItem}
                onClick={() => props.onSelect(cb.guid)}
              >
                <span>{cb.name}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

interface CodeEditorProps {
  code: Code;
  codebookGuid: string;
  onUpdate: (updates: Partial<Code>) => void;
  onDelete: (codeGuid: string) => void;
  onMerge: (sourceGuid: string) => void;
  onMove: (codeGuid: string) => void;
  onAddSubcode: () => void;
  onSubcodesChange: (subcodes: Code[]) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  isExpandedForCode: (guid: string) => boolean;
  onToggleExpandedForCode: (guid: string) => void;
  onViewSelections: (codeGuid: string) => void;
  getSelectionCount: (codeGuid: string) => number;
  depth: number;
}

const CodeEditor: Component<CodeEditorProps> = (props) => {
  const hasSubcodes = () => props.code.subcodes && props.code.subcodes.length > 0;
  const selectionCount = () => props.getSelectionCount(props.code.guid);

  return (
    <>
      <div class={styles.codeEditorItem}>
        <input
          type="color"
          class={styles.codeColorPicker}
          value={props.code.color}
          onChange={(e) => props.onUpdate({ color: e.target.value })}
          title="Code color"
        />
        
        <input
          type="text"
          class={styles.codeNameInput}
          value={props.code.name}
          onInput={(e) => props.onUpdate({ name: e.target.value })}
          placeholder="Code name..."
        />
        
        <div class={styles.codeActions}>
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onViewSelections(props.code.guid)}
            title="View selections"
          >
            <span class={styles.selectionCount}>{selectionCount()}</span>
            <span innerHTML={octicons['list-unordered'].toSVG()} />
          </button>
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onMerge(props.code.guid)}
            title="Merge into another code"
            innerHTML={octicons['git-merge'].toSVG()}
          />
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onMove(props.code.guid)}
            title="Move to another codebook"
            innerHTML={octicons['arrow-right'].toSVG()}
          />
          <button 
            class={`${styles.codeActionBtn} ${styles.codeDeleteBtn}`} 
            onClick={() => props.onDelete(props.code.guid)}
            title="Delete code"
            innerHTML={octicons.trash.toSVG()}
          />
        </div>
        
        <textarea
          class={styles.codeDescriptionInput}
          placeholder="Description..."
          value={props.code.description || ''}
          onInput={(e) => props.onUpdate({ description: e.target.value })}
          rows="2"
        />
        
        <div class={styles.codeSubcodesSection}>
          <button 
            class={styles.codeSubcodesToggle}
            onClick={props.onToggleExpanded}
          >
            <span class={styles.codeExpandIcon}>{props.isExpanded ? '▼' : '▶'}</span>
            <span>Subcodes ({props.code.subcodes?.length || 0})</span>
          </button>
          
          <Show when={props.isExpanded}>
            <div class={styles.codeSubcodesContent}>
              <Show when={hasSubcodes()}>
                <CodeTreeEditor
                  codes={props.code.subcodes}
                  codebookGuid={props.codebookGuid}
                  depth={props.depth + 1}
                  onCodesChange={props.onSubcodesChange}
                  onDelete={props.onDelete}
                  isExpanded={props.isExpandedForCode}
                  onToggleExpanded={props.onToggleExpandedForCode}
                  onViewSelections={props.onViewSelections}
                  onMerge={props.onMerge}
                  onMove={props.onMove}
                  getSelectionCount={props.getSelectionCount}
                />
              </Show>
              <button 
                class={`${styles.btnSmall} ${styles.addSubcodeBtn}`}
                onClick={props.onAddSubcode}
              >
                + Add Subcode
              </button>
            </div>
          </Show>
        </div>
      </div>
    </>
  );
};

interface CodeTreeEditorProps {
  codes: Code[];
  codebookGuid: string;
  onCodesChange: (codes: Code[]) => void;
  onDelete: (codeGuid: string) => void;
  depth: number;
  isExpanded: (guid: string) => boolean;
  onToggleExpanded: (guid: string) => void;
  onViewSelections: (codeGuid: string) => void;
  onMerge: (sourceGuid: string) => void;
  onMove: (codeGuid: string) => void;
  getSelectionCount: (codeGuid: string) => number;
}

const CodeTreeEditor: Component<CodeTreeEditorProps> = (props) => {
  const updateCode = (index: number, updates: Partial<Code>) => {
    const newCodes = [...props.codes];
    newCodes[index] = { ...newCodes[index], ...updates };
    props.onCodesChange(newCodes);
  };

  const deleteCode = (codeGuid: string) => {
    props.onDelete(codeGuid);
  };

  const addSubcode = (index: number) => {
    const newCodes = [...props.codes];
    const parentCode = newCodes[index];
    const siblingIndex = (parentCode.subcodes || []).length;
    const newSubcode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Subcode',
      color: generateSubcodeColor(parentCode.color, props.depth + 1, siblingIndex),
      description: '',
      subcodes: []
    };
    newCodes[index] = {
      ...parentCode,
      subcodes: [...(parentCode.subcodes || []), newSubcode]
    };
    props.onCodesChange(newCodes);
  };

  const updateSubcodes = (index: number, subcodes: Code[]) => {
    const newCodes = [...props.codes];
    newCodes[index] = { ...newCodes[index], subcodes };
    props.onCodesChange(newCodes);
  };

  return (
    <Index each={props.codes}>
      {(code, index) => (
        <CodeEditor
          code={code()}
          codebookGuid={props.codebookGuid}
          depth={props.depth}
          onUpdate={(updates) => updateCode(index, updates)}
          onDelete={(codeGuid) => deleteCode(codeGuid)}
          onMerge={props.onMerge}
          onMove={props.onMove}
          onAddSubcode={() => addSubcode(index)}
          onSubcodesChange={(subcodes) => updateSubcodes(index, subcodes)}
          isExpanded={props.isExpanded(code().guid)}
          onToggleExpanded={() => props.onToggleExpanded(code().guid)}
          isExpandedForCode={props.isExpanded}
          onToggleExpandedForCode={props.onToggleExpanded}
          onViewSelections={props.onViewSelections}
          getSelectionCount={props.getSelectionCount}
        />
      )}
    </Index>
  );
};

interface CodebookEditorProps {
  codebookGuid: string;
  scrollRef?: (el: HTMLDivElement) => void;
  expandedCodeGuids?: Set<string>;
  onExpandedCodeGuidsChange?: (next: Set<string>) => void;
}

const CodebookEditor: Component<CodebookEditorProps> = (props) => {
  const { store, actions, indices } = useStore();
  const [editingName, setEditingName] = createSignal(false);
  const [localExpandedGuids, setLocalExpandedGuids] = createSignal<Set<string>>(new Set());
  const [viewingSelectionsForCode, setViewingSelectionsForCode] = createSignal<string | null>(null);
  const [mergingCodeGuid, setMergingCodeGuid] = createSignal<string | null>(null);
  const [movingCodeGuid, setMovingCodeGuid] = createSignal<string | null>(null);
  const [mergingCodebook, setMergingCodebook] = createSignal(false);

  const getExpandedGuids = () => props.expandedCodeGuids ?? localExpandedGuids();
  const setExpandedGuids = (next: Set<string>) => {
    props.onExpandedCodeGuidsChange ? props.onExpandedCodeGuidsChange(next) : setLocalExpandedGuids(next);
  };

  const isExpanded = (guid: string) => getExpandedGuids().has(guid);
  const toggleExpanded = (guid: string) => {
    const next = new Set(getExpandedGuids());
    if (next.has(guid)) {
      next.delete(guid);
    } else {
      next.add(guid);
    }
    setExpandedGuids(next);
  };

  const codebooksList = indices.sortedCodebooks;

  const codebook = createMemo(() => {
    return store.codebooks[props.codebookGuid] || null;
  });

  const allFlatCodes = createMemo(() => {
    const cb = codebook();
    if (!cb) return [];
    return flattenCodesWithDepth(cb.codes);
  });

  const selectionCountByCode = createMemo(() => {
    const counts: Record<string, number> = {};
    for (const source of Object.values(store.sources)) {
      for (const sel of source.selections) {
        if (sel.code.codebookGuid === props.codebookGuid) {
          counts[sel.code.codeGuid] = (counts[sel.code.codeGuid] || 0) + 1;
        }
      }
    }
    return counts;
  });

  const getSelectionCount = (codeGuid: string): number => {
    return selectionCountByCode()[codeGuid] || 0;
  };

  const updateName = (newName: string) => {
    const cb = codebook();
    if (!cb || !newName.trim()) return;
    actions.updateCodebook({ ...cb, name: newName.trim() });
    setEditingName(false);
  };

  const updateCodes = (codes: Code[]) => {
    const cb = codebook();
    if (!cb) return;
    
    const updatedCodebook = { ...cb, codes };
    actions.updateCodebook(updatedCodebook);
  };

  const addTopLevelCode = () => {
    const cb = codebook();
    if (!cb) return;
    const newCode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Code',
      color: generateTopLevelColor(),
      description: '',
      subcodes: []
    };
    actions.updateCodebook({ ...cb, codes: [...cb.codes, newCode] });
  };

  const handleMerge = (sourceGuid: string) => {
    setMergingCodeGuid(sourceGuid);
  };

  const handleMove = (codeGuid: string) => {
    setMovingCodeGuid(codeGuid);
  };

  const confirmMove = (targetCodebookGuid: string) => {
    const codeGuid = movingCodeGuid();
    const cb = codebook();
    if (!codeGuid || !cb) return;
    actions.moveCode(cb.guid, codeGuid, targetCodebookGuid);
    setMovingCodeGuid(null);
  };

  const handleDeleteCode = (codeGuid: string) => {
    const cb = codebook();
    if (!cb) return;
    const findName = (codes: Code[]): string | undefined => {
      for (const c of codes) {
        if (c.guid === codeGuid) return c.name;
        const sub = findName(c.subcodes || []);
        if (sub) return sub;
      }
    };
    const name = findName(cb.codes) ?? 'this code';
    if (!confirm(`Delete "${name}" and all its subcodes? This cannot be undone.`)) return;
    actions.deleteCode(cb.guid, codeGuid);
  };

  const confirmMerge = (targetGuid: string) => {
    const sourceGuid = mergingCodeGuid();
    if (!sourceGuid) return;
    const cb = codebook();
    if (!cb) return;
    actions.mergeCode(cb.guid, sourceGuid, targetGuid);
    setMergingCodeGuid(null);
  };

  const mergeCodebook = async (targetCodebookGuid: string) => {
    const cb = codebook();
    if (!cb) return;
    if (!confirm(`Are you sure you want to merge this codebook into another? All codes and selections will be moved.`)) {
      setMergingCodebook(false);
      return;
    }
    await actions.mergeCodebook(cb.guid, targetCodebookGuid);
    setMergingCodebook(false);
  };

  const deleteCodebook = async () => {
    const cb = codebook();
    if (!cb) return;
    if (!confirm('Are you sure you want to delete this codebook? This cannot be undone.')) {
      return;
    }
    await actions.deleteCodebook(cb.guid);
  };

  return (
    <div class={styles.codebookEditorMain}>
      <Show when={codebook()} fallback={
        <div class={styles.codebookEditorEmpty}>
          <p>Codebook not found.</p>
        </div>
      }>
        {(cb) => (
          <>
            <div class={styles.codebookEditorHeader}>
              <Show when={editingName()} fallback={
                <h2 
                  class={styles.codebookTitle}
                  onClick={() => setEditingName(true)}
                  title="Click to rename"
                >
                  {cb().name}
                </h2>
              }>
                <input
                  type="text"
                  class={styles.codebookTitleInput}
                  value={cb().name}
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
              
              <div class={styles.codebookHeaderActions}>
                <button 
                  class={`${styles.btnSmall} ${styles.btnPrimary}`}
                  onClick={addTopLevelCode}
                >
                  Add Code
                </button>
                <button 
                  class={`${styles.btnSmall}`}
                  onClick={() => setMergingCodebook(true)}
                  title="Merge all codes into another codebook"
                >
                  Merge Into…
                </button>
                <button 
                  class={`${styles.btnSmall} ${styles.btnDanger}`}
                  onClick={deleteCodebook}
                >
                  Delete Codebook
                </button>
              </div>
            </div>
            
            <div class={styles.codebookCodesEditor} ref={props.scrollRef}>
              <Show when={cb().codes.length > 0} fallback={
                <p class={styles.noCodesMessage}>No codes yet. Add one to get started.</p>
              }>
                <CodeTreeEditor
                  codes={cb().codes}
                  codebookGuid={cb().guid}
                  depth={0}
                  onCodesChange={updateCodes}
                  onDelete={handleDeleteCode}
                  isExpanded={isExpanded}
                  onToggleExpanded={toggleExpanded}
                  onViewSelections={(codeGuid) => setViewingSelectionsForCode(codeGuid)}
                  onMerge={handleMerge}
                  onMove={handleMove}
                  getSelectionCount={getSelectionCount}
                />
              </Show>
            </div>

            <Show when={viewingSelectionsForCode()}>
              {(codeGuid) => (
                <CodeSelectionsModal
                  codeGuid={codeGuid()}
                  codebookGuid={cb().guid}
                  onClose={() => setViewingSelectionsForCode(null)}
                />
              )}
            </Show>

            <Show when={mergingCodeGuid()}>
              {(sourceGuid) => (
                <MergeTargetPicker
                  sourceCodeGuid={sourceGuid()}
                  allCodes={allFlatCodes()}
                  onSelect={confirmMerge}
                  onCancel={() => setMergingCodeGuid(null)}
                />
              )}
            </Show>

            <Show when={movingCodeGuid()}>
              {(codeGuid) => (
                <MoveToCodebookPicker
                  sourceCodebookGuid={cb().guid}
                  codebooks={codebooksList()}
                  onSelect={confirmMove}
                  onCancel={() => setMovingCodeGuid(null)}
                />
              )}
            </Show>

            <Show when={mergingCodebook()}>
              <CodebookMergeTargetPicker
                sourceCodebookGuid={cb().guid}
                codebooks={codebooksList()}
                onSelect={mergeCodebook}
                onCancel={() => setMergingCodebook(false)}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

export default CodebookEditor;
