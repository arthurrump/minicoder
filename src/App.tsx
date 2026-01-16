import { createEffect, createMemo, createSignal, Match, Show, Switch, type Component } from 'solid-js';
import { TopBar, type ViewType } from './components/TopBar';
import CodingView from './views/CodingView';
import CodebookEditorView from './views/CodebookEditorView';
import SelectionsListView from './views/SelectionsListView';
import { StoreProvider, useStore } from './store';

function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

const AppContent: Component = () => {
  const { store, actions } = useStore();
  const [currentView, setCurrentView] = createSignal<ViewType>("coding");

  const currentDir = createMemo(() => store.dirHandle?.name || "");
  createEffect(() => {
    const cd = currentDir()
    if (cd) {
      document.title = "minicoder | " + cd;
    } else {
      document.title = "minicoder"
    }
  });

  async function pickFolder() {
    try {
      // showDirectoryPicker is only available in Chromium-based browsers
      const handle = await (window as any).showDirectoryPicker();
      await actions.setDirectory(handle);
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
      <Show when={store.dirHandle} fallback={<p style="text-align: center">Open a folder to get started.</p>}>
        <Switch>
          <Match when={currentView() === "coding"}>
            <CodingView />
          </Match>
          <Match when={currentView() === "codebooks"}>
            <CodebookEditorView />
          </Match>
          <Match when={currentView() === "selections"}>
            <SelectionsListView />
          </Match>
        </Switch>
      </Show>
    </>
  );
};

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

  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
};

export default App;
