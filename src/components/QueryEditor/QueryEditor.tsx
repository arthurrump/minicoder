import { createSignal, createMemo, For, Show, type Component } from 'solid-js';
import { useStore } from '../../store';
import styles from './QueryEditor.module.css';
import QueryNodeEditor from './QueryNodeEditor';
import QueryMatchingSelections from './QueryMatchingSelections';
import type { Code, Codebook, QueryClause, QueryUnderlineStyle } from '../../models/files';

interface QueryEditorProps {
  queryGuid: string;
  scrollRef?: (el: HTMLDivElement) => void;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

const QueryEditor: Component<QueryEditorProps> = (props) => {
  const { store, actions } = useStore();
  const [editingName, setEditingName] = createSignal(false);

  const query = createMemo(() => {
    return store.queries[props.queryGuid] || null;
  });

  const updateName = (newName: string) => {
    const q = query();
    if (!q || !newName.trim()) return;
    actions.updateQuery({ ...q, name: newName.trim() });
    setEditingName(false);
  };

  const updateFileFilter = (value: string) => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, fileFilter: value });
  };

  const updateUserFilter = (value: (string | undefined)[]) => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, userFilter: value });
  };

  const updateShowOnlyMatching = (value: boolean) => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, showOnlyMatching: value });
  };

  const updateClauses = (updater: (clauses: QueryClause[]) => QueryClause[]) => {
    const q = query();
    if (!q) return;
    const next = updater(q.clauses ?? []);
    actions.updateQuery({ ...q, clauses: next });
  };

  const addClause = () => {
    updateClauses((clauses) => [
      ...clauses,
      {
        guid: crypto.randomUUID(),
        query: null,
        style: 'solid',
        fileFilter: '',
        userFilter: [],
      },
    ]);
  };

  const removeClause = (clauseGuid: string) => {
    updateClauses((clauses) => clauses.filter((clause) => clause.guid !== clauseGuid));
  };

  const updateClause = (clauseGuid: string, patch: Partial<QueryClause>) => {
    updateClauses((clauses) => clauses.map((clause) => {
      if (clause.guid !== clauseGuid) return clause;
      return { ...clause, ...patch };
    }));
  };

  const toggleClauseUserFilter = (clauseGuid: string, user: string | undefined) => {
    const q = query();
    if (!q) return;
    const clauses = q.clauses ?? [];
    const clause = clauses.find(c => c.guid === clauseGuid);
    if (!clause) return;
    const current = clause.userFilter ?? [];
    const next = current.includes(user)
      ? current.filter(u => u !== user)
      : [...current, user];
    updateClause(clauseGuid, { userFilter: next });
  };

  // Collect all unique user IDs from selections
  const allUsers = createMemo(() => {
    const users = new Set<string>();
    for (const source of Object.values(store.sources)) {
      for (const selection of source.selections) {
        if (selection.creatingUser) {
          users.add(selection.creatingUser);
        }
      }
    }
    return Array.from(users).sort();
  });

  const clearQuery = () => {
    const q = query();
    if (!q) return;
    actions.updateQuery({ ...q, query: null });
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
                  onClick={() => { void deleteQuery(); }}
                >
                  Delete Query
                </button>
              </div>
            </div>

            <div class={styles.queryFilterGrid}>
              <label class={styles.queryFilterLabel}>Filter files</label>
              <input
                class={styles.queryFilterInput}
                type="text"
                placeholder="e.g. interviews/**/*.txt, notes/*.md"
                value={q().fileFilter}
                onInput={(e) => updateFileFilter(e.currentTarget.value)}
              />
              <Show when={allUsers().length > 0}>
                  <label class={styles.queryFilterLabel}>Filter users</label>
                  <div class={styles.userFilterContainer}>
                    <div class={styles.userChips}>
                      <For each={[ undefined, ...allUsers() ]}>
                        {(user) => {
                          const isSelected = () => q().userFilter.includes(user);
                          return (
                            <label
                              class={styles.userChip}
                              classList={{ [styles.userChipChecked]: isSelected() }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected()}
                                onChange={() => {
                                  if (q().userFilter.includes(user)) {
                                    // Remove user
                                    updateUserFilter(q().userFilter.filter(u => u !== user));
                                  } else {
                                    // Add user
                                    updateUserFilter([...q().userFilter, user]);
                                  }
                                }}
                              />
                              <span>{user || <code>undefined</code>}</span>
                            </label>
                          );
                        }}
                      </For>
                    </div>
                  </div>
              </Show>
              <label class={styles.queryFilterLabel}>Show only matching</label>
              <input
                class={styles.queryFilterCheckbox}
                type="checkbox"
                checked={q().showOnlyMatching || false} 
                onChange={(e) => updateShowOnlyMatching(e.target.checked)} 
              />
            </div>
            
            
            <div class={styles.queryBuilder}>
              <h3 class={styles.queryBuilderSectionHeader}>Base Query</h3>
              <Show when={q().query} fallback={
                <div class={styles.addChildButtons}>
                  <button class={styles.addChildBtn} onClick={() => {
                    actions.updateQuery({ ...q(), query: { type: 'code', codeGuid: '', includeSubcodes: true } });
                  }}>
                    + Add Code
                  </button>
                  <button class={styles.addChildBtn} onClick={() => {
                    actions.updateQuery({ ...q(), query: { type: 'operator', operator: 'AND', children: [] } });
                  }}>
                    + Add Operator
                  </button>
                </div>
              }>
                <QueryNodeEditor
                  node={q().query!}
                  queryGuid={props.queryGuid}
                  path={[]}
                  depth={0}
                />
              </Show>
              <div class={styles.clauseHeaderRow}>
                <h3 class={styles.queryBuilderSectionHeader}>Styled Clauses</h3>
                <button class={styles.addChildBtn} onClick={addClause}>+ Add Clause</button>
              </div>

              <Show when={(q().clauses ?? []).length > 0} fallback={
                <p class={styles.noQueryMessage}>No clauses configured. Add a clause to apply custom underline styles.</p>
              }>
                <div class={styles.clauseList}>
                  <For each={q().clauses ?? []}>
                    {(clause, index) => (
                      <div class={styles.clauseCard}>
                        <div class={styles.clauseCardHeader}>
                          <span class={styles.clauseCardTitle}>Clause {index() + 1}</span>
                          <button
                            class={styles.deleteBtn}
                            title="Remove clause"
                            onClick={() => removeClause(clause.guid)}
                          >
                            Remove
                          </button>
                        </div>

                        <div class={styles.clauseGrid}>
                          <label class={styles.queryFilterLabel}>Style</label>
                          <select
                            class={styles.queryFilterInput}
                            value={clause.style ?? 'solid'}
                            onChange={(e) => updateClause(clause.guid, { style: e.currentTarget.value as QueryUnderlineStyle })}
                          >
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                            <option value="double">Double</option>
                          </select>

                          <label class={styles.queryFilterLabel}>Filter files</label>
                          <input
                            class={styles.queryFilterInput}
                            type="text"
                            placeholder="Optional extra file filter"
                            value={clause.fileFilter ?? ''}
                            onInput={(e) => updateClause(clause.guid, { fileFilter: e.currentTarget.value })}
                          />

                          <Show when={allUsers().length > 0}>
                            <label class={styles.queryFilterLabel}>Filter users</label>
                            <div class={styles.userFilterContainer}>
                              <div class={styles.userChips}>
                                <For each={[undefined, ...allUsers()]}>
                                  {(user) => {
                                    const isSelected = () => (clause.userFilter ?? []).includes(user);
                                    return (
                                      <label
                                        class={styles.userChip}
                                        classList={{ [styles.userChipChecked]: isSelected() }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected()}
                                          onChange={() => toggleClauseUserFilter(clause.guid, user)}
                                        />
                                        <span>{user || <code>undefined</code>}</span>
                                      </label>
                                    );
                                  }}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </div>

                        <div class={styles.queryChildren}>
                          <Show when={clause.query} fallback={
                            <div class={styles.addChildButtons}>
                              <button
                                class={styles.addChildBtn}
                                onClick={() => updateClause(clause.guid, { query: { type: 'code', codeGuid: '', includeSubcodes: true } })}
                              >
                                + Add Clause Code
                              </button>
                              <button
                                class={styles.addChildBtn}
                                onClick={() => updateClause(clause.guid, { query: { type: 'operator', operator: 'AND', children: [] } })}
                              >
                                + Add Clause Operator
                              </button>
                            </div>
                          }>
                            <QueryNodeEditor
                              node={clause.query!}
                              controlledRoot={clause.query}
                              onControlledRootChange={(next) => updateClause(clause.guid, { query: next })}
                              path={[]}
                              depth={0}
                            />
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            
            {/* Display matching selections */}
            <QueryMatchingSelections
              query={q()}
              expandedKeys={props.expandedKeys}
              onExpandedKeysChange={props.onExpandedKeysChange}
              onOpenSource={props.onOpenSource}
              onSelectionCreate={props.onSelectionCreate}
              onSelectionClear={props.onSelectionClear}
              selectedCode={props.selectedCode}
            />
          </>
        )}
      </Show>
    </div>
  );
};

export default QueryEditor;
