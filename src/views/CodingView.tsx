import { createEffect, createMemo, createResource, createSignal, on, Show, type Component } from 'solid-js';
import Resizable from '@corvu/resizable';
import FileBrowser from '../components/FileBrowser';
import CodePicker from '../components/CodePicker';
import TextView from '../components/TextView';
import { hashText, debounce } from '../helpers';

interface CodingViewProps {
  dirHandle: FileSystemDirectoryHandle;
  codebooks: Codebook[];
}

const CodingView: Component<CodingViewProps> = (props) => {
  const [selectedFile, setSelectedFile] = createSignal<FileSystemFileHandle>();
  const [selectedFileDir, setSelectedFileDir] = createSignal<FileSystemDirectoryHandle>();
  const [selectedFilePath, setSelectedFilePath] = createSignal<string>("");
  const [selections, setSelections] = createSignal<TextSelection[]>([]);
  const [selectedCode, setSelectedCode] = createSignal<Code | null>(null);
  const [selectedCodebook, setSelectedCodebook] = createSignal<Codebook | null>(null);
  const [pendingSelection, setPendingSelection] = createSignal<{ start: number; end: number } | null>(null);
  const [hashMismatchWarning, setHashMismatchWarning] = createSignal<boolean>(false);
  const [mousePosition, setMousePosition] = createSignal<{ x: number; y: number } | null>(null);
  const [isMouseInTextView, setIsMouseInTextView] = createSignal<boolean>(false);

  // Load file content when selectedFile changes
  const [fileContent] = createResource(selectedFile, async (file) => {
    if (!file) return undefined;
    try {
      const fileData = await file.getFile();
      return await fileData.text();
    } catch (err) {
      console.error("Failed to read file:", err);
      return undefined;
    }
  });

  // Load selections from .mcs file when file changes
  createEffect(on([selectedFile, () => fileContent()], async ([file, content]) => {
    if (!file || !content) {
      setSelections([]);
      setHashMismatchWarning(false);
      return;
    }

    const fileDir = selectedFileDir();
    const filePath = selectedFilePath();
    if (!fileDir || !filePath) return;

    const mcsFileName = file.name + '.mcs';
    try {
      const mcsFile = await fileDir.getFileHandle(mcsFileName);
      const mcsData = await mcsFile.getFile();
      const mcsText = await mcsData.text();
      const source = JSON.parse(mcsText) as Source;
      
      // Check hash
      const currentHash = await hashText(content);
      if (source.fileHash !== currentHash) {
        setHashMismatchWarning(true);
        console.warn("File content has changed since selections were saved");
      } else {
        setHashMismatchWarning(false);
      }
      
      setSelections(source.selections);
    } catch (err) {
      // No .mcs file exists
      setSelections([]);
      setHashMismatchWarning(false);
    }
  }));

  // Save selections to .mcs file
  async function saveSelections() {
    const file = selectedFile();
    const content = fileContent();
    const fileDir = selectedFileDir();
    const filePath = selectedFilePath();
    
    if (!file || !content || !fileDir || !filePath) return;
    
    const currentSelections = selections();
    const fileHash = await hashText(content);
    
    const source: Source = {
      fileHash,
      selections: currentSelections
    };
    
    const mcsFileName = file.name + '.mcs';
    try {
      const mcsFile = await fileDir.getFileHandle(mcsFileName, { create: true });
      const writable = await mcsFile.createWritable();
      await writable.write(JSON.stringify(source, null, 2));
      await writable.close();
    } catch (err) {
      console.error("Failed to save selections:", err);
    }
  }

  // Debounced save function
  const debouncedSave = debounce(saveSelections, 1000);

  // Auto-save when selections change (but not on initial load)
  let isInitialLoad = true;
  createEffect(on(() => selections(), (currentSelections) => {
    if (isInitialLoad) {
      isInitialLoad = false;
      return;
    }
    
    const filePath = selectedFilePath();
    if (!filePath) return;
    
    debouncedSave();
  }, { defer: true }));

  // Reset initial load flag when file changes
  createEffect(on(selectedFile, () => {
    isInitialLoad = true;
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
      setSelections(prev => [...prev, newSelection]);
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
      setSelections(prev => [...prev, newSelection]);
    } else {
      // Store the pending selection and wait for code selection
      setPendingSelection({ start, end });
    }
  }

  function handleSelectionRemove(selectionGuid: string) {
    setSelections(prev => prev.filter(s => s.guid !== selectionGuid));
  }

  function handleSelectionUpdate(selectionGuid: string, start: number, end: number, note?: string) {
    setSelections(prev => prev.map(s => 
      s.guid === selectionGuid 
        ? { ...s, start, end, note }
        : s
    ));
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
    setSelectedFile(info.file);
    setSelectedFileDir(info.directory);
    setSelectedFilePath(info.relativePath);
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
            directoryHandle={props.dirHandle} 
            onFileSelect={handleFileSelect}
            selectedFile={selectedFile()}
            filter={{ extensions: [".mcs", ".mcc"], mode: "exclude" }}
          />
        </Resizable.Panel>
        <Resizable.Handle aria-label="Resize file browser and editor">
          <div class="inner-handle" />
        </Resizable.Handle>
        <Resizable.Panel initialSize={0.6} minSize={0.1} maxSize={0.8}>
          <Show when={selectedFile()} fallback={<p style={{ padding: '10px' }}>Select a file to view its contents</p>}>
            <div class="text-view-wrapper">
              <Show when={hashMismatchWarning()}>
                <div class="hash-mismatch-warning">
                  ⚠️ Warning: The file content has changed since these selections were saved. Positions may be incorrect.
                  <button onClick={() => setHashMismatchWarning(false)}>Dismiss</button>
                </div>
              </Show>
              <Show when={fileContent()}>
                {(content) => (
                  <TextView
                    content={content()}
                    selections={selections()}
                    codebooks={props.codebooks}
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
          <div id="codesList">
            <div class="selected-code-notice">
              <Show when={selectedCode()} fallback={
                <span class="no-code-selected">No code selected</span>
              }>
                <span class="selected-code-info">
                  <span class="selected-code-color" style={{ "background-color": selectedCode()!.color }}></span>
                  <span>{selectedCode()!.name}</span>
                  <Show when={selectedCodebook()}>
                    <span class="selected-code-codebook">({selectedCodebook()!.name})</span>
                  </Show>
                </span>
                <button onClick={() => { setSelectedCode(null); setSelectedCodebook(null); }}>×</button>
              </Show>
            </div>
            <CodePicker codebooks={props.codebooks} onCodeClick={handleCodeClick} />
          </div>
        </Resizable.Panel>
      </Resizable>
      <Show when={selectedCode() && mousePosition() && isMouseInTextView()}>
        <span 
          class="cursor-chip"
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
