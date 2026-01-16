import { createSignal, createMemo, For, Show, type Component } from 'solid-js';
import Resizable from '@corvu/resizable';
import { useStore } from '../store';

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
  depth: number;
}

const CodeEditor: Component<CodeEditorProps> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(false);
  
  const hasSubcodes = () => props.code.subcodes && props.code.subcodes.length > 0;

  return (
    <>
      <div class="code-editor-item" style={{ "margin-left": `${props.depth * 20}px` }}>
        <div class="code-editor-row">
          <input
            type="color"
            class="code-color-picker"
            value={props.code.color}
            onChange={(e) => props.onUpdate({ color: e.target.value })}
            title="Code color"
          />
          
          <input
            type="text"
            class="code-name-input"
            value={props.code.name}
            onInput={(e) => props.onUpdate({ name: e.target.value })}
            placeholder="Code name..."
          />
          
          <div class="code-actions">
            <button 
              class="code-action-btn code-delete-btn" 
              onClick={props.onDelete}
              title="Delete code"
            >
              ×
            </button>
          </div>
        </div>
        
        <div class="code-description-row">
          <textarea
            class="code-description-input"
            placeholder="Description..."
            value={props.code.description || ''}
            onInput={(e) => props.onUpdate({ description: e.target.value })}
            rows="2"
          />
        </div>
        
        <div class="code-subcodes-section">
          <button 
            class="code-subcodes-toggle"
            onClick={() => setIsExpanded(!isExpanded())}
          >
            <span class="code-expand-icon">{isExpanded() ? '▼' : '▶'}</span>
            <span>Subcodes ({props.code.subcodes?.length || 0})</span>
          </button>
          
          <Show when={isExpanded()}>
            <div class="code-subcodes-content">
              <Show when={hasSubcodes()}>
                <CodeTreeEditor
                  codes={props.code.subcodes}
                  depth={props.depth + 1}
                  onCodesChange={props.onSubcodesChange}
                />
              </Show>
              <button 
                class="btn-small add-subcode-btn"
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
        />
      )}
    </For>
  );
};

const CodebookEditorView: Component = () => {
  const { store, actions } = useStore();
  const [selectedCodebookGuid, setSelectedCodebookGuid] = createSignal<string | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);
  const [newCodebookName, setNewCodebookName] = createSignal('');
  const [editingNameGuid, setEditingNameGuid] = createSignal<string | null>(null);

  const selectedCodebook = createMemo(() => {
    const guid = selectedCodebookGuid();
    if (!guid) return null;
    return store.codebooks.find(cb => cb.guid === guid) || null;
  });

  const createCodebook = async () => {
    const name = newCodebookName().trim();
    if (!name) return;

    const newCodebook: Codebook = {
      guid: crypto.randomUUID(),
      name,
      codes: []
    };

    await actions.saveCodebook(newCodebook);
    setSelectedCodebookGuid(newCodebook.guid);
    setNewCodebookName('');
    setIsCreating(false);
  };

  const updateCodebookName = async (codebook: Codebook, newName: string) => {
    if (!newName.trim()) return;
    
    // Delete old file first (it has the old name)
    await actions.deleteCodebook(codebook.guid);
    
    // Save with new name
    const updatedCodebook = { ...codebook, name: newName.trim() };
    await actions.saveCodebook(updatedCodebook);
    setEditingNameGuid(null);
  };

  const updateCodebookCodes = async (codebook: Codebook, codes: Code[]) => {
    const updatedCodebook = { ...codebook, codes };
    await actions.saveCodebook(updatedCodebook);
  };

  const addTopLevelCode = async (codebook: Codebook) => {
    const newCode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Code',
      color: DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
      description: '',
      subcodes: []
    };
    const updatedCodebook = { ...codebook, codes: [...codebook.codes, newCode] };
    await actions.saveCodebook(updatedCodebook);
  };

  const deleteCodebook = async (codebookGuid: string) => {
    if (!confirm('Are you sure you want to delete this codebook? This cannot be undone.')) {
      return;
    }
    await actions.deleteCodebook(codebookGuid);
    if (selectedCodebookGuid() === codebookGuid) {
      setSelectedCodebookGuid(null);
    }
  };

  return (
    <Resizable orientation="horizontal">
      <Resizable.Panel initialSize={0.25} minSize={0.15} maxSize={0.4}>
        <div class="codebook-sidebar">
          <div class="codebook-sidebar-header">
            <h3>Codebooks</h3>
            <button 
              class="add-codebook-btn" 
              onClick={() => setIsCreating(true)}
              title="Create new codebook"
            >
              +
            </button>
          </div>
          
          <Show when={isCreating()}>
            <div class="new-codebook-form">
              <input
                type="text"
                class="new-codebook-input"
                placeholder="Codebook name..."
                value={newCodebookName()}
                onInput={(e) => setNewCodebookName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createCodebook();
                  if (e.key === 'Escape') {
                    setIsCreating(false);
                    setNewCodebookName('');
                  }
                }}
                autofocus
              />
              <div class="new-codebook-actions">
                <button class="btn-small btn-primary" onClick={createCodebook}>Create</button>
                <button class="btn-small" onClick={() => { setIsCreating(false); setNewCodebookName(''); }}>Cancel</button>
              </div>
            </div>
          </Show>
          
          <div class="codebook-list-sidebar">
            <For each={store.codebooks} fallback={
              <p class="no-codebooks-message">No codebooks yet. Create one to get started.</p>
            }>
              {(codebook) => (
                <div 
                  class="codebook-list-item"
                  classList={{ 'selected': selectedCodebookGuid() === codebook.guid }}
                  onClick={() => setSelectedCodebookGuid(codebook.guid)}
                >
                  <span class="codebook-item-name">{codebook.name}</span>
                  <span class="codebook-item-count">{countCodes(codebook.codes)} codes</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Resizable.Panel>
      <Resizable.Handle aria-label="Resize codebook list and editor">
        <div class="inner-handle" />
      </Resizable.Handle>
      <Resizable.Panel initialSize={0.75} minSize={0.4}>
        <div class="codebook-editor-main">
          <Show when={selectedCodebook()} fallback={
            <div class="codebook-editor-empty">
              <p>Select a codebook to edit, or create a new one.</p>
            </div>
          }>
            {(codebook) => (
              <>
                <div class="codebook-editor-header">
                  <Show when={editingNameGuid() === codebook().guid} fallback={
                    <h2 
                      class="codebook-title"
                      onClick={() => setEditingNameGuid(codebook().guid)}
                      title="Click to rename"
                    >
                      {codebook().name}
                    </h2>
                  }>
                    <input
                      type="text"
                      class="codebook-title-input"
                      value={codebook().name}
                      onBlur={(e) => updateCodebookName(codebook(), e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateCodebookName(codebook(), (e.target as HTMLInputElement).value);
                        }
                        if (e.key === 'Escape') setEditingNameGuid(null);
                      }}
                      autofocus
                    />
                  </Show>
                  
                  <div class="codebook-header-actions">
                    <button 
                      class="btn-small btn-primary"
                      onClick={() => addTopLevelCode(codebook())}
                    >
                      Add Code
                    </button>
                    <button 
                      class="btn-small btn-danger"
                      onClick={() => deleteCodebook(codebook().guid)}
                    >
                      Delete Codebook
                    </button>
                  </div>
                </div>
                
                <div class="codebook-codes-editor">
                  <Show when={codebook().codes.length > 0} fallback={
                    <p class="no-codes-message">No codes yet. Add one to get started.</p>
                  }>
                    <CodeTreeEditor
                      codes={codebook().codes}
                      depth={0}
                      onCodesChange={(codes) => updateCodebookCodes(codebook(), codes)}
                    />
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>
      </Resizable.Panel>
    </Resizable>
  );
};

// Helper to count all codes including subcodes
function countCodes(codes: Code[]): number {
  let count = codes.length;
  for (const code of codes) {
    if (code.subcodes && code.subcodes.length > 0) {
      count += countCodes(code.subcodes);
    }
  }
  return count;
}

export default CodebookEditorView;
