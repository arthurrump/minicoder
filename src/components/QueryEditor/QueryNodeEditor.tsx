import { createSignal, createMemo, For, Show, type Component } from 'solid-js';
import Icon from '../Icon';
import { useStore } from '../../store';
import { updateQueryNodeAtPath } from '../../utils/query';
import styles from './QueryEditor.module.css';
import ColorChip from '../ColorChip';
import { flattenCodes } from '../MatchingSelections';
import type { QueryNode, QueryOperator } from '../../models/files';

interface QueryNodeEditorProps {
  node: QueryNode;
  queryGuid: string;
  /** Index path from the query root to this node ([] for root) */
  path: number[];
  depth: number;
}

const QueryNodeEditor: Component<QueryNodeEditorProps> = (props) => {
  const { store, actions, indices } = useStore();
  const [showCodePicker, setShowCodePicker] = createSignal(false);
  const allCodes = createMemo(() => flattenCodes(indices.sortedCodebooks()));
  
  const isCodeLike = () => props.node.type === 'code' || props.node.type === 'codebook';

  const updateNode = (replacement: QueryNode) => {
    const q = store.queries[props.queryGuid];
    if (!q?.query) return;
    const updated = updateQueryNodeAtPath(q.query, props.path, replacement);
    actions.updateQuery({ ...q, query: updated });
  };

  const deleteNode = () => {
    const q = store.queries[props.queryGuid];
    if (!q?.query) return;
    const updated = updateQueryNodeAtPath(q.query, props.path, null);
    actions.updateQuery({ ...q, query: updated });
  };

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
    updateNode({ type: 'operator', operator, children });
  };

  const handleAddChild = (type: 'code' | 'operator') => {
    if (props.node.type === 'operator') {
      const newChild: QueryNode = type === 'code' 
        ? { type: 'code', codeGuid: '', includeSubcodes: true }
        : { type: 'operator', operator: 'AND', children: [] };
      updateNode({
        type: 'operator',
        operator: props.node.operator,
        children: [...props.node.children, newChild],
      });
    }
  };

  const handleCodeSelect = (codeGuid: string) => {
    updateNode({
      type: 'code',
      codeGuid,
      includeSubcodes: props.node.type === 'code' ? (props.node.includeSubcodes !== false) : true,
    });
    setShowCodePicker(false);
  };

  const handleCodebookSelect = (codebookGuid: string) => {
    updateNode({ type: 'codebook', codebookGuid });
    setShowCodePicker(false);
  };

  const handleWrapWithOperator = (operator: QueryOperator) => {
    updateNode({
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
                  updateNode({
                    type: 'code',
                    codeGuid: props.node.codeGuid,
                    includeSubcodes: e.currentTarget.checked,
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
            onClick={deleteNode}
            title="Remove"
          ><Icon name="trash" width={14} /></button>
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
                queryGuid={props.queryGuid}
                path={[...props.path, index()]}
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
