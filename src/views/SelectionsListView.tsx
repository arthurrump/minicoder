import { createEffect, createSignal, For, on, Show, type Component } from 'solid-js';

interface SelectionWithSource {
  selection: TextSelection;
  sourcePath: string;
  sourceFileName: string;
  textSnippet: string;
}

interface SelectionsListViewProps {
  dirHandle: FileSystemDirectoryHandle;
  codebooks: Codebook[];
}

// Recursively find all .mcs files in a directory
async function findAllMcsFiles(
  dir: FileSystemDirectoryHandle,
  basePath: string = ""
): Promise<{ file: FileSystemFileHandle; path: string; sourceFileName: string }[]> {
  const results: { file: FileSystemFileHandle; path: string; sourceFileName: string }[] = [];
  
  for await (const [name, handle] of dir.entries()) {
    const fullPath = basePath ? `${basePath}/${name}` : name;
    
    if (handle.kind === 'file' && name.endsWith('.mcs')) {
      // The source file name is the .mcs file name without the .mcs extension
      const sourceFileName = name.slice(0, -4);
      results.push({
        file: handle as FileSystemFileHandle,
        path: fullPath,
        sourceFileName
      });
    } else if (handle.kind === 'directory') {
      const subResults = await findAllMcsFiles(handle as FileSystemDirectoryHandle, fullPath);
      results.push(...subResults);
    }
  }
  
  return results;
}

// Try to read the source file content for a given .mcs file
async function tryReadSourceContent(
  dir: FileSystemDirectoryHandle,
  mcsPath: string,
  sourceFileName: string
): Promise<string | null> {
  try {
    // Navigate to the directory containing the .mcs file
    const pathParts = mcsPath.split('/');
    pathParts.pop(); // Remove the .mcs filename
    
    let currentDir = dir;
    for (const part of pathParts) {
      currentDir = await currentDir.getDirectoryHandle(part);
    }
    
    // Try to get the source file
    const sourceHandle = await currentDir.getFileHandle(sourceFileName);
    const file = await sourceHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
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
            class="code-selections-header"
            onClick={() => props.onToggle(props.code.guid)}
          >
            <span class="code-toggle">
              {props.expandedCodes.has(props.code.guid) ? '▼' : '▶'}
            </span>
            <span 
              class="code-color-badge" 
              style={{ "background-color": props.code.color }}
            />
            <span class="code-name">{props.code.name}</span>
            <span class="code-count">
              {selections().length} selection{selections().length !== 1 ? 's' : ''}
            </span>
          </div>
          
          <Show when={props.expandedCodes.has(props.code.guid)}>
            <div class="code-selections-content">
              <For each={selections()}>
                {(sel) => (
                  <div class="selection-item">
                    <div class="selection-source">{sel.sourcePath}</div>
                    <Show when={sel.textSnippet}>
                      <div class="selection-snippet">"{sel.textSnippet}"</div>
                    </Show>
                    <Show when={sel.selection.note}>
                      <div class="selection-note">Note: {sel.selection.note}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
        
        <Show when={!hasSelections() && hasSubcodeSelections()}>
          {/* Show code name without expand/collapse if it has no selections but subcodes do */}
          <div class="code-selections-header code-selections-header-empty">
            <span 
              class="code-color-badge" 
              style={{ "background-color": props.code.color }}
            />
            <span class="code-name">{props.code.name}</span>
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

const SelectionsListView: Component<SelectionsListViewProps> = (props) => {
  const [selectionsMap, setSelectionsMap] = createSignal<Map<string, SelectionWithSource[]>>(new Map());
  const [loading, setLoading] = createSignal(true);
  const [expandedCodes, setExpandedCodes] = createSignal<Set<string>>(new Set());
  const [expandedCodebooks, setExpandedCodebooks] = createSignal<Set<string>>(new Set());

  // Auto-expand single codebook
  createEffect(on(() => props.codebooks, (codebooks) => {
    if (codebooks.length === 1) {
      setExpandedCodebooks(new Set([codebooks[0].guid]));
    } else {
      setExpandedCodebooks(new Set<string>());
    }
  }));

  // Load all selections when directory or codebooks change
  createEffect(async () => {
    const dir = props.dirHandle;
    const codebooks = props.codebooks;
    
    if (!dir || codebooks.length === 0) {
      setSelectionsMap(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Find all .mcs files
      const mcsFiles = await findAllMcsFiles(dir);

      // Map to collect selections per code
      const newSelectionsMap = new Map<string, SelectionWithSource[]>();

      // Process each .mcs file
      for (const { file, path, sourceFileName } of mcsFiles) {
        try {
          const mcsData = await file.getFile();
          const mcsText = await mcsData.text();
          const source = JSON.parse(mcsText) as Source;

          // Try to read the source file content
          const sourceContent = await tryReadSourceContent(dir, path, sourceFileName);

          for (const selection of source.selections) {
            if (!newSelectionsMap.has(selection.code_guid)) {
              newSelectionsMap.set(selection.code_guid, []);
            }

            // Extract text snippet if we have the source content
            let textSnippet = "";
            if (sourceContent) {
              const snippetStart = Math.max(0, selection.start);
              const snippetEnd = Math.min(sourceContent.length, selection.end);
              textSnippet = sourceContent.slice(snippetStart, snippetEnd);
            }

            newSelectionsMap.get(selection.code_guid)!.push({
              selection,
              sourcePath: path.replace(/\.mcs$/, ''),
              sourceFileName,
              textSnippet
            });
          }
        } catch (err) {
          console.warn(`Failed to process ${path}:`, err);
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
    <div class="selections-list-view">
      <h2>Selections by Code</h2>
      
      <Show when={!loading()} fallback={<p>Loading selections...</p>}>
        <Show when={totalSelections() > 0} fallback={
          <p class="no-selections">No selections found. Start coding in the Coding view to see selections here.</p>
        }>
          <div class="codebook-list">
            <For each={props.codebooks}>
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
