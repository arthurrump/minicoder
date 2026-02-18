import { createEffect, createMemo, createSignal, For, on, Show, type Component } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import Resizable from '@corvu/resizable';
import FileBrowser from '../components/FileBrowser';
import CodePicker from '../components/CodePicker';
import TextView from '../components/TextView';
import ColorChip from '../components/ColorChip';
import CodebookEditor from '../components/CodebookEditor';
import QueryEditor from '../components/QueryEditor';
import CodeSelectionsModal from '../components/CodeSelectionsModal';
import { useStore } from '../store';
import { useSettings } from '../settings';
import styles from './CodingView.module.css';

// Helper to compute disambiguated tab names
function getTabDisplayNames(openTabs: string[]): Map<string, string> {
  const result = new Map<string, string>();
  
  // Group tabs by their filename
  const fileNameGroups = new Map<string, string[]>();
  for (const path of openTabs) {
    const fileName = path.split('/').pop() || path;
    if (!fileNameGroups.has(fileName)) {
      fileNameGroups.set(fileName, []);
    }
    fileNameGroups.get(fileName)!.push(path);
  }
  
  // For each group, determine the minimum path segments needed to disambiguate
  for (const [fileName, paths] of fileNameGroups) {
    if (paths.length === 1) {
      // No disambiguation needed
      result.set(paths[0], fileName);
    } else {
      // Need to find unique prefixes
      const pathParts = paths.map(p => p.split('/').reverse());
      
      for (let i = 0; i < paths.length; i++) {
        let segmentsNeeded = 1;
        const currentParts = pathParts[i];
        
        // Compare with all other paths to find minimum segments needed
        for (let j = 0; j < paths.length; j++) {
          if (i === j) continue;
          const otherParts = pathParts[j];
          
          // Find how many segments from the end we need to differentiate
          let k = 0;
          while (k < currentParts.length && k < otherParts.length && currentParts[k] === otherParts[k]) {
            k++;
          }
          segmentsNeeded = Math.max(segmentsNeeded, k + 1);
        }
        
        // Build the display name with required segments
        const displayParts = currentParts.slice(0, Math.min(segmentsNeeded, currentParts.length)).reverse();
        result.set(paths[i], displayParts.join('/'));
      }
    }
  }
  
  return result;
}

const CodingView: Component = () => {
  const { store, actions, indices } = useStore();
  const { settings } = useSettings();
  const params = useParams<{ filePath?: string }>();
  const navigate = useNavigate();
  
  // Get file path from URL params, decoding it
  const selectedFilePath = createMemo(() => {
    return params.filePath ? decodeURIComponent(params.filePath) : '';
  });
  
  // Check if the selected file is a codebook file
  const isCodebookFile = createMemo(() => {
    return selectedFilePath().endsWith('.mcc');
  });
  
  // Check if the selected file is a query file
  const isQueryFile = createMemo(() => {
    return selectedFilePath().endsWith('.mcq');
  });
  
  // Check if the selected file is a special file (codebook or query)
  const isSpecialFile = createMemo(() => {
    return isCodebookFile() || isQueryFile();
  });
  
  // Sorted codebooks list for components that expect Codebook[]
  const codebooksList = createMemo(() =>
    Object.values(store.codebooks).sort((a, b) => a.name.localeCompare(b.name))
  );

  
  // Tab management
  const [openTabs, setOpenTabs] = createSignal<string[]>([]);
  
  // Compute display names for tabs with disambiguation
  const tabDisplayNames = createMemo(() => getTabDisplayNames(openTabs()));
  
  // Store scroll positions for text file tabs (query/codebook tabs preserve scroll via per-tab instances)
  const scrollPositions = new Map<string, number>();
  let textViewWrapperRef: HTMLDivElement | undefined;

  // Derived lists of open query/codebook tabs for per-tab rendering
  const openQueryTabs = createMemo(() => openTabs().filter(p => p.endsWith('.mcq')));
  const openCodebookTabs = createMemo(() => openTabs().filter(p => p.endsWith('.mcc')));
  
  // Helper to save current text file scroll position before navigating away
  function saveCurrentScrollPosition() {
    const currentPath = selectedFilePath();
    if (!currentPath || currentPath.endsWith('.mcc') || currentPath.endsWith('.mcq')) return;
    if (textViewWrapperRef) {
      scrollPositions.set(currentPath, textViewWrapperRef.scrollTop);
    }
  }

  function restoreScrollPosition(path: string) {
    if (textViewWrapperRef) {
      textViewWrapperRef.scrollTop = scrollPositions.get(path) || 0;
    }
  }
  
  const [selectedCode, setSelectedCode] = createSignal<{ code: Code, codebook: Codebook } | null>(null);
  const [infoModal, setInfoModal] = createSignal<{ codeGuid: string; codebookGuid: string } | null>(null);
  const [pendingSelection, setPendingSelection] = createSignal<{ sourcePath: string; start: number; end: number } | null>(null);
  const [hashMismatchWarning, setHashMismatchWarning] = createSignal<boolean>(false);
  const nonPlainTextWarning = createMemo(() => {
    const path = selectedFilePath();
    if (!path) return false;
    const fc = store.fileContents[path];
    return fc?.type === 'binary';
  });

  // Clear pending selection when switching tabs
  createEffect(on(selectedFilePath, () => {
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  }, { defer: true }));

  // Sync tabs with URL - if URL has a file that's not in tabs, add it
  createEffect(on(selectedFilePath, (path) => {
    if (path && !openTabs().includes(path)) {
      // Find current active tab index to insert next to it
      const currentTabs = openTabs();
      const currentIndex = currentTabs.indexOf(selectedFilePath());
      if (currentIndex >= 0) {
        // Insert after current tab
        const newTabs = [...currentTabs];
        newTabs.splice(currentIndex + 1, 0, path);
        setOpenTabs(newTabs);
      } else {
        // Add at the end
        setOpenTabs([...currentTabs, path]);
      }
    }
  }));

  // Ensure file content is loaded when a file is selected
  createEffect(on(selectedFilePath, (path) => {
    if (path && !isSpecialFile()) {
      actions.ensureFileLoaded(path);
    }
  }));

  // Read file content reactively from the store
  const fileContent = createMemo(() => {
    const path = selectedFilePath();
    if (!path) return undefined;
    const fc = store.fileContents[path];
    return fc?.type === 'plain-text' ? fc.content : undefined;
  });

  // Restore scroll position when file content loads (text files only)
  createEffect(on(() => fileContent(), () => {
    const path = selectedFilePath();
    if (path && textViewWrapperRef) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        restoreScrollPosition(path);
      });
    }
  }));

  // Get selections from store for the selected file
  const selections = createMemo(() => {
    const path = selectedFilePath();
    if (!path) return [];
    const source = store.sources[path];
    return source?.selections || [];
  });

  // Check hash when file content or source changes
  createEffect(on([selectedFilePath, () => fileContent()], async ([path, content]) => {
    if (!path || !content) {
      setHashMismatchWarning(false);
      return;
    }

    const source = store.sources[path];
    if (!source) {
      setHashMismatchWarning(false);
      return;
    }

    // Check hash (pre-computed at load time)
    const fc = store.fileContents[path];
    const currentHash = fc?.hash;
    if (currentHash && source.fileHash !== currentHash) {
      setHashMismatchWarning(true);
      console.warn("File content has changed since selections were saved");
    } else {
      setHashMismatchWarning(false);
    }
  }));

  function handleCodeClick(code: Code, codebook: Codebook) {
    const pending = pendingSelection();
    if (pending) {
      // We have a pending text selection, apply this code to it
      const newSelection: TextSelection = {
        guid: crypto.randomUUID(),
        start: pending.start,
        end: pending.end,
        code: { codebookGuid: codebook.guid, codeGuid: code.guid },
        creatingUser: settings().userId || undefined,
        note: undefined
      };
      
      const currentSelections = store.sources[pending.sourcePath]?.selections || [];
      actions.updateSourceSelections(pending.sourcePath, [...currentSelections, newSelection]);
      
      setPendingSelection(null);
      setSelectedCode(null);
      // Clear the browser's text selection now that the code is applied
      window.getSelection()?.removeAllRanges();
    } else {
      // Just select this code for future use
      setSelectedCode({ code, codebook });
    }
  }

  function handleSelectionCreateForSource(sourcePath: string, start: number, end: number) {
    const code = selectedCode();
    if (code) {
      // If a code is already selected, apply it immediately
      const newSelection: TextSelection = {
        guid: crypto.randomUUID(),
        start,
        end,
        code: { codebookGuid: code.codebook.guid, codeGuid: code.code.guid },
        creatingUser: settings().userId || undefined,
        note: undefined
      };
      
      const currentSelections = store.sources[sourcePath]?.selections || [];
      actions.updateSourceSelections(sourcePath, [...currentSelections, newSelection]);
    } else {
      // Store the pending selection and wait for code selection
      setPendingSelection({ sourcePath, start, end });
    }
  }

  function handleSelectionCreate(start: number, end: number) {
    const path = selectedFilePath();
    if (path) {
      handleSelectionCreateForSource(path, start, end);
    }
  }

  function handleSelectionRemoveForSource(sourcePath: string, selectionGuid: string) {
    const currentSelections = store.sources[sourcePath]?.selections || [];
    const sel = currentSelections.find(s => s.guid === selectionGuid);
    if (sel) {
      // Remove from examples if it was marked as one
      actions.removeExample(sourcePath, selectionGuid, sel.code.codebookGuid, sel.code.codeGuid);
    }
    actions.updateSourceSelections(sourcePath, currentSelections.filter(s => s.guid !== selectionGuid));
  }

  function handleSelectionRemove(selectionGuid: string) {
    const path = selectedFilePath();
    if (path) {
      handleSelectionRemoveForSource(path, selectionGuid);
    }
  }

  function handleSelectionUpdateForSource(sourcePath: string, selectionGuid: string, start: number, end: number, note?: string) {
    const currentSelections = store.sources[sourcePath]?.selections || [];
    actions.updateSourceSelections(
      sourcePath,
      currentSelections.map(s => 
        s.guid === selectionGuid 
          ? { ...s, start, end, note }
          : s
      )
    );
  }

  function handleSelectionUpdate(selectionGuid: string, start: number, end: number, note?: string) {
    const path = selectedFilePath();
    if (path) {
      handleSelectionUpdateForSource(path, selectionGuid, start, end, note);
    }
  }

  function handleSelectionClear() {
    setPendingSelection(null);
  }

  function handleToggleExampleForSource(sourcePath: string, selectionGuid: string) {
    const source = store.sources[sourcePath];
    if (!source) return;
    const sel = source.selections.find(s => s.guid === selectionGuid);
    if (!sel) return;
    actions.toggleExample(sourcePath, selectionGuid, sel.code.codebookGuid, sel.code.codeGuid);
  }

  function handleToggleExample(selectionGuid: string) {
    const path = selectedFilePath();
    if (path) {
      handleToggleExampleForSource(path, selectionGuid);
    }
  }

  function handleChangeCodeForSource(sourcePath: string, selectionGuid: string, newCode: CodeReference) {
    const currentSelections = store.sources[sourcePath]?.selections || [];
    actions.updateSourceSelections(
      sourcePath,
      currentSelections.map(s =>
        s.guid === selectionGuid
          ? { ...s, code: newCode }
          : s
      )
    );
  }

  function handleChangeCode(selectionGuid: string, newCode: CodeReference) {
    const path = selectedFilePath();
    if (path) {
      handleChangeCodeForSource(path, selectionGuid, newCode);
    }
  }

  function handleFileSelect(info: { file: FileSystemFileHandle; directory: FileSystemDirectoryHandle; relativePath: string }) {
    const path = info.relativePath;
    
    // Save scroll position before switching
    saveCurrentScrollPosition();
    
    // If tab already exists, just switch to it
    if (openTabs().includes(path)) {
      navigate(`/${encodeURIComponent(path)}`);
      return;
    }
    
    // Add new tab next to current tab
    const currentTabs = openTabs();
    const currentPath = selectedFilePath();
    const currentIndex = currentTabs.indexOf(currentPath);
    
    if (currentIndex >= 0) {
      const newTabs = [...currentTabs];
      newTabs.splice(currentIndex + 1, 0, path);
      setOpenTabs(newTabs);
    } else {
      setOpenTabs([...currentTabs, path]);
    }
    
    navigate(`/${encodeURIComponent(path)}`);
  }
  
  function handleTabClick(path: string) {
    if (path !== selectedFilePath()) {
      saveCurrentScrollPosition();
      navigate(`/${encodeURIComponent(path)}`);
    }
  }
  
  function handleTabClose(e: MouseEvent, path: string) {
    e.stopPropagation();
    const currentTabs = openTabs();
    const tabIndex = currentTabs.indexOf(path);
    const newTabs = currentTabs.filter(t => t !== path);
    setOpenTabs(newTabs);
    
    // If closing the active tab, switch to an adjacent tab
    if (path === selectedFilePath()) {
      if (newTabs.length === 0) {
        navigate('/');
      } else {
        // Prefer the tab to the right, or the last tab if we closed the rightmost
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        navigate(`/${encodeURIComponent(newTabs[newIndex])}`);
      }
    }
    
    // Clean up scroll position for closed tab
    scrollPositions.delete(path);
  }
  
  function handleCloseAllTabs() {
    setOpenTabs([]);
    scrollPositions.clear();
    navigate('/');
  }

  return (
    <>
      <Resizable orientation="horizontal">
        <Resizable.Panel initialSize={0.2} minSize={0.1} maxSize={0.5}>
          <FileBrowser 
            directoryHandle={store.dirHandle!} 
            onFileSelect={handleFileSelect}
            onFileCreated={(path) => navigate(`/${encodeURIComponent(path)}`)}
            selectedFile={selectedFilePath()}
            filter={{ extensions: [".mcs"], mode: "exclude" }}
          />
        </Resizable.Panel>
        <Resizable.Handle aria-label="Resize file browser and editor">
          <div class="inner-handle" />
        </Resizable.Handle>
        <Resizable.Panel initialSize={0.6} minSize={0.1} maxSize={0.9}>
          <div class={styles.editorPane} data-editor-pane>
            {/* Tab bar */}
            <Show when={openTabs().length > 0}>
              <div class={styles.tabBar}>
                <div class={styles.tabs}>
                  <For each={openTabs()}>
                    {(path) => (
                      <div
                        class={`${styles.tab} ${path === selectedFilePath() ? styles.activeTab : ''}`}
                        onClick={() => handleTabClick(path)}
                        title={path}
                      >
                        <span class={styles.tabName}>{tabDisplayNames().get(path)}</span>
                        <button
                          class={styles.tabCloseButton}
                          onClick={(e) => handleTabClose(e, path)}
                          title="Close tab"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
                <button class={styles.closeAllButton} onClick={handleCloseAllTabs} title="Close all tabs">
                  Close All
                </button>
              </div>
            </Show>
            
            {/* File path bar */}
            <Show when={selectedFilePath()}>
              <div class={styles.filePathBar}>
                {selectedFilePath()}
              </div>
            </Show>
            
            {/* Content area - views are layered with absolute positioning.
                Each open query/codebook tab gets its own component instance that stays
                alive (hidden) to preserve scroll position and LazyMatchItem state.
                Text views are conditional since their scroll restore works reliably. */}
            <div class={styles.contentArea}>
              <Show when={!selectedFilePath()}>
                <p style={{ padding: '10px' }}>Select a file to view its contents</p>
              </Show>

              {/* Per-tab codebook editors */}
              <For each={openCodebookTabs()}>
                {(tabPath) => {
                  const guid = () => indices.pathToGuid()[tabPath];
                  return (
                    <Show when={guid()}>
                      <div class={tabPath === selectedFilePath() ? styles.viewActive : styles.viewHidden}>
                        <CodebookEditor codebookGuid={guid()!} />
                      </div>
                    </Show>
                  );
                }}
              </For>

              {/* Per-tab query editors */}
              <For each={openQueryTabs()}>
                {(tabPath) => {
                  const guid = () => indices.pathToGuid()[tabPath];
                  return (
                    <Show when={guid()}>
                      <div class={tabPath === selectedFilePath() ? styles.viewActive : styles.viewHidden}>
                        <QueryEditor
                          queryGuid={guid()!}
                          onSelectionCreate={handleSelectionCreateForSource}
                          onSelectionRemove={handleSelectionRemoveForSource}
                          onSelectionUpdate={(sourcePath, selectionGuid, start, end, note) =>
                            handleSelectionUpdateForSource(sourcePath, selectionGuid, start, end, note)
                          }
                          onToggleExample={handleToggleExampleForSource}
                          onChangeCode={handleChangeCodeForSource}
                          onSelectionClear={handleSelectionClear}
                          selectedCode={selectedCode()}
                        />
                      </div>
                    </Show>
                  );
                }}
              </For>

              {/* Text view - conditional rendering (scroll restore works reliably) */}
              <Show when={selectedFilePath() && !isSpecialFile()}>
                <div class={styles.textViewWrapper} ref={textViewWrapperRef}>
                  <Show when={nonPlainTextWarning()}>
                    <div class={styles.hashMismatchWarning}>
                      This file does not appear to be a plain text file. Minicoder only supports coding in plain text files.
                    </div>
                  </Show>
                  <Show when={!nonPlainTextWarning()}>
                    <Show when={hashMismatchWarning()}>
                      <div class={styles.hashMismatchWarning}>
                        ⚠️ Warning: The file content has changed since these selections were saved. Positions may be incorrect.
                        <button onClick={() => setHashMismatchWarning(false)}>Dismiss</button>
                      </div>
                    </Show>
                    <Show when={fileContent()}>
                      {(content) => (
                        <TextView
                          content={content()}
                          selections={selections()}
                          onSelectionCreate={handleSelectionCreate}
                          onSelectionRemove={handleSelectionRemove}
                          onSelectionUpdate={handleSelectionUpdate}
                          onToggleExample={handleToggleExample}
                          onChangeCode={handleChangeCode}
                          onSelectionClear={handleSelectionClear}
                          selectedCode={selectedCode()}
                        />
                      )}
                    </Show>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </Resizable.Panel>
        <Resizable.Handle aria-label="Resize editor and code picker">
          <div class="inner-handle" />
        </Resizable.Handle>
        <Resizable.Panel initialSize={0.2} minSize={0.1} maxSize={0.5}>
          <div>
            <div class={styles.selectedCodeNotice}>
              <Show when={selectedCode()} fallback={
                <span class={styles.noCodeSelected}>No code selected</span>
              }>
                <span class={styles.selectedCodeInfo}>
                  <ColorChip color={selectedCode()!.code.color} class={styles.selectedCodeColor} />
                  <span>{selectedCode()!.code.name}</span>
                  <span class={styles.selectedCodeCodebook}>({selectedCode()!.codebook.name})</span>
                </span>
                <button onClick={() => setSelectedCode(null)}>×</button>
              </Show>
            </div>
            <CodePicker
              codebooks={codebooksList()}
              onCodeClick={handleCodeClick}
              onInfoClick={(code, codebook) => setInfoModal({ codeGuid: code.guid, codebookGuid: codebook.guid })}
              onEditClick={(codebook) => {
                const path = store.fileLocations[codebook.guid]?.path;
                if (!path) return;
                saveCurrentScrollPosition();
                if (!openTabs().includes(path)) {
                  const currentTabs = openTabs();
                  const currentIndex = currentTabs.indexOf(selectedFilePath());
                  if (currentIndex >= 0) {
                    const newTabs = [...currentTabs];
                    newTabs.splice(currentIndex + 1, 0, path);
                    setOpenTabs(newTabs);
                  } else {
                    setOpenTabs([...currentTabs, path]);
                  }
                }
                navigate(`/${encodeURIComponent(path)}`);
              }}
            />
          </div>
        </Resizable.Panel>
      </Resizable>
     <Show when={infoModal()}>
       {(modal) => (
         <CodeSelectionsModal
           codeGuid={modal().codeGuid}
           codebookGuid={modal().codebookGuid}
           currentFilePath={!isSpecialFile() ? selectedFilePath() : undefined}
           onClose={() => setInfoModal(null)}
         />
       )}
     </Show>
    </>
  );
};

export default CodingView;
