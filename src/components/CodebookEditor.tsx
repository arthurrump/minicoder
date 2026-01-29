import { createSignal, createMemo, For, Show, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import styles from './CodebookEditor.module.css';

// Default colors for new codes
const DEFAULT_COLORS = [
  '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#E8BAFF', '#FFB3E6', '#C9FFBA', '#BAFFEC', '#D4BAFF'
];

interface CodeEditorProps {
  code: Code;
  onUpdate: (updates: Partial<Code>) => void;
  onDelete: () => void;
  onAddSubcode: () => void;
  onSubcodesChange: (subcodes: Code[]) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  isExpandedForCode: (guid: string) => boolean;
  onToggleExpandedForCode: (guid: string) => void;
  depth: number;
}

const CodeEditor: Component<CodeEditorProps> = (props) => {
  const hasSubcodes = () => props.code.subcodes && props.code.subcodes.length > 0;

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
            class={`${styles.codeActionBtn} ${styles.codeDeleteBtn}`} 
            onClick={props.onDelete}
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
                  depth={props.depth + 1}
                  onCodesChange={props.onSubcodesChange}
                  isExpanded={props.isExpandedForCode}
                  onToggleExpanded={props.onToggleExpandedForCode}
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
  onCodesChange: (codes: Code[]) => void;
  depth: number;
  isExpanded: (guid: string) => boolean;
  onToggleExpanded: (guid: string) => void;
}

const CodeTreeEditor: Component<CodeTreeEditorProps> = (props) => {
  const updateCode = (index: number, updates: Partial<Code>) => {
    const newCodes = [...props.codes];
    newCodes[index] = { ...newCodes[index], ...updates };
    props.onCodesChange(newCodes);
  };

  const deleteCode = (index: number) => {
    const newCodes = props.codes.filter((_, i) => i !== index);
    props.onCodesChange(newCodes);
  };

  const addSubcode = (index: number) => {
    const newCodes = [...props.codes];
    const newSubcode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Subcode',
      color: DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
      description: '',
      subcodes: []
    };
    newCodes[index] = {
      ...newCodes[index],
      subcodes: [...(newCodes[index].subcodes || []), newSubcode]
    };
    props.onCodesChange(newCodes);
  };

  const updateSubcodes = (index: number, subcodes: Code[]) => {
    const newCodes = [...props.codes];
    newCodes[index] = { ...newCodes[index], subcodes };
    props.onCodesChange(newCodes);
  };

  return (
    <For each={props.codes}>
      {(code, index) => (
        <CodeEditor
          code={code}
          depth={props.depth}
          onUpdate={(updates) => updateCode(index(), updates)}
          onDelete={() => deleteCode(index())}
          onAddSubcode={() => addSubcode(index())}
          onSubcodesChange={(subcodes) => updateSubcodes(index(), subcodes)}
          isExpanded={props.isExpanded(code.guid)}
          onToggleExpanded={() => props.onToggleExpanded(code.guid)}
          isExpandedForCode={props.isExpanded}
          onToggleExpandedForCode={props.onToggleExpanded}
        />
      )}
    </For>
  );
};

interface CodebookEditorProps {
  codebookPath: string;
  scrollRef?: (el: HTMLDivElement) => void;
  expandedCodeGuids?: Set<string>;
  onExpandedCodeGuidsChange?: (next: Set<string>) => void;
}

const CodebookEditor: Component<CodebookEditorProps> = (props) => {
  const { store, actions } = useStore();
  const [editingName, setEditingName] = createSignal(false);
  const [localExpandedGuids, setLocalExpandedGuids] = createSignal<Set<string>>(new Set());

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

  // Find codebook by matching the path (filename should be {name}.mcc)
  const codebook = createMemo(() => {
    // Extract codebook name from path (remove .mcc extension)
    const pathParts = props.codebookPath.split('/');
    const filename = pathParts[pathParts.length - 1];
    const codebookName = filename.replace(/\.mcc$/, '');
    
    // Case-insensitive comparison since filenames are lowercased
    return store.codebooks.find(cb => cb.name.toLowerCase() === codebookName.toLowerCase()) || null;
  });

  const updateCodebookName = async (newName: string) => {
    const cb = codebook();
    if (!cb || !newName.trim()) return;
    
    // Delete old file first (it has the old name)
    await actions.deleteCodebook(cb.guid);
    
    // Save with new name
    const updatedCodebook = { ...cb, name: newName.trim() };
    await actions.saveCodebook(updatedCodebook);
    setEditingName(false);
  };

  const updateCodebookCodes = async (codes: Code[]) => {
    const cb = codebook();
    if (!cb) return;
    const updatedCodebook = { ...cb, codes };
    await actions.saveCodebook(updatedCodebook);
  };

  const addTopLevelCode = async () => {
    const cb = codebook();
    if (!cb) return;
    const newCode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Code',
      color: DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
      description: '',
      subcodes: []
    };
    const updatedCodebook = { ...cb, codes: [...cb.codes, newCode] };
    await actions.saveCodebook(updatedCodebook);
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
                  onBlur={(e) => updateCodebookName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateCodebookName((e.target as HTMLInputElement).value);
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
                  depth={0}
                  onCodesChange={updateCodebookCodes}
                  isExpanded={isExpanded}
                  onToggleExpanded={toggleExpanded}
                />
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default CodebookEditor;
