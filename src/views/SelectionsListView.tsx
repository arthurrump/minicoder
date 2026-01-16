import type { Component } from 'solid-js';

interface SelectionsListViewProps {
  dirHandle: FileSystemDirectoryHandle;
  codebooks: Codebook[];
}

const SelectionsListView: Component<SelectionsListViewProps> = (props) => {
  return (
    <div class="view-placeholder">
      <h2>Selections by Code</h2>
      <p>View all selections grouped by code across all sources.</p>
      <p>This view is not yet implemented.</p>
    </div>
  );
};

export default SelectionsListView;
