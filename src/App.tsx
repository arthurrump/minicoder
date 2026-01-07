import { createEffect, createMemo, createResource, createSignal, Show, type Component } from 'solid-js';
import FileBrowser from './FileBrowser';
import CodePicker from './CodePicker';
import TextView from './TextView';

const App: Component = () => {
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

  const [codebook, setCodebook] = createSignal<Codebook>({ name: "Codebook", codes: [] });
  const [selectedFile, setSelectedFile] = createSignal<FileSystemFileHandle>();
  const [selections, setSelections] = createSignal<TextSelection[]>([]);
  const [selectedCode, setSelectedCode] = createSignal<Code | null>(null);
  const [pendingSelection, setPendingSelection] = createSignal<{ start: number; end: number } | null>(null);
  
  // Load codebook when directory changes
  createEffect(async () => {
    const dir = dirHandle();
    if (!dir) {
      setCodebook({ name: "Codebook", codes: [] });
      return;
    }
    
    try {
      const codebookFile = await dir.getFileHandle("codebook.mcc");
      const file = await codebookFile.getFile();
      const text = await file.text();
      const parsedCodebook = JSON.parse(text) as Codebook;
      setCodebook(parsedCodebook);
    } catch (err) {
      console.warn("No codebook.json found or failed to load:", err);
      setCodebook({ name: "Codebook", codes: [] });
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

  function handleCodeClick(code: Code) {
    const pending = pendingSelection();
    if (pending) {
      // We have a pending text selection, apply this code to it
      const newSelection: TextSelection = {
        guid: crypto.randomUUID(),
        start: pending.start,
        end: pending.end,
        text: fileContent()?.slice(pending.start, pending.end) || '',
        code_guid: code.guid
      };
      setSelections(prev => [...prev, newSelection]);
      setPendingSelection(null);
      setSelectedCode(null);
      // Clear the browser's text selection now that the code is applied
      window.getSelection()?.removeAllRanges();
    } else {
      // Just select this code for future use
      setSelectedCode(code);
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
        text: fileContent()?.slice(start, end) || '',
        code_guid: code.guid
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

  function handleSelectionUpdate(selectionGuid: string, start: number, end: number) {
    setSelections(prev => prev.map(s => 
      s.guid === selectionGuid 
        ? { ...s, start, end, text: fileContent()?.slice(start, end) || '' }
        : s
    ));
  }

  function handleSelectionClear() {
    setPendingSelection(null);
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
          <div id="sidebar">
            <div id="fileTree">
              <FileBrowser directoryHandle={dirHandle()!} onFileSelect={setSelectedFile} fileExtensionFilter={{ extensions: [".mcs", ".mcc"], mode: "exclude" }} />
            </div>
          </div>
          <Show when={selectedFile()} fallback={<p>Select a file to view its contents</p>}>
            <Show when={fileContent()}>
              {(content) => (
                              <TextView
                  content={content()}
                  selections={selections()}
                  codes={codebook().codes}
                  onSelectionCreate={handleSelectionCreate}
                  onSelectionRemove={handleSelectionRemove}
                  onSelectionUpdate={handleSelectionUpdate}
                  onSelectionClear={handleSelectionClear}
                />
              )}
            </Show>
          </Show>
          <div id="codesList">
            <div class="selected-code-notice">
              <Show when={selectedCode()} fallback={
                <span class="no-code-selected">No code selected</span>
              }>
                <span class="selected-code-info">
                  <span class="selected-code-color" style={{ "background-color": selectedCode()!.color }}></span>
                  <span>{selectedCode()!.name}</span>
                </span>
                <button onClick={() => setSelectedCode(null)}>×</button>
              </Show>
            </div>
            <CodePicker codes={codebook().codes} onCodeClick={handleCodeClick} />
          </div>
        </div>
      </Show>
    </>
  );
};

export default App;
