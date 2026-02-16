import { createContext, useContext, type ParentComponent } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { hashText, debounce } from './helpers';

/** File location — cached directory handle to avoid tree walks on save */
export interface FileLocation {
  path: string;
  dirHandle: FileSystemDirectoryHandle;
  fileName: string;
}

export interface AppStore {
  dirHandle: FileSystemDirectoryHandle | null;
  fileLocations: Record<string, FileLocation>;  // entity guid or path-based key (for sources) -> FileLocation
  codebooks: Record<string, Codebook>;          // codebook guid -> Codebook
  queries: Record<string, Query>;               // query guid -> Query
  sources: Record<string, Source>;              // source file path -> Source
  fileContents: Record<string, string>;         // source file path -> text content
}

export interface StoreActions {
  setDirectory: (dirHandle: FileSystemDirectoryHandle) => Promise<void>;

  /** Ensures file content is loaded (triggers async load if not cached). */
  ensureFileLoaded: (path: string) => void;

  updateCodebook: (codebook: Codebook) => void;
  createCodebook: (name: string) => Promise<Codebook | null>;
  deleteCodebook: (codebookGuid: string) => Promise<void>;

  updateSourceSelections: (path: string, selections: TextSelection[]) => void;

  toggleExample: (sourcePath: string, selectionGuid: string, codebookGuid: string, codeGuid: string) => void;
  removeExample: (sourcePath: string, selectionGuid: string, codebookGuid: string, codeGuid: string) => void;

  updateQuery: (query: Query) => void;
  createQuery: (name: string) => Promise<Query | null>;
  deleteQuery: (queryGuid: string) => Promise<void>;
}

interface StoreContextValue {
  store: AppStore;
  actions: StoreActions;
}

const StoreContext = createContext<StoreContextValue>();

export const StoreProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<AppStore>({
    dirHandle: null,
    fileLocations: {},
    codebooks: {},
    queries: {},
    sources: {},
    fileContents: {},
  });

  // Track in-progress file content loads to avoid duplicate requests
  const loadingFiles = new Set<string>();

  // Per-entity debounced save functions
  const debouncedSavers = new Map<string, () => void>();

  // ---- File system helpers ----

  async function findAllFiles(
    dir: FileSystemDirectoryHandle,
    extensions: string[],
    basePath: string = ""
  ): Promise<{ file: FileSystemFileHandle; path: string; dirHandle: FileSystemDirectoryHandle; fileName: string }[]> {
    const results: { file: FileSystemFileHandle; path: string; dirHandle: FileSystemDirectoryHandle; fileName: string }[] = [];

    for await (const [name, handle] of dir.entries()) {
      const fullPath = basePath ? `${basePath}/${name}` : name;

      if (handle.kind === 'file' && extensions.some(ext => name.endsWith(ext))) {
        results.push({
          file: handle as FileSystemFileHandle,
          path: fullPath,
          dirHandle: dir,
          fileName: name,
        });
      } else if (handle.kind === 'directory') {
        const subResults = await findAllFiles(handle as FileSystemDirectoryHandle, extensions, fullPath);
        results.push(...subResults);
      }
    }

    return results;
  }

  function getDirectoryPath(filePath: string): string {
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/');
  }

  async function resolveDirectory(
    rootDir: FileSystemDirectoryHandle,
    dirPath: string
  ): Promise<FileSystemDirectoryHandle> {
    if (!dirPath) return rootDir;
    const parts = dirPath.split('/').filter(p => p.length > 0);
    let current = rootDir;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: true });
    }
    return current;
  }

  // ---- Unified persistence ----

  /** Get or create a FileLocation for a given path, caching the directory handle */
  async function ensureFileLocation(path: string, key: string): Promise<FileLocation> {
    const existing = store.fileLocations[key];
    if (existing && existing.path === path) return existing;

    const dir = store.dirHandle;
    if (!dir) throw new Error('No directory handle');

    const dirPath = getDirectoryPath(path);
    const fileName = path.split('/').pop()!;
    const dirHandle = await resolveDirectory(dir, dirPath);

    const loc: FileLocation = { path, dirHandle, fileName };
    setStore('fileLocations', key, loc);
    return loc;
  }

  async function writeFile(loc: FileLocation, content: string): Promise<void> {
    const fileHandle = await loc.dirHandle.getFileHandle(loc.fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async function deleteFile(loc: FileLocation): Promise<void> {
    try {
      await loc.dirHandle.removeEntry(loc.fileName);
    } catch (err) {
      console.warn(`Failed to delete ${loc.path}:`, err);
    }
  }

  // ---- Save implementations ----

  async function saveCodebook(guid: string): Promise<void> {
    const codebook = store.codebooks[guid];
    if (!codebook) return;

    const loc = store.fileLocations[guid];
    if (!loc) {
      console.error(`No file location for codebook ${guid}`);
      return;
    }

    try {
      await writeFile(loc, JSON.stringify(codebook, null, 2));
    } catch (err) {
      console.error(`Failed to save codebook ${guid}:`, err);
    }
  }

  async function saveSource(sourcePath: string): Promise<void> {
    const source = store.sources[sourcePath];
    const content = store.fileContents[sourcePath];
    if (!source) return;

    try {
      if (content) {
        const fileHash = await hashText(content);
        setStore('sources', sourcePath, 'fileHash', fileHash);
      }

      const mcsPath = sourcePath + '.mcs';
      const loc = await ensureFileLocation(mcsPath, `source:${sourcePath}`);
      await writeFile(loc, JSON.stringify(store.sources[sourcePath], null, 2));
    } catch (err) {
      console.error(`Failed to save source ${sourcePath}:`, err);
    }
  }

  async function saveQuery(guid: string): Promise<void> {
    const query = store.queries[guid];
    if (!query) return;

    const loc = store.fileLocations[guid];
    if (!loc) {
      console.error(`No file location for query ${guid}`);
      return;
    }

    try {
      await writeFile(loc, JSON.stringify(query, null, 2));
    } catch (err) {
      console.error(`Failed to save query ${guid}:`, err);
    }
  }

  async function loadFileContentFromDisk(path: string): Promise<void> {
    try {
      const loc = await ensureFileLocation(path, `content:${path}`);
      const fileHandle = await loc.dirHandle.getFileHandle(loc.fileName);
      const file = await fileHandle.getFile();
      const content = await file.text();
      setStore('fileContents', path, content);
    } catch (err) {
      console.warn(`Failed to load file content for ${path}:`, err);
    } finally {
      loadingFiles.delete(path);
    }
  }

  // ---- Debounced save scheduling ----

  function scheduleSave(key: string, fn: () => Promise<void>, delayMs: number) {
    if (!debouncedSavers.has(key)) {
      debouncedSavers.set(key, debounce(() => fn(), delayMs));
    }
    debouncedSavers.get(key)!();
  }

  function registerFileLocation(key: string, loc: FileLocation) {
    setStore('fileLocations', key, loc);
  }

  function unregisterFileLocation(key: string) {
    setStore(produce(s => { delete s.fileLocations[key]; }));
  }

  // ---- Actions ----

  const actions: StoreActions = {
    async setDirectory(dirHandle: FileSystemDirectoryHandle) {
      setStore('dirHandle', dirHandle);
      setStore('codebooks', {});
      setStore('queries', {});
      setStore('sources', {});
      setStore('fileContents', {});
      setStore('fileLocations', {});
      loadingFiles.clear();
      debouncedSavers.clear();

      // Discover all data files in parallel
      const emptyResult: { file: FileSystemFileHandle; path: string; dirHandle: FileSystemDirectoryHandle; fileName: string }[] = [];
      const [codebookFiles, queryFiles, mcsFiles] = await Promise.all([
        findAllFiles(dirHandle, ['.mcc']).catch(() => emptyResult),
        findAllFiles(dirHandle, ['.mcq']).catch(() => emptyResult),
        findAllFiles(dirHandle, ['.mcs']).catch(() => emptyResult),
      ]);

      // Parse codebooks (keyed by guid)
      const newCodebooks: Record<string, Codebook> = {};
      for (const entry of codebookFiles) {
        try {
          const fileData = await entry.file.getFile();
          const text = await fileData.text();
          const codebook = JSON.parse(text) as Codebook;
          newCodebooks[codebook.guid] = codebook;
          registerFileLocation(codebook.guid, { path: entry.path, dirHandle: entry.dirHandle, fileName: entry.fileName });
        } catch (err) {
          console.warn(`Failed to load codebook ${entry.fileName}:`, err);
        }
      }
      setStore('codebooks', newCodebooks);

      // Parse queries (keyed by guid)
      const newQueries: Record<string, Query> = {};
      for (const entry of queryFiles) {
        try {
          const fileData = await entry.file.getFile();
          const text = await fileData.text();
          const query = JSON.parse(text) as Query;
          newQueries[query.guid] = query;
          registerFileLocation(query.guid, { path: entry.path, dirHandle: entry.dirHandle, fileName: entry.fileName });
        } catch (err) {
          console.warn(`Failed to load query ${entry.fileName}:`, err);
        }
      }
      setStore('queries', newQueries);

      // Parse sources (keyed by source file path)
      const newSources: Record<string, Source> = {};
      for (const entry of mcsFiles) {
        try {
          const fileData = await entry.file.getFile();
          const text = await fileData.text();
          const source = JSON.parse(text) as Source;
          const sourcePath = entry.path.slice(0, -4); // remove .mcs
          newSources[sourcePath] = source;
          registerFileLocation(`source:${sourcePath}`, { path: entry.path, dirHandle: entry.dirHandle, fileName: entry.fileName });
        } catch (err) {
          console.warn(`Failed to load source ${entry.path}:`, err);
        }
      }
      setStore('sources', newSources);

      // Eagerly load file contents for all sources (needed by queries)
      await Promise.all(
        Object.keys(newSources).map(path => loadFileContentFromDisk(path))
      );
    },

    ensureFileLoaded(path: string) {
      if (store.fileContents[path] !== undefined) return;
      if (loadingFiles.has(path)) return;
      loadingFiles.add(path);
      loadFileContentFromDisk(path);
    },

    updateCodebook(codebook: Codebook) {
      setStore('codebooks', codebook.guid, codebook);
      scheduleSave(`codebook:${codebook.guid}`, () => saveCodebook(codebook.guid), 500);
    },

    async createCodebook(name: string): Promise<Codebook | null> {
      const dir = store.dirHandle;
      const trimmed = name.trim();
      if (!dir || !trimmed) return null;

      const newCodebook: Codebook = {
        guid: crypto.randomUUID(),
        name: trimmed,
        codes: [],
      };

      // Register file location before saving
      const fileName = `${trimmed.toLowerCase()}.mcc`;
      const loc = await ensureFileLocation(fileName, newCodebook.guid);
      registerFileLocation(newCodebook.guid, loc);

      setStore('codebooks', newCodebook.guid, newCodebook);
      await writeFile(loc, JSON.stringify(newCodebook, null, 2));

      return newCodebook;
    },

    async deleteCodebook(codebookGuid: string) {
      const loc = store.fileLocations[codebookGuid];

      setStore(produce(s => {
        delete s.codebooks[codebookGuid];
      }));

      if (loc) {
        await deleteFile(loc);
        unregisterFileLocation(codebookGuid);
      }
    },

    updateSourceSelections(path: string, selections: TextSelection[]) {
      if (!store.sources[path]) {
        setStore('sources', path, {
          guid: crypto.randomUUID(),
          fileHash: '',
          selections: [],
        });
      }

      setStore('sources', path, 'selections', selections);
      scheduleSave(`source:${path}`, () => saveSource(path), 1000);
    },

    toggleExample(sourcePath: string, selectionGuid: string, codebookGuid: string, codeGuid: string) {
      const codebook = store.codebooks[codebookGuid];
      const source = store.sources[sourcePath];
      if (!codebook || !source) return;

      const sourceGuid = source.guid;
      const ref: TextSelectionReference = { sourceGuid, textSelectionGuid: selectionGuid };

      function toggleInCodes(codes: Code[]): Code[] {
        return codes.map(code => {
          if (code.guid === codeGuid) {
            const examples = code.examples || [];
            const existingIndex = examples.findIndex(
              ex => ex.sourceGuid === sourceGuid && ex.textSelectionGuid === selectionGuid
            );
            if (existingIndex >= 0) {
              return { ...code, examples: examples.filter((_, i) => i !== existingIndex) };
            } else {
              return { ...code, examples: [...examples, ref] };
            }
          }
          if (code.subcodes) {
            return { ...code, subcodes: toggleInCodes(code.subcodes) };
          }
          return code;
        });
      }

      const updatedCodebook: Codebook = {
        ...codebook,
        codes: toggleInCodes(codebook.codes),
      };

      setStore('codebooks', codebookGuid, updatedCodebook);
      scheduleSave(`codebook:${codebookGuid}`, () => saveCodebook(codebookGuid), 500);
    },

    removeExample(sourcePath: string, selectionGuid: string, codebookGuid: string, codeGuid: string) {
      const codebook = store.codebooks[codebookGuid];
      const source = store.sources[sourcePath];
      if (!codebook || !source) return;

      const sourceGuid = source.guid;

      function removeFromCodes(codes: Code[]): Code[] {
        return codes.map(code => {
          if (code.guid === codeGuid) {
            const examples = code.examples || [];
            const filtered = examples.filter(
              ex => !(ex.sourceGuid === sourceGuid && ex.textSelectionGuid === selectionGuid)
            );
            if (filtered.length === examples.length) return code;
            return { ...code, examples: filtered };
          }
          if (code.subcodes) {
            return { ...code, subcodes: removeFromCodes(code.subcodes) };
          }
          return code;
        });
      }

      const updatedCodebook: Codebook = {
        ...codebook,
        codes: removeFromCodes(codebook.codes),
      };

      setStore('codebooks', codebookGuid, updatedCodebook);
      scheduleSave(`codebook:${codebookGuid}`, () => saveCodebook(codebookGuid), 500);
    },

    updateQuery(query: Query) {
      setStore('queries', query.guid, query);
      scheduleSave(`query:${query.guid}`, () => saveQuery(query.guid), 500);
    },

    async createQuery(name: string): Promise<Query | null> {
      const dir = store.dirHandle;
      const trimmed = name.trim();
      if (!dir || !trimmed) return null;

      const newQuery: Query = {
        guid: crypto.randomUUID(),
        name: trimmed,
        query: null,
      };

      // Register file location before saving
      const fileName = `${trimmed.toLowerCase()}.mcq`;
      const loc = await ensureFileLocation(fileName, newQuery.guid);
      registerFileLocation(newQuery.guid, loc);

      setStore('queries', newQuery.guid, newQuery);
      await writeFile(loc, JSON.stringify(newQuery, null, 2));

      return newQuery;
    },

    async deleteQuery(queryGuid: string) {
      const loc = store.fileLocations[queryGuid];

      setStore(produce(s => {
        delete s.queries[queryGuid];
      }));

      if (loc) {
        await deleteFile(loc);
        unregisterFileLocation(queryGuid);
      }
    },
  };

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
