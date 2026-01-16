import { createEffect, createMemo, createSignal, Match, Show, Switch, type Component } from 'solid-js';
import { TopBar, type ViewType } from './components/TopBar';
import CodingView from './views/CodingView';
import CodebookEditorView from './views/CodebookEditorView';
import SelectionsListView from './views/SelectionsListView';

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
  const [currentView, setCurrentView] = createSignal<ViewType>("coding");
  const [codebooks, setCodebooks] = createSignal<Codebook[]>([]);

  const currentDir = createMemo(() => dirHandle()?.name || "");
  createEffect(() => {
    const cd = currentDir()
    if (cd) {
      document.title = "minicoder | " + cd;
    } else {
      document.title = "minicoder"
    }
  });

  // Load all codebooks when directory changes
  async function loadCodebooks() {
    const dir = dirHandle();
    if (!dir) {
      setCodebooks([]);
      return;
    }
    
    try {
      const loadedCodebooks: Codebook[] = [];
      
      // Iterate through directory to find all .mcc files
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file' && name.endsWith('.mcc')) {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            const text = await file.text();
            const parsedCodebook = JSON.parse(text) as Codebook;
            loadedCodebooks.push(parsedCodebook);
          } catch (err) {
            console.warn(`Failed to load codebook ${name}:`, err);
          }
        }
      }
      
      // Sort by name for consistent ordering
      loadedCodebooks.sort((a, b) => a.name.localeCompare(b.name));
      setCodebooks(loadedCodebooks);
    } catch (err) {
      console.warn("Failed to load codebooks:", err);
      setCodebooks([]);
    }
  }
  
  // Load codebooks when directory changes
  createEffect(() => {
    dirHandle();
    loadCodebooks();
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

  return (
    <>
      <TopBar 
        currentDir={currentDir()} 
        onChangeDir={pickFolder} 
        currentView={currentView()}
        onViewChange={setCurrentView}
      />
      <Show when={dirHandle()} fallback={<p style="text-align: center">Open a folder to get started.</p>}>
        <Switch>
          <Match when={currentView() === "coding"}>
            <CodingView dirHandle={dirHandle()!} codebooks={codebooks()} />
          </Match>
          <Match when={currentView() === "codebooks"}>
            <CodebookEditorView 
              dirHandle={dirHandle()!} 
              codebooks={codebooks()} 
              onCodebooksChange={loadCodebooks}
            />
          </Match>
          <Match when={currentView() === "selections"}>
            <SelectionsListView dirHandle={dirHandle()!} codebooks={codebooks()} />
          </Match>
        </Switch>
      </Show>
    </>
  );
};

export default App;
