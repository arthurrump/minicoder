import { createEffect, createMemo, Show, type Component, type ParentComponent } from 'solid-js';
import { HashRouter, Route } from '@solidjs/router';
import { TopBar } from './components/TopBar';
import CodingView from './views/CodingView';
import { StoreProvider, useStore } from './store';
import { SettingsProvider } from './settings';
import { NotificationsProvider, useNotifications } from './notifications';

function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

const Layout: ParentComponent = (props) => {
  const { store, actions } = useStore();
  const { notify } = useNotifications();

  // Wire store errors to the notification system
  actions.setErrorHandler((message) => notify('error', message));

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
    } catch (err: any) {
      // User cancelled — not an error
      if (err?.name === 'AbortError') return;
      notify('error', `Failed to open folder: ${err?.message || err}`);
      console.error("Failed to pick directory:", err);
    }
  }

  return (
    <>
      <TopBar 
        currentDir={currentDir()} 
        onChangeDir={pickFolder} 
      />
      <Show when={store.isLoading}>
        <div class="loading-overlay">
          <div class="loading-spinner" />
          <p>Loading directory...</p>
        </div>
      </Show>
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
    <SettingsProvider>
      <StoreProvider>
        <NotificationsProvider>
          <HashRouter root={Layout}>
            <Route path="/*filePath" component={CodingView} />
          </HashRouter>
        </NotificationsProvider>
      </StoreProvider>
    </SettingsProvider>
  );
};

export default App;
