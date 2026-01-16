import { createEffect, createMemo, Show, type Component, type ParentComponent } from 'solid-js';
import { HashRouter, Route, useNavigate, useLocation } from '@solidjs/router';
import { TopBar } from './components/TopBar';
import CodingView from './views/CodingView';
import CodebookEditorView from './views/CodebookEditorView';
import SelectionsListView from './views/SelectionsListView';
import { StoreProvider, useStore } from './store';

function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

type ViewType = "coding" | "codebooks" | "selections";
const views : { id: ViewType; label: string }[] = [
  { id: "codebooks", label: "Codebooks" },
  { id: "coding", label: "Coding" },
  { id: "selections", label: "Selections" },
];

const Layout: ParentComponent = (props) => {
  const { store, actions } = useStore();
  const navigate = useNavigate();
  const location = useLocation();

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

  // Determine current view from location
  const currentView = createMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/coding')) return 'coding';
    if (path.startsWith('/codebooks')) return 'codebooks';
    if (path.startsWith('/selections')) return 'selections';
    return 'coding';
  });

  const handleViewChange = (view: ViewType) => {
    navigate(`/${view}`);
  };

  return (
    <>
      <TopBar 
        currentDir={currentDir()} 
        onChangeDir={pickFolder} 
        currentView={currentView()}
        onViewChange={handleViewChange}
        views={views}
      />
      <Show when={store.dirHandle} fallback={<p style="text-align: center">Open a folder to get started.</p>}>
        {props.children}
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
      <HashRouter root={Layout}>
        <Route path="/" component={CodingView} />
        <Route path="/coding" component={CodingView} />
        <Route path="/coding/*filePath" component={CodingView} />
        <Route path="/codebooks" component={CodebookEditorView} />
        <Route path="/selections" component={SelectionsListView} />
      </HashRouter>
    </StoreProvider>
  );
};

export default App;
