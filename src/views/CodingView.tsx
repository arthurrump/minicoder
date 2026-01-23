import { createEffect, createMemo, createResource, createSignal, on, Show, type Component } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import Resizable from '@corvu/resizable';
import FileBrowser from '../components/FileBrowser';
import CodePicker from '../components/CodePicker';
import TextView from '../components/TextView';
import { hashText } from '../helpers';
import { useStore } from '../store';
import styles from './CodingView.module.css';

const CodingView: Component = () => {
  const { store, actions } = useStore();
  const params = useParams<{ filePath?: string }>();
  const navigate = useNavigate();
  
  // Get file path from URL params, decoding it
  const selectedFilePath = createMemo(() => {
    return params.filePath ? decodeURIComponent(params.filePath) : '';
  });
  const [selectedCode, setSelectedCode] = createSignal<Code | null>(null);
  const [selectedCodebook, setSelectedCodebook] = createSignal<Codebook | null>(null);
  const [pendingSelection, setPendingSelection] = createSignal<{ start: number; end: number } | null>(null);
  const [hashMismatchWarning, setHashMismatchWarning] = createSignal<boolean>(false);
  const [mousePosition, setMousePosition] = createSignal<{ x: number; y: number } | null>(null);
  const [isMouseInTextView, setIsMouseInTextView] = createSignal<boolean>(false);

  // Load file content when selectedFilePath changes (using resource pattern)
  const [fileContent] = createResource(selectedFilePath, async (path) => {
    if (!path) return undefined;
    return await actions.loadFileContent(path);
  });

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
    // Navigate to the file URL
    navigate(`/coding/${encodeURIComponent(info.relativePath)}`);
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
          <Show when={selectedFilePath()} fallback={<p style={{ padding: '10px' }}>Select a file to view its contents</p>}>
            <div class="text-view-wrapper">
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
            </div>
          </Show>
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
                  <span class={styles.selectedCodeColor} style={{ "background-color": selectedCode()!.color }}></span>
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
        <span 
          class={styles.cursorChip}
          style={{
            left: `${mousePosition()!.x - 16}px`,
            top: `${mousePosition()!.y}px`,
            "background-color": selectedCode()!.color
          }}
        />
      </Show>
    </>
  );
};

export default CodingView;
