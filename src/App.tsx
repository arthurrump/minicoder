import { createEffect, createMemo, createResource, createSignal, on, Show, type Component } from 'solid-js';
import FileBrowser from './FileBrowser';
import CodePicker from './CodePicker';
import TextView from './TextView';
import { hashText, debounce } from './helpers';

type SaveStatus = 'saved' | 'pending' | 'none';

function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

const App: Component = () => {
  // Check for File System Access API support
  if (!isFileSystemAccessSupported()) {
    return (
      <div class="unsupported-browser">
        <h1>Browser Not Supported</h1>
        <p>
          minicoder requires the File System Access API, which is not available in your browser.
        </p>
        <p>
          Please use a Chromium-based browser. Check out <a href="https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker#browser_compatibility">MDN</a> for supported browser versions.
        </p>
      </div>
    );
  }

  const [dirHandle, setDirHandle] = createSignal<FileSystemDirectoryHandle>();

  const currentDir = createMemo(() => dirHandle()?.name || "");
  createEffect(() => {
    const cd = currentDir()
    if (cd) {
      document.title = "minicoder | " + cd;
    } else {
      document.title = "minicoder"
    }
  });

  const [codebooks, setCodebooks] = createSignal<Codebook[]>([]);
  const [selectedFile, setSelectedFile] = createSignal<FileSystemFileHandle>();
  const [selectedFileDir, setSelectedFileDir] = createSignal<FileSystemDirectoryHandle>();
  const [selectedFilePath, setSelectedFilePath] = createSignal<string>("");
  const [selections, setSelections] = createSignal<TextSelection[]>([]);
  const [selectedCode, setSelectedCode] = createSignal<Code | null>(null);
  const [selectedCodebook, setSelectedCodebook] = createSignal<Codebook | null>(null);
  const [pendingSelection, setPendingSelection] = createSignal<{ start: number; end: number } | null>(null);
  const [hashMismatchWarning, setHashMismatchWarning] = createSignal<boolean>(false);
  const [fileStatuses, setFileStatuses] = createSignal<Map<string, SaveStatus>>(new Map());
  
  // Load all codebooks when directory changes
  createEffect(async () => {
    const dir = dirHandle();
    if (!dir) {
      setCodebooks([]);
      return;
    }
    
    try {
      const codebooks: Codebook[] = [];
      
      // Iterate through directory to find all .mcc files
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file' && name.endsWith('.mcc')) {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            const text = await file.text();
            const parsedCodebook = JSON.parse(text) as Codebook;
            codebooks.push(parsedCodebook);
          } catch (err) {
            console.warn(`Failed to load codebook ${name}:`, err);
          }
        }
      }
      
      // Sort by name for consistent ordering
      codebooks.sort((a, b) => a.name.localeCompare(b.name));
      setCodebooks(codebooks);
    } catch (err) {
      console.warn("Failed to load codebooks:", err);
      setCodebooks([]);
    }
  });
  
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
      updateFileStatus(filePath, 'saved');
    } catch (err) {
      // No .mcs file exists
      setSelections([]);
      setHashMismatchWarning(false);
      updateFileStatus(filePath, 'none');
    }
  }));

  // Helper to update file status map
  function updateFileStatus(fileName: string, status: SaveStatus) {
    setFileStatuses(prev => {
      const newMap = new Map(prev);
      newMap.set(fileName, status);
      return newMap;
    });
  }

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
      updateFileStatus(filePath, 'saved');
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
    
    updateFileStatus(filePath, 'pending');
    debouncedSave();
  }, { defer: true }));

  // Reset initial load flag when file changes
  createEffect(on(selectedFile, () => {
    isInitialLoad = true;
  }));

  async function pickFolder() {
    try {
      // showDirectoryPicker is only available in Chromium-based browsers
      const handle = await (window as any).showDirectoryPicker();
      setDirHandle(handle);
    } catch (err) {
      // User cancelled or error occurred
      console.error("Failed to pick directory:", err);
    }
  }

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
  
  function handleFileSelect(info: { file: FileSystemFileHandle; directory: FileSystemDirectoryHandle; relativePath: string }) {
    setSelectedFile(info.file);
    setSelectedFileDir(info.directory);
    setSelectedFilePath(info.relativePath);
  }
  
  return (
    <>
      <div id="topbar">
        <h1 class="app-title">minicoder</h1>
        <div class="top-actions">
            <button onClick={pickFolder}>Open Folder</button>
            <span>{currentDir()}</span>
        </div>
      </div>
      <Show when={dirHandle()} fallback={<p>Open a folder to get started.</p>}>
        <div id="main">
          <div class="sidebar">
            <div id="fileTree">
              <FileBrowser 
                directoryHandle={dirHandle()!} 
                onFileSelect={handleFileSelect} 
                fileExtensionFilter={{ extensions: [".mcs", ".mcc"], mode: "exclude" }}
                fileStatuses={fileStatuses()}
              />
            </div>
          </div>
          <Show when={selectedFile()} fallback={<p>Select a file to view its contents</p>}>
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
                    codebooks={codebooks()}
                    onSelectionCreate={handleSelectionCreate}
                    onSelectionRemove={handleSelectionRemove}
                    onSelectionUpdate={handleSelectionUpdate}
                    onSelectionClear={handleSelectionClear}
                  />
                )}
              </Show>
            </div>
          </Show>
          <div id="codesList" class="sidebar">
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
            <CodePicker codebooks={codebooks()} onCodeClick={handleCodeClick} />
          </div>
        </div>
      </Show>
    </>
  );
};

export default App;
