import { createSignal, For, Show, createEffect, JSX } from 'solid-js';
import octicons from '@primer/octicons';

import { useStore } from '../store';
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

export function FileBrowser(props: FileBrowserProps) {
  const { actions } = useStore();
  const [rootNodes, setRootNodes] = createSignal<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());

  // Load directory contents
  async function refreshDirectory() {
    if (props.directoryHandle) {
      const nodes = await loadDirectory(props.directoryHandle, "");
      setRootNodes(nodes);
    }
  }

  createEffect(async () => {
    await refreshDirectory();
  });

  async function handleCreateCodebook() {
    const name = prompt('Enter codebook name:');
    if (!name?.trim()) return;
    
    const codebook = await actions.createCodebook(name.trim());
    if (codebook) {
      await refreshDirectory();
      const relativePath = `${codebook.name.toLowerCase()}.mcc`;
      props.onFileCreated?.(relativePath);
    }
  }

  async function handleCreateQuery() {
    const name = prompt('Enter query name:');
    if (!name?.trim()) return;
    
    const query = await actions.createQuery(name.trim());
    if (query) {
      await refreshDirectory();
      const relativePath = `${query.name.toLowerCase()}.mcq`;
      props.onFileCreated?.(relativePath);
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

  function toggleDirectory(dirHandle: FileSystemDirectoryHandle) {
    const key = dirHandle.name;
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
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
    const depth = nodeProps.depth ?? 0;
    const [children, setChildren] = createSignal<FileNode[]>([]);

    const isExpanded = () => {
      if (nodeProps.node.handle.kind === 'directory') {
        return expandedDirs().has(nodeProps.node.name);
      }
      return false;
    };

    const isSelected = () => {
      return nodeProps.node.handle.kind === 'file' && props.selectedFile === nodeProps.node.relativePath;
    };

    createEffect(async () => {
      if (nodeProps.node.handle.kind === 'directory' && isExpanded()) {
        const dirHandle = nodeProps.node.handle as FileSystemDirectoryHandle;
        const loadedChildren = await loadDirectory(dirHandle, nodeProps.node.relativePath);
        setChildren(loadedChildren);
      }
    });

    return (
      <div>
        <div
          class={styles.node}
          style={{
            padding: `4px 4px 4px ${depth * 16}px`,
            background: isSelected() ? 'var(--node-selected-background)' : 'transparent',
            color: isSelected() ? 'var(--node-selected-color)' : 'inherit',
          }}
          onClick={() => {
            if (nodeProps.node.handle.kind === 'directory') {
              toggleDirectory(nodeProps.node.handle as FileSystemDirectoryHandle);
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
              <span class={styles.fileIndicator} innerHTML={octicons.repo.toSVG()} />
            </Show>
            <Show when={nodeProps.node.name.endsWith('.mcq')}>
              <span class={styles.fileIndicator} innerHTML={octicons.search.toSVG()} />
            </Show>
            <Show when={!nodeProps.node.name.endsWith('.mcc') && !nodeProps.node.name.endsWith('.mcq')}>
              <span class={styles.fileIndicator} innerHTML={octicons.file.toSVG()} />
            </Show>
          </Show>
          <span>{nodeProps.node.name}</span>
        </div>
        <Show when={nodeProps.node.handle.kind === 'directory' && isExpanded()}>
          <For each={children()}>
            {(child) => <FileTreeNode node={child} depth={depth + 1} />}
          </For>
        </Show>
      </div>
    );
  }

  return (
    <div class={styles.fileBrowser}>
      <div class={styles.fileBrowserHeader}>
        <button class={styles.createBtn} onClick={handleCreateCodebook} title="New Codebook">
          <span innerHTML={octicons.repo.toSVG({ width: 14 })} />
          <span>+</span>
        </button>
        <button class={styles.createBtn} onClick={handleCreateQuery} title="New Query">
          <span innerHTML={octicons.search.toSVG({ width: 14 })} />
          <span>+</span>
        </button>
      </div>
      <div class={styles.fileBrowserTree}>
        <For each={rootNodes()}>
          {(node) => <FileTreeNode node={node} />}
        </For>
      </div>
    </div>
  );
}

export default FileBrowser;
