import { createSignal, For, Show, createEffect, type JSX } from 'solid-js';
import Icon from '../Icon';

import { useStore } from '../../store';
import DirTreePicker from './DirTreePicker';
import styles from "./FileBrowser.module.css";

interface ExtensionFilter {
  extensions: string[]; // e.g., ['.ts', '.tsx', '.js']
  mode: 'include' | 'exclude';
}

interface FileSelectInfo {
  file: FileSystemFileHandle;
  directory: FileSystemDirectoryHandle;
  relativePath: string;
}

interface FileBrowserProps {
  directoryHandle: FileSystemDirectoryHandle;
  onFileSelect?: (info: FileSelectInfo) => void;
  onFileCreated?: (relativePath: string) => void;
  selectedFile?: string; // Changed to relative path
  filter?: ExtensionFilter;
}

interface FileNode {
  name: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: FileNode[];
  parentDir: FileSystemDirectoryHandle;
  relativePath: string;
}

type CreateModalType = 'codebook' | 'query';

export function FileBrowser(props: FileBrowserProps) {
  const { store, actions } = useStore();
  const [rootNodes, setRootNodes] = createSignal<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());
  const [createModal, setCreateModal] = createSignal<CreateModalType | null>(null);
  const [createName, setCreateName] = createSignal('');
  const [createDir, setCreateDir] = createSignal('');

  // Load directory contents
  async function refreshDirectory() {
    if (props.directoryHandle) {
      const nodes = await loadDirectory(props.directoryHandle, "");
      setRootNodes(nodes);
    }
  }

  createEffect(() => {
    void refreshDirectory();
  });

  function openCreateModal(type: CreateModalType) {
    setCreateName('');
    setCreateDir('');
    setCreateModal(type);
  }

  function closeCreateModal() {
    setCreateModal(null);
    setCreateName('');
    setCreateDir('');
  }

  async function handleCreateConfirm() {
    const type = createModal();
    const name = createName().trim();
    const dirPath = createDir() || undefined;
    if (!name || !type) return;

    closeCreateModal();

    if (type === 'codebook') {
      const codebook = await actions.createCodebook(name, dirPath);
      if (codebook) {
        await refreshDirectory();
        const baseName = `${codebook.name.toLowerCase()}.mcc`;
        const relativePath = dirPath ? `${dirPath}/${baseName}` : baseName;
        props.onFileCreated?.(relativePath);
      }
    } else {
      const query = await actions.createQuery(name, dirPath);
      if (query) {
        await refreshDirectory();
        const baseName = `${query.name.toLowerCase()}.mcq`;
        const relativePath = dirPath ? `${dirPath}/${baseName}` : baseName;
        props.onFileCreated?.(relativePath);
      }
    }
  }

  async function loadDirectory(
    dirHandle: FileSystemDirectoryHandle,
    pathPrefix: string
  ): Promise<FileNode[]> {
    const nodes: FileNode[] = [];
    
    for await (const entry of dirHandle.values()) {
      const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      
      if (entry.kind === 'file') {
        // Apply file extension filter if provided
        if (props.filter && props.filter.extensions.length > 0) {
          const { extensions, mode } = props.filter;
          const hasMatchingExtension = extensions.some(ext => 
            entry.name.endsWith(ext)
          );
          
          if (mode === 'include' && !hasMatchingExtension) {
            continue; // Skip files that don't match included extensions
          }
          if (mode === 'exclude' && hasMatchingExtension) {
            continue; // Skip files that match excluded extensions
          }
        }
        nodes.push({
          name: entry.name,
          handle: entry as FileSystemFileHandle,
          parentDir: dirHandle,
          relativePath,
        });
      } else if (entry.kind === 'directory') {
        nodes.push({
          name: entry.name,
          handle: entry as FileSystemDirectoryHandle,
          parentDir: dirHandle,
          relativePath,
        });
      }
    }

    // Sort: directories first, then files, alphabetically
    return nodes.sort((a, b) => {
      if (a.handle.kind === b.handle.kind) {
        return a.name.localeCompare(b.name);
      }
      return a.handle.kind === 'directory' ? -1 : 1;
    });
  }

  function toggleDirectory(relativePath: string) {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }

  function handleFileClick(node: FileNode) {
    props.onFileSelect?.({
      file: node.handle as FileSystemFileHandle,
      directory: node.parentDir,
      relativePath: node.relativePath,
    });
  }

  function FileTreeNode(nodeProps: { node: FileNode; depth?: number }): JSX.Element {
    const depth = () => nodeProps.depth ?? 0;
    const [children, setChildren] = createSignal<FileNode[]>([]);

    const isExpanded = () => {
      if (nodeProps.node.handle.kind === 'directory') {
        return expandedDirs().has(nodeProps.node.relativePath);
      }
      return false;
    };

    const isSelected = () => {
      return nodeProps.node.handle.kind === 'file' && props.selectedFile === nodeProps.node.relativePath;
    };

    createEffect(() => {
      const expanded = isExpanded();
      if (nodeProps.node.handle.kind === 'directory' && expanded) {
        const dirHandle = nodeProps.node.handle;
        void loadDirectory(dirHandle, nodeProps.node.relativePath).then(setChildren);
      }
    });

    return (
      <div>
        <div
          class={styles.node}
          style={{
            padding: `4px 4px 4px ${depth() * 16}px`,
            background: isSelected() ? 'var(--node-selected-background)' : 'transparent',
            color: isSelected() ? 'var(--node-selected-color)' : 'inherit',
          }}
          onClick={() => {
            if (nodeProps.node.handle.kind === 'directory') {
              toggleDirectory(nodeProps.node.relativePath);
            } else {
              handleFileClick(nodeProps.node);
            }
          }}
        >
          <Show when={nodeProps.node.handle.kind === 'directory'}>
            <span class={styles.toggle}>
              {isExpanded() ? '▼' : '▶'}
            </span>
          </Show>
          <Show when={nodeProps.node.handle.kind === 'file'}>
            <Show when={nodeProps.node.name.endsWith('.mcc')}>
              <Icon name="repo" class={styles.fileIndicator} />
            </Show>
            <Show when={nodeProps.node.name.endsWith('.mcq')}>
              <Icon name="search" class={styles.fileIndicator} />
            </Show>
            <Show when={!nodeProps.node.name.endsWith('.mcc') && !nodeProps.node.name.endsWith('.mcq')}>
              <Icon name="file" class={styles.fileIndicator} />
            </Show>
          </Show>
          <span>{nodeProps.node.name}</span>
        </div>
        <Show when={nodeProps.node.handle.kind === 'directory' && isExpanded()}>
          <For each={children()}>
            {(child) => <FileTreeNode node={child} depth={depth() + 1} />}
          </For>
        </Show>
      </div>
    );
  }

  const [refreshing, setRefreshing] = createSignal(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await actions.refresh();
      await refreshDirectory();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div class={styles.fileBrowser}>
      <div class={styles.fileBrowserHeader}>
        <button class={styles.createBtn} onClick={() => openCreateModal('codebook')} title="New Codebook">
          <Icon name="repo" width={14} />
          <span>+</span>
        </button>
        <button class={styles.createBtn} onClick={() => openCreateModal('query')} title="New Query">
          <Icon name="search" width={14} />
          <span>+</span>
        </button>
        <span class={styles.saveIndicator} title={store.isSaving ? 'Saving...' : 'Saved'}>
          <Show when={store.isSaving} fallback={
            <Icon name="issue-closed" width={14} />
          }>
            <Icon name="issue-draft" width={14} class={styles.spinning} />
          </Show>
        </span>
        <button
          class={styles.createBtn}
          classList={{ [styles.spinning]: refreshing() }}
          onClick={() => { void handleRefresh(); }}
          title="Refresh files"
          disabled={refreshing()}
        >
          <Icon name="sync" width={14} />
        </button>
      </div>
      <div class={styles.fileBrowserTree}>
        <For each={rootNodes()}>
          {(node) => <FileTreeNode node={node} />}
        </For>
      </div>
      <Show when={createModal()}>
        <div class={styles.modalOverlay} onClick={closeCreateModal}>
          <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>New {createModal() === 'codebook' ? 'Codebook' : 'Query'}</h3>
            <div class={styles.modalField}>
              <label for="create-name">Name</label>
              <input
                id="create-name"
                type="text"
                autocomplete="off"
                placeholder={`Enter ${createModal()} name`}
                value={createName()}
                onInput={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && createName().trim()) void handleCreateConfirm(); }}
                ref={(el) => setTimeout(() => el.focus(), 0)}
              />
            </div>
            <div class={styles.modalField}>
              <label>Directory</label>
              <div class={styles.dirTree}>
                <DirTreePicker
                  dirHandle={props.directoryHandle}
                  selectedDir={createDir()}
                  onSelect={setCreateDir}
                />
              </div>
            </div>
            <div class={styles.modalActions}>
              <button onClick={closeCreateModal}>Cancel</button>
              <button
                class={styles.primaryBtn}
                onClick={() => { void handleCreateConfirm(); }}
                disabled={!createName().trim()}
              >Create</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default FileBrowser;
