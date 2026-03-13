import { createContext, createMemo, onCleanup, useContext, type Accessor, type ParentComponent } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { hashBytes, debounce, isPlainText, fileTreeCompare, sanitizeFileName, type Debounced } from './helpers';

/** File location — cached directory handle to avoid tree walks on save */
export interface FileLocation {
  path: string;
  dirHandle: FileSystemDirectoryHandle;
  fileName: string;
}

export type FileContent =
  | { type: "plain-text", hash: string, content: string }
  | { type: "binary", hash: string };

export interface AppStore {
  dirHandle: FileSystemDirectoryHandle | null;
  fileLocations: Record<string, FileLocation>;  // entity guid or path-based key (for sources) -> FileLocation
  codebooks: Record<string, Codebook>;          // codebook guid -> Codebook
  queries: Record<string, Query>;               // query guid -> Query
  sources: Record<string, Source>;              // source file path -> Source
  fileContents: Record<string, FileContent>;    // source file path -> FileContent
  /** Whether any saves are currently pending (debounced or in-flight). */
  isSaving: boolean;
}

export interface StoreActions {
  setDirectory: (dirHandle: FileSystemDirectoryHandle) => Promise<void>;

  /** Ensures file content is loaded (triggers async load if not cached). */
  ensureFileLoaded: (path: string) => void;

  updateCodebook: (codebook: Codebook) => void;
  createCodebook: (name: string, dirPath?: string) => Promise<Codebook | null>;
  deleteCodebook: (codebookGuid: string) => Promise<void>;
  deleteCode: (codebookGuid: string, codeGuid: string) => void;

  updateSourceSelections: (path: string, selections: TextSelection[]) => void;

  mergeCode: (codebookGuid: string, sourceCodeGuid: string, targetCodeGuid: string) => void;
  moveCode: (sourceCodebookGuid: string, codeGuid: string, targetCodebookGuid: string) => void;
  mergeCodebook: (sourceCodebookGuid: string, targetCodebookGuid: string) => Promise<void>;

  toggleExample: (sourcePath: string, selectionGuid: string, codebookGuid: string, codeGuid: string) => void;
  removeExample: (sourcePath: string, selectionGuid: string, codebookGuid: string, codeGuid: string) => void;

  updateQuery: (query: Query) => void;
  createQuery: (name: string, dirPath?: string) => Promise<Query | null>;
  deleteQuery: (queryGuid: string) => Promise<void>;

  /** Re-scan the directory and reload all codebooks, sources, queries, and file contents from disk. */
  refresh: () => Promise<void>;

  /** Register an error callback for user-facing error notifications. */
  setErrorHandler: (handler: (message: string) => void) => void;
}

export interface StoreIndices {
  codeByGuid: Accessor<Record<string, { code: Code; codebook: Codebook }>>;
  subcodesByGuid: Accessor<Record<string, Set<string>>>;
  codesByCodebook: Accessor<Record<string, Set<string>>>;
  pathToGuid: Accessor<Record<string, string>>;
  /** Codebooks sorted in file-tree order (files before folders, alphabetical). */
  sortedCodebooks: Accessor<Codebook[]>;
}

interface StoreContextValue {
  store: AppStore;
  actions: StoreActions;
  indices: StoreIndices;
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
    isSaving: false,
  });

  // Track in-progress file content loads to avoid duplicate requests
  const loadingFiles = new Set<string>();

  // Per-entity debounced save functions
  const debouncedSavers = new Map<string, Debounced<() => Promise<void>>>();

  // Track pending saves for the saving indicator
  const pendingKeys = new Set<string>();

  // User-facing error handler (set via actions.setErrorHandler)
  let errorHandler: ((message: string) => void) | null = null;

  function reportError(message: string) {
    if (errorHandler) errorHandler(message);
  }

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
      reportError(`Failed to save codebook "${codebook.name}". Changes may be lost.`);
    }
  }

  async function saveSource(sourcePath: string): Promise<void> {
    const source = store.sources[sourcePath];
    const fc = store.fileContents[sourcePath];
    if (!source) return;

    try {
      if (fc) {
        setStore('sources', sourcePath, 'fileHash', fc.hash);
      }

      const mcsPath = sourcePath + '.mcs';
      const loc = await ensureFileLocation(mcsPath, `source:${sourcePath}`);
      await writeFile(loc, JSON.stringify(store.sources[sourcePath], null, 2));
    } catch (err) {
      console.error(`Failed to save source ${sourcePath}:`, err);
      reportError(`Failed to save annotations for "${sourcePath}". Changes may be lost.`);
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
      reportError(`Failed to save query "${query.name}". Changes may be lost.`);
    }
  }

  async function loadFileContentFromDisk(path: string): Promise<void> {
    try {
      const loc = await ensureFileLocation(path, `content:${path}`);
      const fileHandle = await loc.dirHandle.getFileHandle(loc.fileName);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      const hash = await hashBytes(buffer);
      const content = new TextDecoder().decode(buffer);
      if (isPlainText(content)) {
        setStore('fileContents', path, { type: 'plain-text', hash, content });
      } else {
        setStore('fileContents', path, { type: 'binary', hash });
      }
    } catch (err) {
      console.warn(`Failed to load file content for ${path}:`, err);
      reportError(`Failed to load file "${path}".`);
    } finally {
      loadingFiles.delete(path);
    }
  }

  // ---- Debounced save scheduling ----

  function scheduleSave(key: string, fn: () => Promise<void>, delayMs: number) {
    if (!debouncedSavers.has(key)) {
      debouncedSavers.set(key, debounce(async () => {
        try {
          await fn();
        } finally {
          pendingKeys.delete(key);
          if (pendingKeys.size === 0) setStore('isSaving', false);
        }
      }, delayMs));
    }
    pendingKeys.add(key);
    setStore('isSaving', true);
    debouncedSavers.get(key)!();
  }

  function registerFileLocation(key: string, loc: FileLocation) {
    setStore('fileLocations', key, loc);
  }

  function unregisterFileLocation(key: string) {
    setStore(produce(s => { delete s.fileLocations[key]; }));
  }

  /**
   * Remove references to a deleted codebook's codes from a query tree.
   * Returns the original node if unchanged, or a cleaned version.
   * Code leaf nodes referencing the codebook are removed; codebook leaf
   * nodes referencing the codebook are removed; operator nodes that lose all
   * children become null.
   */
  function removeCodebookFromQuery(node: QueryNode, codebookGuid: string, codeGuids?: Set<string>): QueryNode | null {
    if (node.type === 'code') {
      if (node.codebookGuid === codebookGuid || (codeGuids && codeGuids.has(node.codeGuid))) {
        return null;
      }
      return node;
    }
    if (node.type === 'codebook') {
      if (node.codebookGuid === codebookGuid) {
        return null;
      }
      return node;
    }
    if (node.type === 'operator') {
      const cleaned = node.children
        .map(child => removeCodebookFromQuery(child, codebookGuid, codeGuids))
        .filter((child): child is QueryNode => child !== null);
      if (cleaned.length === node.children.length) {
        // Check if any child actually changed
        const anyChanged = cleaned.some((c, i) => c !== node.children[i]);
        return anyChanged ? { ...node, children: cleaned } : node;
      }
      if (cleaned.length === 0) return null;
      return { ...node, children: cleaned };
    }
    return node;
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
      for (const saver of debouncedSavers.values()) saver.cancel();
      debouncedSavers.clear();
      pendingKeys.clear();
      setStore('isSaving', false);

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
          source.selections.sort((a, b) => a.start - b.start || b.end - a.end);
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

    async createCodebook(name: string, dirPath?: string): Promise<Codebook | null> {
      const dir = store.dirHandle;
      const trimmed = name.trim();
      if (!dir || !trimmed) return null;

      const sanitized = sanitizeFileName(trimmed);
      if (!sanitized) return null;

      const newCodebook: Codebook = {
        guid: crypto.randomUUID(),
        name: trimmed,
        codes: [],
      };

      // Register file location before saving
      const baseName = `${sanitized}.mcc`;
      const fileName = dirPath ? `${dirPath}/${baseName}` : baseName;
      const loc = await ensureFileLocation(fileName, newCodebook.guid);
      registerFileLocation(newCodebook.guid, loc);

      setStore('codebooks', newCodebook.guid, newCodebook);
      await writeFile(loc, JSON.stringify(newCodebook, null, 2));

      return newCodebook;
    },

    async deleteCodebook(codebookGuid: string) {
      const loc = store.fileLocations[codebookGuid];

      // Collect all code GUIDs belonging to this codebook before removing it
      const codeGuids = indices.codesByCodebook()[codebookGuid];

      setStore(produce(s => {
        delete s.codebooks[codebookGuid];
      }));

      // Remove all selections referencing codes from the deleted codebook
      if (codeGuids && codeGuids.size > 0) {
        for (const [path, source] of Object.entries(store.sources)) {
          const filtered = source.selections.filter(
            sel => sel.code.codebookGuid !== codebookGuid && !codeGuids.has(sel.code.codeGuid)
          );
          if (filtered.length !== source.selections.length) {
            setStore('sources', path, 'selections', filtered);
            scheduleSave(`source:${path}`, () => saveSource(path), 500);
          }
        }
      }

      // Clean up query nodes that reference codes from this codebook
      for (const [guid, query] of Object.entries(store.queries)) {
        if (query.query) {
          const cleaned = removeCodebookFromQuery(query.query, codebookGuid, codeGuids);
          if (cleaned !== query.query) {
            setStore('queries', guid, 'query', cleaned);
            scheduleSave(`query:${guid}`, () => saveQuery(guid), 500);
          }
        }
      }

      if (loc) {
        await deleteFile(loc);
        unregisterFileLocation(codebookGuid);
      }
    },

    deleteCode(codebookGuid: string, codeGuid: string) {
      const codebook = store.codebooks[codebookGuid];
      if (!codebook) return;

      // Collect all guids being removed: the code itself + all nested subcodes
      const removedGuids = indices.subcodesByGuid()[codeGuid];
      if (!removedGuids || removedGuids.size === 0) return;

      // Remove the code from the codebook tree
      function removeCode(codes: Code[]): Code[] {
        return codes
          .filter(c => c.guid !== codeGuid)
          .map(c => c.subcodes ? { ...c, subcodes: removeCode(c.subcodes) } : c);
      }
      const updatedCodebook = { ...codebook, codes: removeCode(codebook.codes) };
      actions.updateCodebook(updatedCodebook);

      // Remove all selections referencing any of the deleted codes
      for (const [path, source] of Object.entries(store.sources)) {
        const filtered = source.selections.filter(sel => !removedGuids.has(sel.code.codeGuid));
        if (filtered.length !== source.selections.length) {
          setStore('sources', path, 'selections', filtered);
          scheduleSave(`source:${path}`, () => saveSource(path), 500);
        }
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

      selections.sort((a, b) => a.start - b.start || b.end - a.end);
      setStore('sources', path, 'selections', selections);
      scheduleSave(`source:${path}`, () => saveSource(path), 1000);
    },

    mergeCode(codebookGuid: string, sourceCodeGuid: string, targetCodeGuid: string) {
      // 1. Replace code references in all selections across all sources
      for (const [path, source] of Object.entries(store.sources)) {
        let changed = false;
        const updatedSelections = source.selections.map(sel => {
          if (sel.code.codeGuid === sourceCodeGuid) {
            changed = true;
            return { ...sel, code: { ...sel.code, codeGuid: targetCodeGuid } };
          }
          return sel;
        });
        if (changed) {
          setStore('sources', path, 'selections', updatedSelections);
          scheduleSave(`source:${path}`, () => saveSource(path), 500);
        }
      }

      // 2. Replace code references in all queries
      function replaceInQueryNode(node: QueryNode): QueryNode {
        if (node.type === 'code') {
          if (node.codeGuid === sourceCodeGuid) {
            return { ...node, codeGuid: targetCodeGuid };
          }
          return node;
        }
        if (node.type === 'operator') {
          return { ...node, children: node.children.map(replaceInQueryNode) };
        }
        return node;
      }

      for (const [guid, query] of Object.entries(store.queries)) {
        if (query.query) {
          const updatedNode = replaceInQueryNode(query.query);
          if (updatedNode !== query.query) {
            setStore('queries', guid, 'query', updatedNode);
            scheduleSave(`query:${guid}`, () => saveQuery(guid), 500);
          }
        }
      }

      // 3. Transfer examples from source code to target code, then remove source code from codebook
      const codebook = store.codebooks[codebookGuid];
      if (!codebook) return;

      const sourceCode = indices.codeByGuid()[sourceCodeGuid]?.code;
      const sourceExamples = sourceCode?.examples || [];
      const sourceSubcodes = sourceCode?.subcodes || [];

      // Walk the entire code tree to:
      // 1. Remove the source code wherever it appears (filter)
      // 2. At the target code, append the source's examples and re-parent its subcodes (map)
      // Both source and target can be at any depth, so we must recurse into
      // every code's subcodes. The filter keeps all non-source codes, so the
      // map always runs on the remaining codes at each level — ensuring we
      // reach nested targets and nested source codes alike.
      function removeAndMerge(codes: Code[]): Code[] {
        return codes
          // Remove the source code at this level (no-op if it's deeper)
          .filter(c => c.guid !== sourceCodeGuid)
          .map(code => {
            let updated = code;
            if (code.guid === targetCodeGuid) {
              // Transfer examples from source to target
              if (sourceExamples.length > 0) {
                updated = { ...updated, examples: [...(code.examples || []), ...sourceExamples] };
              }
              // Re-parent subcodes from source code under the target
              if (sourceSubcodes.length > 0) {
                updated = { ...updated, subcodes: [...(updated.subcodes || []), ...sourceSubcodes] };
              }
            }
            // Recurse into subcodes to handle source/target at deeper levels
            if (updated.subcodes) {
              updated = { ...updated, subcodes: removeAndMerge(updated.subcodes) };
            }
            return updated;
          });
      }

      const updatedCodebook = { ...codebook, codes: removeAndMerge(codebook.codes) };
      setStore('codebooks', codebookGuid, updatedCodebook);
      scheduleSave(`codebook:${codebookGuid}`, () => saveCodebook(codebookGuid), 500);
    },

    moveCode(sourceCodebookGuid: string, codeGuid: string, targetCodebookGuid: string) {
      const sourceCodebook = store.codebooks[sourceCodebookGuid];
      const targetCodebook = store.codebooks[targetCodebookGuid];
      if (!sourceCodebook || !targetCodebook) return;

      // Collect all guids being moved: the code itself + all nested subcodes
      const movedGuids = indices.subcodesByGuid()[codeGuid];
      if (!movedGuids || movedGuids.size === 0) return;

      // Extract the code from the source codebook tree
      let movedCode: Code | null = null;
      function extractCode(codes: Code[]): Code[] {
        return codes.filter(c => {
          if (c.guid === codeGuid) {
            movedCode = c;
            return false;
          }
          return true;
        }).map(c => c.subcodes ? { ...c, subcodes: extractCode(c.subcodes) } : c);
      }
      const updatedSourceCodes = extractCode(sourceCodebook.codes);

      if (!movedCode) return;

      // Update source codebook (remove the code)
      const updatedSource = { ...sourceCodebook, codes: updatedSourceCodes };
      setStore('codebooks', sourceCodebookGuid, updatedSource);
      scheduleSave(`codebook:${sourceCodebookGuid}`, () => saveCodebook(sourceCodebookGuid), 500);

      // Update target codebook (add code as top-level)
      const updatedTarget = { ...targetCodebook, codes: [...targetCodebook.codes, movedCode] };
      setStore('codebooks', targetCodebookGuid, updatedTarget);
      scheduleSave(`codebook:${targetCodebookGuid}`, () => saveCodebook(targetCodebookGuid), 500);

      // Update all selections referencing any of the moved codes to point to the target codebook
      for (const [path, source] of Object.entries(store.sources)) {
        let changed = false;
        const updatedSelections = source.selections.map(sel => {
          if (sel.code.codebookGuid === sourceCodebookGuid && movedGuids.has(sel.code.codeGuid)) {
            changed = true;
            return { ...sel, code: { ...sel.code, codebookGuid: targetCodebookGuid } };
          }
          return sel;
        });
        if (changed) {
          setStore('sources', path, 'selections', updatedSelections);
          scheduleSave(`source:${path}`, () => saveSource(path), 500);
        }
      }
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

    async mergeCodebook(sourceCodebookGuid: string, targetCodebookGuid: string) {
      const sourceCodebook = store.codebooks[sourceCodebookGuid];
      const targetCodebook = store.codebooks[targetCodebookGuid];
      if (!sourceCodebook || !targetCodebook) return;

      // 1. Move all codes from source codebook into target codebook
      const updatedTarget = {
        ...targetCodebook,
        codes: [...targetCodebook.codes, ...sourceCodebook.codes],
      };
      setStore('codebooks', targetCodebookGuid, updatedTarget);
      scheduleSave(`codebook:${targetCodebookGuid}`, () => saveCodebook(targetCodebookGuid), 500);

      // 2. Update all selections that reference the source codebook
      for (const [path, source] of Object.entries(store.sources)) {
        let changed = false;
        const updatedSelections = source.selections.map(sel => {
          if (sel.code.codebookGuid === sourceCodebookGuid) {
            changed = true;
            return { ...sel, code: { ...sel.code, codebookGuid: targetCodebookGuid } };
          }
          return sel;
        });
        if (changed) {
          setStore('sources', path, 'selections', updatedSelections);
          scheduleSave(`source:${path}`, () => saveSource(path), 500);
        }
      }

      // 3. Delete the source codebook
      await actions.deleteCodebook(sourceCodebookGuid);
    },

    updateQuery(query: Query) {
      setStore('queries', query.guid, query);
      scheduleSave(`query:${query.guid}`, () => saveQuery(query.guid), 500);
    },

    async createQuery(name: string, dirPath?: string): Promise<Query | null> {
      const dir = store.dirHandle;
      const trimmed = name.trim();
      if (!dir || !trimmed) return null;

      const sanitized = sanitizeFileName(trimmed);
      if (!sanitized) return null;

      const newQuery: Query = {
        guid: crypto.randomUUID(),
        name: trimmed,
        query: null,
        fileFilter: "",
        userFilter: []
      };

      // Register file location before saving
      const baseName = `${sanitized}.mcq`;
      const fileName = dirPath ? `${dirPath}/${baseName}` : baseName;
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

    async refresh() {
      const dirHandle = store.dirHandle;
      if (!dirHandle) return;

      // Flush all pending debounced saves immediately and wait for them to complete
      const flushPromises = [...debouncedSavers.values()]
        .map(saver => saver.flush())
        .filter((p): p is Promise<void> => p !== undefined);
      await Promise.all(flushPromises);

      await actions.setDirectory(dirHandle);
    },

    setErrorHandler(handler: (message: string) => void) {
      errorHandler = handler;
    },
  };

  // ---- Indices ----
  
  const indices: StoreIndices = { 
    codeByGuid: createMemo(() => {
      const index: Record<string, { code: Code; codebook: Codebook }> = {};
      function walk(codes: Code[], codebook: Codebook) {
        for (const code of codes) {
          index[code.guid] = { code, codebook };
          if (code.subcodes) walk(code.subcodes, codebook);
        }
      }
      for (const codebook of Object.values(store.codebooks)) {
        walk(codebook.codes, codebook);
      }
      return index;
    }),
    subcodesByGuid: createMemo(() => {
      const index: Record<string, Set<string>> = {};
      function collect(code: Code): Set<string> {
        const guids = new Set<string>([code.guid]);
        if (code.subcodes) {
          for (const sub of code.subcodes) {
            for (const g of collect(sub)) guids.add(g);
          }
        }
        index[code.guid] = guids;
        return guids;
      }
      for (const codebook of Object.values(store.codebooks)) {
        for (const code of codebook.codes) collect(code);
      }
      return index;
    }),
    codesByCodebook: createMemo(() => {
      const index: Record<string, Set<string>> = {};
      function collect(codes: Code[], guids: Set<string>) {
        for (const code of codes) {
          guids.add(code.guid);
          if (code.subcodes) collect(code.subcodes, guids);
        }
      }
      for (const codebook of Object.values(store.codebooks)) {
        const guids = new Set<string>();
        collect(codebook.codes, guids);
        index[codebook.guid] = guids;
      }
      return index;
    }),
    pathToGuid: createMemo(() => {
      const index: Record<string, string> = {};
      for (const [guid, loc] of Object.entries(store.fileLocations)) {
        if (!guid.startsWith('source:') && !guid.startsWith('content:')) {
          index[loc.path] = guid;
        }
      }
      return index;
    }),
    sortedCodebooks: createMemo(() => {
      return Object.values(store.codebooks).sort((a, b) => {
        const pathA = store.fileLocations[a.guid]?.path ?? a.name;
        const pathB = store.fileLocations[b.guid]?.path ?? b.name;
        return fileTreeCompare(pathA, pathB);
      });
    }),
  };

  // ---- Warn on unsaved changes when closing/navigating away ----

  function beforeUnloadHandler(e: BeforeUnloadEvent) {
    if (pendingKeys.size > 0) {
      e.preventDefault();
      // Attempt to flush all pending debounced saves synchronously
      for (const saver of debouncedSavers.values()) saver.flush();
    }
  }

  window.addEventListener('beforeunload', beforeUnloadHandler);
  onCleanup(() => window.removeEventListener('beforeunload', beforeUnloadHandler));

  return (
    <StoreContext.Provider value={{ store, actions, indices }}>
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
