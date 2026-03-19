import { Index, type Component } from 'solid-js';
import { useStore } from '../../store';
import { generateSubcodeColor } from '../../utils/colors';
import { updateCodeInTree, updateCodesAtLevel } from '../../utils/codeTree';
import CodeEditor from './CodeEditor';
import type { Code } from '../../models/files';

interface CodeTreeEditorProps {
  codes: Code[];
  codebookGuid: string;
  /** GUID of the parent code, or null for top-level codes */
  parentCodeGuid: string | null;
  depth: number;
  isExpanded: (guid: string) => boolean;
  onToggleExpanded: (guid: string) => void;
  onViewSelections: (codeGuid: string) => void;
  onMerge: (sourceGuid: string) => void;
  onMove: (codeGuid: string) => void;
}

const CodeTreeEditor: Component<CodeTreeEditorProps> = (props) => {
  const { store, actions } = useStore();

  const updateCode = (codeGuid: string, updates: Partial<Code>) => {
    const cb = store.codebooks[props.codebookGuid];
    if (!cb) return;
    actions.updateCodebook({ ...cb, codes: updateCodeInTree(cb.codes, codeGuid, updates) });
  };

  const addSubcode = (parentCode: Code) => {
    const cb = store.codebooks[props.codebookGuid];
    if (!cb) return;
    const siblingIndex = (parentCode.subcodes || []).length;
    const newSubcode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Subcode',
      color: generateSubcodeColor(parentCode.color, props.depth + 1, siblingIndex),
      description: '',
      subcodes: []
    };
    actions.updateCodebook({
      ...cb,
      codes: updateCodesAtLevel(cb.codes, parentCode.guid, codes => [...codes, newSubcode]),
    });
  };

  return (
    <Index each={props.codes}>
      {(code) => (
        <CodeEditor
          code={code()}
          codebookGuid={props.codebookGuid}
          depth={props.depth}
          onMerge={props.onMerge}
          onMove={props.onMove}
          onAddSubcode={() => addSubcode(code())}
          isExpanded={props.isExpanded(code().guid)}
          onToggleExpanded={() => props.onToggleExpanded(code().guid)}
          isExpandedForCode={props.isExpanded}
          onToggleExpandedForCode={props.onToggleExpanded}
          onViewSelections={props.onViewSelections}
          onUpdateCode={updateCode}
        />
      )}
    </Index>
  );
};

export default CodeTreeEditor;
