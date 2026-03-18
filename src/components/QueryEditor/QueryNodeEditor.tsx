import { createSignal, createMemo, For, Show, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../../store';
import styles from './QueryEditor.module.css';
import ColorChip from '../ColorChip';
import { flattenCodes } from '../MatchingSelections';

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

export default QueryNodeEditor;
