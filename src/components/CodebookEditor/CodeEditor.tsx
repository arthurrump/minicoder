import { Show, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import Icon from '../Icon';
import styles from './CodebookEditor.module.css';
import CodeTreeEditor from './CodeTreeEditor';
import type { Code } from '../../models/files';

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
            <Icon icon={octicons['list-unordered']} />
          </button>
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onMerge(props.code.guid)}
            title="Merge into another code"
          ><Icon icon={octicons['git-merge']} /></button>
          <button 
            class={styles.codeActionBtn}
            onClick={() => props.onMove(props.code.guid)}
            title="Move to another codebook"
          ><Icon icon={octicons['arrow-right']} /></button>
          <button 
            class={`${styles.codeActionBtn} ${styles.codeDeleteBtn}`} 
            onClick={() => props.onDelete(props.code.guid)}
            title="Delete code"
          ><Icon icon={octicons.trash} /></button>
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
