import { createEffect, createSignal, For, on, Show, type Component } from 'solid-js';
import { useStore } from '../store';
import styles from './SelectionsListView.module.css';

interface SelectionWithSource {
  selection: TextSelection;
  sourcePath: string;
  sourceFileName: string;
  textSnippet: string;
}

// Component for rendering selections for a single code
interface CodeSelectionsProps {
  code: Code;
  codebook: Codebook;
  selectionsMap: Map<string, SelectionWithSource[]>;
  expandedCodes: Set<string>;
  onToggle: (codeGuid: string) => void;
  depth: number;
}

const CodeSelections: Component<CodeSelectionsProps> = (props) => {
  const selections = () => props.selectionsMap.get(props.code.guid) || [];
  const hasSelections = () => selections().length > 0;
  const hasSubcodeSelections = (): boolean => {
    if (!props.code.subcodes) return false;
    return props.code.subcodes.some(subcode => 
      (props.selectionsMap.get(subcode.guid)?.length || 0) > 0 ||
      hasSubcodeSelectionsRecursive(subcode)
    );
  };
  
  const hasSubcodeSelectionsRecursive = (code: Code): boolean => {
    if (!code.subcodes) return false;
    return code.subcodes.some(subcode =>
      (props.selectionsMap.get(subcode.guid)?.length || 0) > 0 ||
      hasSubcodeSelectionsRecursive(subcode)
    );
  };

  // Only show if this code or its subcodes have selections
  const shouldShow = () => hasSelections() || hasSubcodeSelections();

  return (
    <Show when={shouldShow()}>
      <div class="code-selections-section" style={{ "margin-left": `${props.depth * 20}px` }}>
        <Show when={hasSelections()}>
          <div 
            class={styles.codeSelectionsHeader}
            onClick={() => props.onToggle(props.code.guid)}
          >
            <span class={styles.codeToggle}>
              {props.expandedCodes.has(props.code.guid) ? '▼' : '▶'}
            </span>
            <span 
              class={styles.codeColorBadge} 
              style={{ "background-color": props.code.color }}
            />
            <span class={styles.codeName}>{props.code.name}</span>
            <span class={styles.codeCount}>
              {selections().length} selection{selections().length !== 1 ? 's' : ''}
            </span>
          </div>
          
          <Show when={props.expandedCodes.has(props.code.guid)}>
            <div class={styles.codeSelectionsContent}>
              <For each={selections()}>
                {(sel) => (
                  <div class={styles.selectionItem}>
                    <div class={styles.selectionSource}>{sel.sourcePath}</div>
                    <Show when={sel.textSnippet}>
                      <div class={styles.selectionSnippet}>"{sel.textSnippet}"</div>
                    </Show>
                    <Show when={sel.selection.note}>
                      <div class={styles.selectionNote}>Note: {sel.selection.note}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
        
        <Show when={!hasSelections() && hasSubcodeSelections()}>
          {/* Show code name without expand/collapse if it has no selections but subcodes do */}
          <div class={`${styles.codeSelectionsHeader} ${styles.codeSelectionsHeaderEmpty}`}>
            <span 
              class={styles.codeColorBadge} 
              style={{ "background-color": props.code.color }}
            />
            <span class={styles.codeName}>{props.code.name}</span>
          </div>
        </Show>
        
        {/* Render subcodes */}
        <Show when={props.code.subcodes && props.code.subcodes.length > 0}>
          <For each={props.code.subcodes}>
            {(subcode) => (
              <CodeSelections
                code={subcode}
                codebook={props.codebook}
                selectionsMap={props.selectionsMap}
                expandedCodes={props.expandedCodes}
                onToggle={props.onToggle}
                depth={props.depth + 1}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
};

const SelectionsListView: Component = () => {
  const { store, actions } = useStore();
  const [selectionsMap, setSelectionsMap] = createSignal<Map<string, SelectionWithSource[]>>(new Map());
  const [loading, setLoading] = createSignal(true);
  const [expandedCodes, setExpandedCodes] = createSignal<Set<string>>(new Set());
  const [expandedCodebooks, setExpandedCodebooks] = createSignal<Set<string>>(new Set());

  // Auto-expand single codebook
  createEffect(on(() => store.codebooks, (codebooks) => {
    if (codebooks.length === 1) {
      setExpandedCodebooks(new Set([codebooks[0].guid]));
    } else {
      setExpandedCodebooks(new Set<string>());
    }
  }));

  // Load all selections from store
  createEffect(async () => {
    const sources = store.sources;
    const codebooks = store.codebooks;
    
    if (!sources || codebooks.length === 0) {
      setSelectionsMap(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Map to collect selections per code
      const newSelectionsMap = new Map<string, SelectionWithSource[]>();

      // Process each source from the store
      for (const [sourcePath, source] of Object.entries(sources)) {
        // Try to load the source file content if not already loaded
        let sourceContent = store.fileContents[sourcePath];
        if (!sourceContent) {
          sourceContent = await actions.loadFileContent(sourcePath) || '';
        }

        for (const selection of source.selections) {
          if (!newSelectionsMap.has(selection.code_guid)) {
            newSelectionsMap.set(selection.code_guid, []);
          }

          // Extract text snippet
          let textSnippet = "";
          if (sourceContent) {
            const snippetStart = Math.max(0, selection.start);
            const snippetEnd = Math.min(sourceContent.length, selection.end);
            textSnippet = sourceContent.slice(snippetStart, snippetEnd);
          }

          const sourceFileName = sourcePath.split('/').pop() || sourcePath;
          newSelectionsMap.get(selection.code_guid)!.push({
            selection,
            sourcePath,
            sourceFileName,
            textSnippet
          });
        }
      }

      // Sort selections within each code: by filepath, then by start index
      for (const selections of newSelectionsMap.values()) {
        selections.sort((a, b) => {
          const pathCompare = a.sourcePath.localeCompare(b.sourcePath);
          if (pathCompare !== 0) return pathCompare;
          return a.selection.start - b.selection.start;
        });
      }

      setSelectionsMap(newSelectionsMap);
    } catch (err) {
      console.error("Failed to load selections:", err);
      setSelectionsMap(new Map());
    } finally {
      setLoading(false);
    }
  });

  function toggleCode(codeGuid: string) {
    setExpandedCodes(prev => {
      const next = new Set(prev);
      if (next.has(codeGuid)) {
        next.delete(codeGuid);
      } else {
        next.add(codeGuid);
      }
      return next;
    });
  }

  function toggleCodebook(codebookGuid: string) {
    setExpandedCodebooks(prev => {
      const next = new Set(prev);
      if (next.has(codebookGuid)) {
        next.delete(codebookGuid);
      } else {
        next.add(codebookGuid);
      }
      return next;
    });
  }

  // Check if a codebook has any selections (including in subcodes)
  const codebookHasSelections = (codebook: Codebook): boolean => {
    const checkCodes = (codes: Code[]): boolean => {
      return codes.some(code => 
        (selectionsMap().get(code.guid)?.length || 0) > 0 ||
        (code.subcodes && checkCodes(code.subcodes))
      );
    };
    return checkCodes(codebook.codes);
  };

  const totalSelections = () => {
    let count = 0;
    for (const selections of selectionsMap().values()) {
      count += selections.length;
    }
    return count;
  };

  return (
    <div class={styles.selectionsListView}>
      <h2>Selections by Code</h2>
      
      <Show when={!loading()} fallback={<p>Loading selections...</p>}>
        <Show when={totalSelections() > 0} fallback={
          <p class={styles.noSelections}>No selections found. Start coding in the Coding view to see selections here.</p>
        }>
          <div class="codebook-list">
            <For each={store.codebooks}>
              {(codebook) => (
                <Show when={codebookHasSelections(codebook)}>
                  <div class="codebook-section">
                    <div 
                      class="codebook-header"
                      onClick={() => toggleCodebook(codebook.guid)}
                    >
                      <span class="codebook-toggle">
                        {expandedCodebooks().has(codebook.guid) ? '▼' : '▶'}
                      </span>
                      <span class="codebook-name">{codebook.name}</span>
                    </div>
                    <Show when={expandedCodebooks().has(codebook.guid)}>
                      <div class="codebook-codes">
                        <For each={codebook.codes}>
                          {(code) => (
                            <CodeSelections
                              code={code}
                              codebook={codebook}
                              selectionsMap={selectionsMap()}
                              expandedCodes={expandedCodes()}
                              onToggle={toggleCode}
                              depth={0}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default SelectionsListView;
