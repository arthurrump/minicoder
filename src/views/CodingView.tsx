import { createEffect, createMemo, createResource, createSignal, For, on, Show, type Component } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import Resizable from '@corvu/resizable';
import FileBrowser from '../components/FileBrowser';
import CodePicker from '../components/CodePicker';
import TextView from '../components/TextView';
import ColorChip from '../components/ColorChip';
import { hashText, isPlainText } from '../helpers';
import { useStore } from '../store';
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
  const { store, actions } = useStore();
  const params = useParams<{ filePath?: string }>();
  const navigate = useNavigate();
  
  // Get file path from URL params, decoding it
  const selectedFilePath = createMemo(() => {
    return params.filePath ? decodeURIComponent(params.filePath) : '';
  });
  
  // Tab management
  const [openTabs, setOpenTabs] = createSignal<string[]>([]);
  
  // Compute display names for tabs with disambiguation
  const tabDisplayNames = createMemo(() => getTabDisplayNames(openTabs()));
  
  // Store scroll positions per tab
  const scrollPositions = new Map<string, number>();
  let textViewWrapperRef: HTMLDivElement | undefined;
  
  const [selectedCode, setSelectedCode] = createSignal<Code | null>(null);
  const [selectedCodebook, setSelectedCodebook] = createSignal<Codebook | null>(null);
  const [pendingSelection, setPendingSelection] = createSignal<{ start: number; end: number } | null>(null);
  const [hashMismatchWarning, setHashMismatchWarning] = createSignal<boolean>(false);
  const [nonPlainTextWarning, setNonPlainTextWarning] = createSignal<boolean>(false);
  const [mousePosition, setMousePosition] = createSignal<{ x: number; y: number } | null>(null);
  const [isMouseInTextView, setIsMouseInTextView] = createSignal<boolean>(false);
  
  // Track the previous file path to save scroll position when switching
  let previousFilePath: string | undefined;

  // Clear pending selection and manage scroll positions when switching tabs
  createEffect(on(selectedFilePath, (newPath) => {
    // Save scroll position for the previous tab
    if (previousFilePath && textViewWrapperRef) {
      scrollPositions.set(previousFilePath, textViewWrapperRef.scrollTop);
    }
    
    previousFilePath = newPath;
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

  // Load file content when selectedFilePath changes (using resource pattern)
  const [fileContent] = createResource(selectedFilePath, async (path) => {
    if (!path) return undefined;
    return await actions.loadFileContent(path);
  });

  // Restore scroll position when file content loads
  createEffect(on(() => fileContent(), () => {
    const path = selectedFilePath();
    if (path && textViewWrapperRef) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const savedPosition = scrollPositions.get(path) || 0;
        if (textViewWrapperRef) {
          textViewWrapperRef.scrollTop = savedPosition;
        }
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
      setNonPlainTextWarning(false);
      return;
    }

    // Check if file is plain text
    setNonPlainTextWarning(!isPlainText(content));

    const source = store.sources[path];
    if (!source) {
      setHashMismatchWarning(false);
      return;
    }

    // Check hash
    const currentHash = await hashText(content);
    if (source.fileHash !== currentHash) {
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
        code_guid: code.guid,
        note: undefined
      };
      
      const path = selectedFilePath();
      if (path) {
        const currentSelections = selections();
        actions.updateSelections(path, [...currentSelections, newSelection]);
      }
      
      setPendingSelection(null);
      setSelectedCode(null);
      setSelectedCodebook(null);
      // Clear the browser's text selection now that the code is applied
      window.getSelection()?.removeAllRanges();
    } else {
      // Just select this code for future use
      setSelectedCode(code);
      setSelectedCodebook(codebook);
    }
  }

  function handleSelectionCreate(start: number, end: number) {
    const code = selectedCode();
    if (code) {
      // If a code is already selected, apply it immediately
      const newSelection: TextSelection = {
        guid: crypto.randomUUID(),
        start,
        end,
        code_guid: code.guid,
        note: undefined
      };
      
      const path = selectedFilePath();
      if (path) {
        const currentSelections = selections();
        actions.updateSelections(path, [...currentSelections, newSelection]);
      }
    } else {
      // Store the pending selection and wait for code selection
      setPendingSelection({ start, end });
    }
  }

  function handleSelectionRemove(selectionGuid: string) {
    const path = selectedFilePath();
    if (path) {
      const currentSelections = selections();
      actions.updateSelections(path, currentSelections.filter(s => s.guid !== selectionGuid));
    }
  }

  function handleSelectionUpdate(selectionGuid: string, start: number, end: number, note?: string) {
    const path = selectedFilePath();
    if (path) {
      const currentSelections = selections();
      actions.updateSelections(
        path,
        currentSelections.map(s => 
          s.guid === selectionGuid 
            ? { ...s, start, end, note }
            : s
        )
      );
    }
  }

  function handleSelectionClear() {
    setPendingSelection(null);
  }

  function handleMouseMove(e: MouseEvent) {
    if (selectedCode()) {
      setMousePosition({ x: e.clientX, y: e.clientY });
    }
  }
  
  function handleFileSelect(info: { file: FileSystemFileHandle; directory: FileSystemDirectoryHandle; relativePath: string }) {
    const path = info.relativePath;
    
    // If tab already exists, just switch to it
    if (openTabs().includes(path)) {
      navigate(`/coding/${encodeURIComponent(path)}`);
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
    
    navigate(`/coding/${encodeURIComponent(path)}`);
  }
  
  function handleTabClick(path: string) {
    if (path !== selectedFilePath()) {
      navigate(`/coding/${encodeURIComponent(path)}`);
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
        navigate('/coding');
      } else {
        // Prefer the tab to the right, or the last tab if we closed the rightmost
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        navigate(`/coding/${encodeURIComponent(newTabs[newIndex])}`);
      }
    }
    
    // Clean up scroll position for closed tab
    scrollPositions.delete(path);
  }
  
  function handleCloseAllTabs() {
    setOpenTabs([]);
    scrollPositions.clear();
    navigate('/coding');
  }
  
  // Track mouse movement globally when a code is selected
  createEffect(() => {
    const code = selectedCode();
    if (code) {
      document.addEventListener('mousemove', handleMouseMove);
      return () => document.removeEventListener('mousemove', handleMouseMove);
    } else {
      setMousePosition(null);
    }
  });

  return (
    <>
      <Resizable orientation="horizontal">
        <Resizable.Panel initialSize={0.2} minSize={0.1} maxSize={0.5}>
          <FileBrowser 
            directoryHandle={store.dirHandle!} 
            onFileSelect={handleFileSelect}
            selectedFile={selectedFilePath()}
            filter={{ extensions: [".mcs", ".mcc"], mode: "exclude" }}
          />
        </Resizable.Panel>
        <Resizable.Handle aria-label="Resize file browser and editor">
          <div class="inner-handle" />
        </Resizable.Handle>
        <Resizable.Panel initialSize={0.6} minSize={0.1} maxSize={0.8}>
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
            
            {/* Content area */}
            <Show when={selectedFilePath()} fallback={<p style={{ padding: '10px' }}>Select a file to view its contents</p>}>
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
                        codebooks={store.codebooks}
                        onSelectionCreate={handleSelectionCreate}
                        onSelectionRemove={handleSelectionRemove}
                        onSelectionUpdate={handleSelectionUpdate}
                        onSelectionClear={handleSelectionClear}
                        onMouseEnter={() => setIsMouseInTextView(true)}
                        onMouseLeave={() => setIsMouseInTextView(false)}
                      />
                    )}
                  </Show>
                </Show>
              </div>
            </Show>
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
                  <ColorChip color={selectedCode()!.color} class={styles.selectedCodeColor} />
                  <span>{selectedCode()!.name}</span>
                  <Show when={selectedCodebook()}>
                    <span class={styles.selectedCodeCodebook}>({selectedCodebook()!.name})</span>
                  </Show>
                </span>
                <button onClick={() => { setSelectedCode(null); setSelectedCodebook(null); }}>×</button>
              </Show>
            </div>
            <CodePicker codebooks={store.codebooks} onCodeClick={handleCodeClick} />
          </div>
        </Resizable.Panel>
      </Resizable>
     <Show when={selectedCode() && mousePosition() && isMouseInTextView()}>
       <div
         class={styles.cursorChip}
         style={{
           left: `${mousePosition()!.x - 16}px`,
           top: `${mousePosition()!.y}px`
         }}
       >
         <ColorChip color={selectedCode()!.color} class={styles.cursorChipInner} />
       </div>
     </Show>
    </>
  );
};

export default CodingView;
