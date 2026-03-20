import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Component } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import Resizable from '@corvu/resizable';
import FileBrowser from '../components/FileBrowser';
import CodePicker from '../components/CodePicker';
import TextView from '../components/TextView';
import ColorChip from '../components/ColorChip';
import CodebookEditor from '../components/CodebookEditor';
import QueryEditor from '../components/QueryEditor';
import SourceCodesBar from '../components/SourceCodesBar';
import CodeSelectionsModal from '../components/CodeSelectionsModal';
import Dashboard from '../components/Dashboard';
import { useStore } from '../store';
import { useSettings } from '../settings';
import { disambiguatePaths } from '../utils/paths';
import { scrollToCharOffset } from '../utils/textLayout';
import type { Code, Codebook, TextSelection } from '../models/files';
import styles from './CodingView.module.css';

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
  const codebooksList = indices.sortedCodebooks;

  
  // Tab management
  const [openTabs, setOpenTabs] = createSignal<string[]>([]);
  
  // Compute display names for tabs with disambiguation
  const tabDisplayNames = createMemo(() => disambiguatePaths(openTabs()));
  
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
  
  const [selectedCode, setSelectedCode] = createSignal<{ code: Code, codebook: Codebook } | null>(null);
  const [infoModal, setInfoModal] = createSignal<{ codeGuid: string; codebookGuid: string; sourceFilter?: string[]; includeSubcodes?: boolean } | null>(null);
  const [pendingSelection, setPendingSelection] = createSignal<{ sourcePath: string; start: number; end: number } | null>(null);
  const [pendingScrollOffset, setPendingScrollOffset] = createSignal<number | null>(null);
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

  // Escape key deselects the active code
  const onEscapeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && selectedCode()) {
      setSelectedCode(null);
    }
  };
  document.addEventListener('keydown', onEscapeKey);
  onCleanup(() => document.removeEventListener('keydown', onEscapeKey));

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

  // Restore scroll position when file content loads or path changes (text files only)
  createEffect(on([() => fileContent(), selectedFilePath], () => {
    const path = selectedFilePath();
    const wrapper = textViewWrapperRef;
    if (path && wrapper) {
      const charOffset = pendingScrollOffset();
      if (charOffset !== null) {
        const content = fileContent();
        if (!content) return; // Content not loaded yet, wait for next trigger
        setPendingScrollOffset(null);
        // Scroll to the character offset by finding the target line
        requestAnimationFrame(() => {
          scrollToCharOffset(wrapper, content, charOffset);
        });
      } else {
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
          wrapper.scrollTop = scrollPositions.get(path) || 0;
        });
      }
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
  createEffect(on([selectedFilePath, () => fileContent()], ([path, content]) => {
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

  function handleSelectionUpdateForSource(sourcePath: string, selectionGuid: string, start: number, end: number) {
    const currentSelections = store.sources[sourcePath]?.selections || [];
    actions.updateSourceSelections(
      sourcePath,
      currentSelections.map(s => 
        s.guid === selectionGuid 
          ? { ...s, start, end }
          : s
      )
    );
  }

  function handleSelectionUpdate(selectionGuid: string, start: number, end: number) {
    const path = selectedFilePath();
    if (path) {
      handleSelectionUpdateForSource(path, selectionGuid, start, end);
    }
  }

  function handleSelectionClear() {
    setPendingSelection(null);
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

  function handleOpenSource(sourcePath: string, charOffset: number) {
    // Don't open special files (codebook/query) - they don't have text to scroll to
    if (sourcePath.endsWith('.mcc') || sourcePath.endsWith('.mcq')) return;

    saveCurrentScrollPosition();

    // Add tab if not already open
    if (!openTabs().includes(sourcePath)) {
      const currentTabs = openTabs();
      const currentIndex = currentTabs.indexOf(selectedFilePath());
      if (currentIndex >= 0) {
        const newTabs = [...currentTabs];
        newTabs.splice(currentIndex + 1, 0, sourcePath);
        setOpenTabs(newTabs);
      } else {
        setOpenTabs([...currentTabs, sourcePath]);
      }
    }

    // If the file is already selected and content loaded, scroll immediately
    const fc = store.fileContents[sourcePath];
    const content = fc?.type === 'plain-text' ? fc.content : undefined;
    const wrapper = textViewWrapperRef;
    if (sourcePath === selectedFilePath() && content && wrapper) {
      requestAnimationFrame(() => {
        scrollToCharOffset(wrapper, content, charOffset);
      });
      return;
    }

    // Set the pending scroll offset so scroll restore uses it
    setPendingScrollOffset(charOffset);
    navigate(`/${encodeURIComponent(sourcePath)}`);
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
              <div class={styles.tabBar}>
                <div class={styles.tabs}>
                  <div
                    class={`${styles.tab} ${!selectedFilePath() ? styles.activeTab : ''}`}
                    onClick={() => { saveCurrentScrollPosition(); navigate('/'); }}
                    title="Dashboard"
                  >
                    <span class={styles.tabName}>Dashboard</span>
                  </div>
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
                <Show when={openTabs().length > 0}>
                  <button class={styles.closeAllButton} onClick={handleCloseAllTabs} title="Close all tabs">
                    Close All
                  </button>
                </Show>
              </div>
            
            {/* File path bar */}
            <Show when={selectedFilePath()}>
              <div class={styles.filePathBar}>
                {selectedFilePath()}
              </div>
            </Show>

            {/* Source codes bar for source files */}
            <Show when={selectedFilePath() && !isSpecialFile()}>
                <SourceCodesBar sourcePath={selectedFilePath()} />
            </Show>
            
            {/* Content area - views are layered with absolute positioning.
                Each open query/codebook tab gets its own component instance that stays
                alive (hidden) to preserve scroll position and LazyMatchItem state.
                Text views are conditional since their scroll restore works reliably. */}
            <div class={styles.contentArea}>
              <Show when={!selectedFilePath()}>
                <Dashboard
                  onCodeClick={(codeGuid, codebookGuid) => setInfoModal({ codeGuid, codebookGuid })}
                  onCellClick={(codeGuid, codebookGuid, sourcePaths, includeSubcodes) => setInfoModal({ codeGuid, codebookGuid, sourceFilter: sourcePaths, includeSubcodes })}
                  onSourceClick={(sourcePath) => {
                    saveCurrentScrollPosition();
                    if (!openTabs().includes(sourcePath)) {
                      setOpenTabs([...openTabs(), sourcePath]);
                    }
                    navigate(`/${encodeURIComponent(sourcePath)}`);
                  }}
                />
              </Show>

              {/* Per-tab codebook editors */}
              <For each={openCodebookTabs()}>
                {(tabPath) => {
                  const guid = () => indices.pathToGuid()[tabPath];
                  return (
                    <Show when={guid()}>
                      <div class={tabPath === selectedFilePath() ? styles.viewActive : styles.viewHidden}>
                        <CodebookEditor codebookGuid={guid()} />
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
                          queryGuid={guid()}
                          onOpenSource={handleOpenSource}
                          onSelectionCreate={handleSelectionCreateForSource}
                          onSelectionUpdate={handleSelectionUpdateForSource}
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
                    <Show when={fileContent()} fallback={
                      <div class="view-placeholder">
                        <div class="loading-spinner" />
                        <p>Loading file...</p>
                      </div>
                    }>
                      {(content) => (
                        <TextView
                          content={content()}
                          selections={selections()}
                          sourcePath={selectedFilePath()}
                          onSelectionCreate={handleSelectionCreate}
                          onSelectionUpdate={handleSelectionUpdate}
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
                  <ColorChip color={selectedCode()!.code.color} />
                  <span>{selectedCode()!.code.name}</span>
                  <span>({selectedCode()!.codebook.name})</span>
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
           sourceFilter={modal().sourceFilter}
           includeSubcodes={modal().includeSubcodes}
           onClose={() => setInfoModal(null)}
           onOpenSource={handleOpenSource}
         />
       )}
     </Show>
    </>
  );
};

export default CodingView;
