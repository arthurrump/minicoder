import { createContext, useContext, type ParentComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { hashText, debounce } from './helpers';

interface AppStore {
  dirHandle: FileSystemDirectoryHandle | null;
  codebooks: Codebook[];
  queries: Query[];
  sources: Record<string, Source>; // relative path -> Source
  fileContents: Record<string, string>; // relative path -> file content
}

interface StoreActions {
  setDirectory: (dirHandle: FileSystemDirectoryHandle) => Promise<void>;
  loadCodebooks: () => Promise<void>;
  loadQueries: () => Promise<void>;
  loadAllSources: () => Promise<void>;
  loadFileContent: (path: string) => Promise<string | undefined>;
  getFileContent: (path: string) => string | undefined;
  getSource: (path: string) => Source | undefined;
  updateSelections: (path: string, selections: TextSelection[]) => void;
  saveSource: (path: string) => Promise<void>;
  saveCodebook: (codebook: Codebook) => Promise<void>;
  deleteCodebook: (codebookGuid: string) => Promise<void>;
  createCodebook: (name: string) => Promise<Codebook | null>;
  saveQuery: (query: Query) => Promise<void>;
  deleteQuery: (queryGuid: string) => Promise<void>;
  createQuery: (name: string) => Promise<Query | null>;
}

interface StoreContextValue {
  store: AppStore;
  actions: StoreActions;
}

const StoreContext = createContext<StoreContextValue>();

export const StoreProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<AppStore>({
    dirHandle: null,
    codebooks: [],
    queries: [],
    sources: {},
    fileContents: {},
  });

// Helper to recursively find all files with specific extensions
async function findAllFiles(
  dir: FileSystemDirectoryHandle,
  extensions: string[],
  basePath: string = ""
): Promise<{ file: FileSystemFileHandle; path: string; directory: FileSystemDirectoryHandle }[]> {
  const results: { file: FileSystemFileHandle; path: string; directory: FileSystemDirectoryHandle }[] = [];
  
  for await (const [name, handle] of dir.entries()) {
    const fullPath = basePath ? `${basePath}/${name}` : name;
    
    if (handle.kind === 'file' && extensions.some(ext => name.endsWith(ext))) {
      results.push({
        file: handle as FileSystemFileHandle,
        path: fullPath,
        directory: dir,
      });
    } else if (handle.kind === 'directory') {
      const subResults = await findAllFiles(handle as FileSystemDirectoryHandle, extensions, fullPath);
      results.push(...subResults);
    }
  }
  
  return results;
}

// Helper to navigate to a directory by path
async function navigateToDirectory(
  rootDir: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemDirectoryHandle> {
  const pathParts = path.split('/').filter(p => p.length > 0);
  let currentDir = rootDir;
  
  for (const part of pathParts) {
    currentDir = await currentDir.getDirectoryHandle(part);
  }
  
  return currentDir;
}

// Helper to get directory containing a file path
function getDirectoryPath(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/');
}

  // Actions
  const actions: StoreActions = {
    async setDirectory(dirHandle: FileSystemDirectoryHandle) {
      setStore('dirHandle', dirHandle);
      
      // Reset all data
      setStore('codebooks', []);
      setStore('queries', []);
      setStore('sources', {});
      setStore('fileContents', {});
      
      // Eagerly load codebooks, queries, and sources
      await Promise.all([
        actions.loadCodebooks(),
        actions.loadQueries(),
        actions.loadAllSources(),
      ]);
    },

    async loadCodebooks() {
      const dir = store.dirHandle;
      if (!dir) {
        setStore('codebooks', []);
        return;
      }
      
      try {
        const loadedCodebooks: Codebook[] = [];
        
        // Find all .mcc files
        const codebookFiles = await findAllFiles(dir, ['.mcc']);
        
        for (const { file } of codebookFiles) {
          try {
            const fileData = await file.getFile();
            const text = await fileData.text();
            const parsedCodebook = JSON.parse(text) as Codebook;
            loadedCodebooks.push(parsedCodebook);
          } catch (err) {
            console.warn(`Failed to load codebook ${file.name}:`, err);
          }
        }
        
        // Sort by name for consistent ordering
        loadedCodebooks.sort((a, b) => a.name.localeCompare(b.name));
        setStore('codebooks', loadedCodebooks);
      } catch (err) {
        console.warn("Failed to load codebooks:", err);
        setStore('codebooks', []);
      }
    },

    async loadQueries() {
      const dir = store.dirHandle;
      if (!dir) {
        setStore('queries', []);
        return;
      }
      
      try {
        const loadedQueries: Query[] = [];
        
        // Find all .mcq files
        const queryFiles = await findAllFiles(dir, ['.mcq']);
        
        for (const { file } of queryFiles) {
          try {
            const fileData = await file.getFile();
            const text = await fileData.text();
            const parsedQuery = JSON.parse(text) as Query;
            loadedQueries.push(parsedQuery);
          } catch (err) {
            console.warn(`Failed to load query ${file.name}:`, err);
          }
        }
        
        // Sort by name for consistent ordering
        loadedQueries.sort((a, b) => a.name.localeCompare(b.name));
        setStore('queries', loadedQueries);
      } catch (err) {
        console.warn("Failed to load queries:", err);
        setStore('queries', []);
      }
    },

    async loadAllSources() {
      const dir = store.dirHandle;
      if (!dir) {
        setStore('sources', {});
        return;
      }
      
      try {
        // Find all .mcs files
        const mcsFiles = await findAllFiles(dir, ['.mcs']);
        
        const newSources: Record<string, Source> = {};
        
        for (const { file, path } of mcsFiles) {
          try {
            const fileData = await file.getFile();
            const text = await fileData.text();
            const source = JSON.parse(text) as Source;
            
            // Remove .mcs extension to get the source file path
            const sourcePath = path.slice(0, -4);
            newSources[sourcePath] = source;
          } catch (err) {
            console.warn(`Failed to load source ${path}:`, err);
          }
        }
        
        setStore('sources', newSources);
      } catch (err) {
        console.warn("Failed to load sources:", err);
        setStore('sources', {});
      }
    },

    async loadFileContent(path: string): Promise<string | undefined> {
      // Return cached content if available
      if (store.fileContents[path]) {
        return store.fileContents[path];
      }
      
      const dir = store.dirHandle;
      if (!dir) return undefined;
      
      try {
        // Navigate to the directory containing the file
        const dirPath = getDirectoryPath(path);
        const fileName = path.split('/').pop()!;
        
        const fileDir = dirPath ? await navigateToDirectory(dir, dirPath) : dir;
        const fileHandle = await fileDir.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const content = await file.text();
        
        // Cache the content
        setStore('fileContents', path, content);
        
        return content;
      } catch (err) {
        console.error(`Failed to load file content for ${path}:`, err);
        return undefined;
      }
    },

    getFileContent(path: string): string | undefined {
      return store.fileContents[path];
    },

    getSource(path: string): Source | undefined {
      return store.sources[path];
    },

    updateSelections(path: string, selections: TextSelection[]) {
      if (!store.sources[path]) {
        // Initialize source if it doesn't exist
        setStore('sources', path, {
          fileHash: '',
          selections: [],
        });
      }
      
      setStore('sources', path, 'selections', selections);
      
      // Trigger debounced save
      debouncedSaveSource(path);
    },

    async saveSource(path: string) {
      const dir = store.dirHandle;
      const source = store.sources[path];
      const content = store.fileContents[path];
      
      if (!dir || !source) return;
      
      try {
        // Update hash if we have content
        if (content) {
          const fileHash = await hashText(content);
          setStore('sources', path, 'fileHash', fileHash);
        }
        
        // Navigate to the directory containing the file
        const dirPath = getDirectoryPath(path);
        const fileName = path.split('/').pop()!;
        const mcsFileName = fileName + '.mcs';
        
        const fileDir = dirPath ? await navigateToDirectory(dir, dirPath) : dir;
        const mcsFile = await fileDir.getFileHandle(mcsFileName, { create: true });
        const writable = await mcsFile.createWritable();
        await writable.write(JSON.stringify(store.sources[path], null, 2));
        await writable.close();
      } catch (err) {
        console.error(`Failed to save source ${path}:`, err);
      }
    },

    async saveCodebook(codebook: Codebook) {
      const dir = store.dirHandle;
      if (!dir) return;
      
      try {
        const fileName = `${codebook.name.toLowerCase()}.mcc`;
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(codebook, null, 2));
        await writable.close();
        
        // Reload codebooks to reflect changes
        await actions.loadCodebooks();
      } catch (err) {
        console.error(`Failed to save codebook ${codebook.name}:`, err);
      }
    },

    async deleteCodebook(codebookGuid: string) {
      const dir = store.dirHandle;
      const codebook = store.codebooks.find(cb => cb.guid === codebookGuid);
      
      if (!dir || !codebook) return;
      
      try {
        const fileName = `${codebook.name}.mcc`;
        await dir.removeEntry(fileName);
        
        // Reload codebooks to reflect changes
        await actions.loadCodebooks();
      } catch (err) {
        console.error(`Failed to delete codebook ${codebook.name}:`, err);
      }
    },

    async createCodebook(name: string): Promise<Codebook | null> {
      const dir = store.dirHandle;
      if (!dir || !name.trim()) return null;
      
      const newCodebook: Codebook = {
        guid: crypto.randomUUID(),
        name: name.trim(),
        codes: [],
      };
      
      await actions.saveCodebook(newCodebook);
      return newCodebook;
    },

    async saveQuery(query: Query) {
      const dir = store.dirHandle;
      if (!dir) return;
      
      try {
        const fileName = `${query.name.toLowerCase()}.mcq`;
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(query, null, 2));
        await writable.close();
        
        // Reload queries to reflect changes
        await actions.loadQueries();
      } catch (err) {
        console.error(`Failed to save query ${query.name}:`, err);
      }
    },

    async deleteQuery(queryGuid: string) {
      const dir = store.dirHandle;
      const query = store.queries.find(q => q.guid === queryGuid);
      
      if (!dir || !query) return;
      
      try {
        const fileName = `${query.name}.mcq`;
        await dir.removeEntry(fileName);
        
        // Reload queries to reflect changes
        await actions.loadQueries();
      } catch (err) {
        console.error(`Failed to delete query ${query.name}:`, err);
      }
    },

    async createQuery(name: string): Promise<Query | null> {
      const dir = store.dirHandle;
      if (!dir || !name.trim()) return null;
      
      const newQuery: Query = {
        guid: crypto.randomUUID(),
        name: name.trim(),
        query: null,
      };
      
      await actions.saveQuery(newQuery);
      return newQuery;
    },
  };

  // Debounced save function
  const debouncedSaveSource = debounce((path: string) => {
    actions.saveSource(path);
  }, 1000);

  return (
    <StoreContext.Provider value={{ store, actions }}>
      {props.children}
    </StoreContext.Provider>
  );
};

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}
