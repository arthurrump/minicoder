import type { Component } from 'solid-js';

interface CodebookEditorViewProps {
  dirHandle: FileSystemDirectoryHandle;
  codebooks: Codebook[];
  onCodebooksChange: () => void;
}

const CodebookEditorView: Component<CodebookEditorViewProps> = (props) => {
  return (
    <div class="view-placeholder">
      <h2>Codebook Editor</h2>
      <p>Edit and manage your codebooks here.</p>
      <p>This view is not yet implemented.</p>
    </div>
  );
};

export default CodebookEditorView;
