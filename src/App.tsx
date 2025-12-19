import { createEffect, createMemo, createResource, createSignal, Show, type Component } from 'solid-js';
import FileBrowser from './FileBrowser';
import CodePicker from './CodePicker';

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
  const [selectedFile, setSelectedFile] = createSignal<FileSystemFileHandle>()
  
  // Load codebook when directory changes
  createEffect(async () => {
    const dir = dirHandle();
    if (!dir) {
      setCodebook({ name: "Codebook", codes: [] });
      return;
    }
    
    try {
      const codebookFile = await dir.getFileHandle("codebook.json");
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

  function applyCode() {

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
              <FileBrowser directoryHandle={dirHandle()!} onFileSelect={setSelectedFile} fileExtensionFilter={[ ".txt" ]} />
            </div>
          </div>
          <div id="textDisplay">
            <Show when={selectedFile()} fallback={<p>Select a file to view its contents</p>}>
              {fileContent()}
            </Show>
          </div>
          <div id="codesList">
            <CodePicker codes={codebook().codes} onCodeClick={applyCode} />
          </div>
        </div>
      </Show>
    </>
  );
};

export default App;
