import { createSignal, For, Show, createEffect, JSX } from 'solid-js';

type SaveStatus = 'saved' | 'pending' | 'none';

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
  selectedFile?: FileSystemFileHandle;
  fileExtensionFilter?: ExtensionFilter; // Filter files by extension
  fileStatuses?: Map<string, SaveStatus>; // Status indicators for files (keyed by relative path)
}

interface FileNode {
  name: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  type: 'file' | 'directory';
  children?: FileNode[];
  parentDir: FileSystemDirectoryHandle;
  relativePath: string;
}

export function FileBrowser(props: FileBrowserProps) {
  const [rootNodes, setRootNodes] = createSignal<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = createSignal<FileSystemFileHandle | undefined>(props.selectedFile);

  // Load directory contents
  createEffect(async () => {
    if (props.directoryHandle) {
      const nodes = await loadDirectory(props.directoryHandle, props.directoryHandle, "");
      setRootNodes(nodes);
    }
  });

  // Sync with external selectedFile prop
  createEffect(() => {
    setSelectedFile(props.selectedFile);
  });

  async function loadDirectory(
    dirHandle: FileSystemDirectoryHandle, 
    parentDir: FileSystemDirectoryHandle,
    pathPrefix: string
  ): Promise<FileNode[]> {
    const nodes: FileNode[] = [];
    
    for await (const entry of dirHandle.values()) {
      const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      
      if (entry.kind === 'file') {
        // Apply file extension filter if provided
        if (props.fileExtensionFilter && props.fileExtensionFilter.extensions.length > 0) {
          const { extensions, mode } = props.fileExtensionFilter;
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
          type: 'file',
          parentDir: dirHandle,
          relativePath,
        });
      } else if (entry.kind === 'directory') {
        nodes.push({
          name: entry.name,
          handle: entry as FileSystemDirectoryHandle,
          type: 'directory',
          parentDir: dirHandle,
          relativePath,
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

  function handleFileClick(node: FileNode) {
    setSelectedFile(node.handle as FileSystemFileHandle);
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
        const loadedChildren = await loadDirectory(dirHandle, dirHandle, nodeProps.node.relativePath);
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
              handleFileClick(nodeProps.node);
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
          <span class="file-name">{nodeProps.node.name}</span>
          <Show when={nodeProps.node.type === 'file'}>
            {(() => {
              const status = props.fileStatuses?.get(nodeProps.node.relativePath);
              return (
                <Show when={status && status !== 'none'}>
                  <span 
                    class={`save-status-indicator ${status}`}
                    title={status === 'saved' ? 'Selections saved' : 'Saving...'}
                  >
                    {status === 'saved' ? '●' : '○'}
                  </span>
                </Show>
              );
            })()}
          </Show>
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
