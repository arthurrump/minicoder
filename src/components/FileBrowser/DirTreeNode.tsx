import { createSignal, For, Show } from 'solid-js';
import styles from './FileBrowser.module.css';

export interface DirNode {
  name: string;
  relativePath: string;
  handle: FileSystemDirectoryHandle;
}

function DirTreeNode(nodeProps: {
  node: DirNode;
  depth: number;
  selectedDir: string;
  onSelect: (dir: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [children, setChildren] = createSignal<DirNode[]>([]);
  const [loaded, setLoaded] = createSignal(false);

  async function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (!loaded()) {
      const dirs: DirNode[] = [];
      for await (const entry of nodeProps.node.handle.values()) {
        if (entry.kind === 'directory') {
          const relativePath = `${nodeProps.node.relativePath}/${entry.name}`;
          dirs.push({ name: entry.name, relativePath, handle: entry as FileSystemDirectoryHandle });
        }
      }
      setChildren(dirs.sort((a, b) => a.name.localeCompare(b.name)));
      setLoaded(true);
    }
    setExpanded(!expanded());
  }

  function select() {
    nodeProps.onSelect(nodeProps.node.relativePath);
  }

  return (
    <div>
      <div
        class={styles.dirNode}
        classList={{ [styles.dirNodeSelected]: nodeProps.selectedDir === nodeProps.node.relativePath }}
        style={{ "padding-left": `${nodeProps.depth * 16 + 6}px` }}
        onClick={select}
      >
        <span class={styles.dirToggle} onClick={(e) => { void toggle(e); }}>
          {expanded() ? '▼' : '▶'}
        </span>
        <span>{nodeProps.node.name}</span>
      </div>
      <Show when={expanded()}>
        <For each={children()}>
          {(child) => (
            <DirTreeNode
              node={child}
              depth={nodeProps.depth + 1}
              selectedDir={nodeProps.selectedDir}
              onSelect={nodeProps.onSelect}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

export default DirTreeNode;
