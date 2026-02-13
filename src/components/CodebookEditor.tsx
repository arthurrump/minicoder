import { createSignal, createMemo, Index, Show, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import styles from './CodebookEditor.module.css';
import CodeSelectionsModal from './CodeSelectionsModal';

// Color generation utilities using HSL color space

/**
 * Convert HSL color values to hex string
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Convert hex color string to HSL values
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 50, l: 50 };
  
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * Generate a random bright, saturated color for top-level codes
 * Uses random hue with high saturation and brightness
 */
function generateTopLevelColor(): string {
  const h = Math.random() * 360; // Random hue (0-360)
  const s = 75 + Math.random() * 25; // 75-100% saturation (high)
  const l = 45 + Math.random() * 15; // 45-60% lightness (bright)
  return hslToHex(h, s, l);
}

/**
 * Generate a subcode color based on parent color, depth, and sibling index
 * Uses the same hue but reduces saturation based on depth
 * Lightness varies deterministically based on index for sibling distinction
 */
function generateSubcodeColor(parentColor: string, depth: number, index: number): string {
  const { h } = hexToHsl(parentColor);
  // Reduce saturation as depth increases (minimum 25%)
  const s = Math.max(25, 90 - depth * 18);
  // Deterministic lightness variation based on index using golden ratio for even distribution
  const goldenRatio = 0.618033988749895;
  const l = 35 + ((index * goldenRatio) % 1) * 35; // 35-70% range, evenly distributed
  return hslToHex(h, Math.round(s), Math.round(l));
}

interface CodeEditorProps {
  code: Code;
  codebookGuid: string;
  onUpdate: (updates: Partial<Code>) => void;
  onDelete: () => void;
  onAddSubcode: () => void;
  onSubcodesChange: (subcodes: Code[]) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  isExpandedForCode: (guid: string) => boolean;
  onToggleExpandedForCode: (guid: string) => void;
  onViewSelections: (codeGuid: string) => void;
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
            class={styles.codeActionBtn}
            onClick={() => props.onViewSelections(props.code.guid)}
            title="View selections"
            innerHTML={octicons['list-unordered'].toSVG()}
          />
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
                  codebookGuid={props.codebookGuid}
                  depth={props.depth + 1}
                  onCodesChange={props.onSubcodesChange}
                  isExpanded={props.isExpandedForCode}
                  onToggleExpanded={props.onToggleExpandedForCode}
                  onViewSelections={props.onViewSelections}
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
  depth: number;
  isExpanded: (guid: string) => boolean;
  onToggleExpanded: (guid: string) => void;
  onViewSelections: (codeGuid: string) => void;
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
          onDelete={() => deleteCode(index)}
          onAddSubcode={() => addSubcode(index)}
          onSubcodesChange={(subcodes) => updateSubcodes(index, subcodes)}
          isExpanded={props.isExpanded(code().guid)}
          onToggleExpanded={() => props.onToggleExpanded(code().guid)}
          isExpandedForCode={props.isExpanded}
          onToggleExpandedForCode={props.onToggleExpanded}
          onViewSelections={props.onViewSelections}
        />
      )}
    </Index>
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
  const [viewingSelectionsForCode, setViewingSelectionsForCode] = createSignal<string | null>(null);

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

  // Find codebook by path
  const codebook = createMemo(() => {
    return store.codebooks[props.codebookPath] || null;
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

  const updateCodebookCodes = (codes: Code[]) => {
    const cb = codebook();
    if (!cb) return;
    
    const updatedCodebook = { ...cb, codes };
    actions.updateCodebook(updatedCodebook);
  };

  const addTopLevelCode = async () => {
    const cb = codebook();
    if (!cb) return;
    const newCode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Code',
      color: generateTopLevelColor(),
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
                  codebookGuid={cb().guid}
                  depth={0}
                  onCodesChange={updateCodebookCodes}
                  isExpanded={isExpanded}
                  onToggleExpanded={toggleExpanded}
                  onViewSelections={(codeGuid) => setViewingSelectionsForCode(codeGuid)}
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
          </>
        )}
      </Show>
    </div>
  );
};

export default CodebookEditor;
