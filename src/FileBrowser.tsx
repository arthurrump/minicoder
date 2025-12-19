import { createSignal, For, Show, createEffect, JSX } from 'solid-js';

interface FileBrowserProps {
  directoryHandle: FileSystemDirectoryHandle;
  onFileSelect?: (file: FileSystemFileHandle) => void;
  selectedFile?: FileSystemFileHandle;
  fileExtensionFilter?: string[]; // e.g., ['.ts', '.tsx', '.js']
}

interface FileNode {
  name: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export function FileBrowser(props: FileBrowserProps) {
  const [rootNodes, setRootNodes] = createSignal<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = createSignal<FileSystemFileHandle | undefined>(props.selectedFile);

  // Load directory contents
  createEffect(async () => {
    if (props.directoryHandle) {
      const nodes = await loadDirectory(props.directoryHandle);
      setRootNodes(nodes);
    }
  });

  // Sync with external selectedFile prop
  createEffect(() => {
    setSelectedFile(props.selectedFile);
  });

  async function loadDirectory(dirHandle: FileSystemDirectoryHandle): Promise<FileNode[]> {
    const nodes: FileNode[] = [];
    
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        // Apply file extension filter if provided
        if (props.fileExtensionFilter && props.fileExtensionFilter.length > 0) {
          const hasMatchingExtension = props.fileExtensionFilter.some(ext => 
            entry.name.endsWith(ext)
          );
          if (!hasMatchingExtension) {
            continue;
          }
        }
        nodes.push({
          name: entry.name,
          handle: entry as FileSystemFileHandle,
          type: 'file',
        });
      } else if (entry.kind === 'directory') {
        nodes.push({
          name: entry.name,
          handle: entry as FileSystemDirectoryHandle,
          type: 'directory',
        });
      }
    }

    // Sort: directories first, then files, alphabetically
    return nodes.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === 'directory' ? -1 : 1;
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

  function handleFileClick(fileHandle: FileSystemFileHandle) {
    setSelectedFile(fileHandle);
    props.onFileSelect?.(fileHandle);
  }

  function FileTreeNode(nodeProps: { node: FileNode; depth?: number }): JSX.Element {
    const depth = nodeProps.depth ?? 0;
    const [children, setChildren] = createSignal<FileNode[]>([]);

    const isExpanded = () => {
      if (nodeProps.node.type === 'directory') {
        return expandedDirs().has(nodeProps.node.name);
      }
      return false;
    };

    const isSelected = () => {
      return nodeProps.node.type === 'file' && 
             selectedFile() === nodeProps.node.handle;
    };

    createEffect(async () => {
      if (nodeProps.node.type === 'directory' && isExpanded()) {
        const dirHandle = nodeProps.node.handle as FileSystemDirectoryHandle;
        const loadedChildren = await loadDirectory(dirHandle);
        setChildren(loadedChildren);
      }
    });

    return (
      <div>
        <div
          class="file-browser-item"
          style={{
            'padding-left': `${depth * 16}px`,
            cursor: 'pointer',
            padding: '4px 8px',
            'user-select': 'none',
            background: isSelected() ? '#0078d4' : 'transparent',
            color: isSelected() ? 'white' : 'inherit',
          }}
          onClick={() => {
            if (nodeProps.node.type === 'directory') {
              toggleDirectory(nodeProps.node.handle as FileSystemDirectoryHandle);
            } else {
              handleFileClick(nodeProps.node.handle as FileSystemFileHandle);
            }
          }}
        >
          <Show when={nodeProps.node.type === 'directory'}>
            <span style={{ 'margin-right': '4px' }}>
              {isExpanded() ? '▼' : '▶'}
            </span>
          </Show>
          <Show when={nodeProps.node.type === 'file'}>
            <span style={{ 'margin-right': '4px' }}>📄</span>
          </Show>
          {nodeProps.node.name}
        </div>
        <Show when={nodeProps.node.type === 'directory' && isExpanded()}>
          <For each={children()}>
            {(child) => <FileTreeNode node={child} depth={depth + 1} />}
          </For>
        </Show>
      </div>
    );
  }

  return (
    <div class="file-browser" style={{ 'font-family': 'monospace', 'font-size': '14px' }}>
      <For each={rootNodes()}>
        {(node) => <FileTreeNode node={node} />}
      </For>
    </div>
  );
}

export default FileBrowser;
