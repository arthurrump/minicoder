import { createEffect, createSignal, For } from 'solid-js';
import DirTreeNode, { type DirNode } from './DirTreeNode';
import styles from './FileBrowser.module.css';

/** Lazy-loading tree view for picking a directory */
function DirTreePicker(pickerProps: {
  dirHandle: FileSystemDirectoryHandle;
  selectedDir: string;
  onSelect: (dir: string) => void;
}) {
  const [rootChildren, setRootChildren] = createSignal<DirNode[]>([]);

  createEffect(() => {
    const handle = pickerProps.dirHandle;
    void (async () => {
      const dirs: DirNode[] = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'directory') {
          dirs.push({ name: entry.name, relativePath: entry.name, handle: entry as FileSystemDirectoryHandle });
        }
      }
      setRootChildren(dirs.sort((a, b) => a.name.localeCompare(b.name)));
    })();
  });

  return (
    <div>
      <div
        class={styles.dirNode}
        classList={{ [styles.dirNodeSelected]: pickerProps.selectedDir === '' }}
        onClick={() => pickerProps.onSelect('')}
      >
        <span class={styles.dirToggle} />
        <span>/</span>
      </div>
      <For each={rootChildren()}>
        {(node) => (
          <DirTreeNode
            node={node}
            depth={1}
            selectedDir={pickerProps.selectedDir}
            onSelect={pickerProps.onSelect}
          />
        )}
      </For>
    </div>
  );
}

export default DirTreePicker;
