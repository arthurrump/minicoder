import { createSignal, createMemo, Show, type Component } from 'solid-js';
import { useStore } from '../../store';
import { generateTopLevelColor } from '../../utils/colors';
import { flattenCodesWithDepth } from '../../utils/codeTree';
import type { Code } from '../../models/files';
import styles from './CodebookEditor.module.css';
import CodeSelectionsModal from '../CodeSelectionsModal';
import MergeTargetPicker from './MergeTargetPicker';
import CodebookMergeTargetPicker from './CodebookMergeTargetPicker';
import MoveToCodebookPicker from './MoveToCodebookPicker';
import CodeTreeEditor from './CodeTreeEditor';

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
    if (props.onExpandedCodeGuidsChange) {
      props.onExpandedCodeGuidsChange(next);
    } else {
      setLocalExpandedGuids(next);
    }
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
                  onClick={() => { void deleteCodebook(); }}
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
              {() => (
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
                onSelect={(guid) => { void mergeCodebook(guid); }}
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
