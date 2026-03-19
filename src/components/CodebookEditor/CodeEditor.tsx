import { createMemo, Show, type Component } from 'solid-js';
import { useStore } from '../../store';
import Icon from '../Icon';
import styles from './CodebookEditor.module.css';
import CodeTreeEditor from './CodeTreeEditor';
import type { Code } from '../../models/files';

interface CodeEditorProps {
  code: Code;
  codebookGuid: string;
  onUpdateCode: (codeGuid: string, updates: Partial<Code>) => void;
  onMerge: (sourceGuid: string) => void;
  onMove: (codeGuid: string) => void;
  onAddSubcode: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  isExpandedForCode: (guid: string) => boolean;
  onToggleExpandedForCode: (guid: string) => void;
  onViewSelections: (codeGuid: string) => void;
  depth: number;
}

const CodeEditor: Component<CodeEditorProps> = (props) => {
  const { store, actions } = useStore();
  const hasSubcodes = () => props.code.subcodes && props.code.subcodes.length > 0;

  const selectionCount = createMemo(() => {
    let count = 0;
    for (const source of Object.values(store.sources)) {
      for (const sel of source.selections) {
        if (sel.code.codebookGuid === props.codebookGuid && sel.code.codeGuid === props.code.guid) {
          count++;
        }
      }
    }
    return count;
  });

  const handleDelete = () => {
    const name = props.code.name || 'this code';
    if (!confirm(`Delete "${name}" and all its subcodes? This cannot be undone.`)) return;
    actions.deleteCode(props.codebookGuid, props.code.guid);
  };

  return (
    <>
      <div class={styles.codeEditorItem}>
        <input
          type="color"
          class={styles.codeColorPicker}
          value={props.code.color}
          onChange={(e) => props.onUpdateCode(props.code.guid, { color: e.target.value })}
          title="Code color"
        />
        
        <input
          type="text"
          class={styles.codeNameInput}
          value={props.code.name}
          onInput={(e) => props.onUpdateCode(props.code.guid, { name: e.target.value })}
          placeholder="Code name..."
        />
        
        <div class={styles.codeActions}>
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onViewSelections(props.code.guid)}
            title="View selections"
          >
            <span class={styles.selectionCount}>{selectionCount()}</span>
            <Icon name="list-unordered" />
          </button>
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onMerge(props.code.guid)}
            title="Merge into another code"
          ><Icon name="git-merge" /></button>
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onMove(props.code.guid)}
            title="Move to another codebook"
          ><Icon name="arrow-right" /></button>
          <button 
            class={`${styles.codeActionBtn} ${styles.codeDeleteBtn}`} 
            onClick={handleDelete}
            title="Delete code"
          ><Icon name="trash" /></button>
        </div>
        
        <textarea
          class={styles.codeDescriptionInput}
          placeholder="Description..."
          value={props.code.description || ''}
          onInput={(e) => props.onUpdateCode(props.code.guid, { description: e.target.value })}
          rows="2"
        />
        
        <div class={styles.codeSubcodesSection}>
          <button 
            class={styles.codeSubcodesToggle}
            onClick={() => props.onToggleExpanded()}
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
                  parentCodeGuid={props.code.guid}
                  depth={props.depth + 1}
                  isExpanded={props.isExpandedForCode}
                  onToggleExpanded={props.onToggleExpandedForCode}
                  onViewSelections={props.onViewSelections}
                  onMerge={props.onMerge}
                  onMove={props.onMove}
                />
              </Show>
              <button 
                class={`${styles.btnSmall} ${styles.addSubcodeBtn}`}
                onClick={() => props.onAddSubcode()}
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

export default CodeEditor;
