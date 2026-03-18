import { Index, type Component } from 'solid-js';
import { generateSubcodeColor } from '../../utils/colors';
import CodeEditor from './CodeEditor';

interface CodeTreeEditorProps {
  codes: Code[];
  codebookGuid: string;
  onCodesChange: (codes: Code[]) => void;
  onDelete: (codeGuid: string) => void;
  depth: number;
  isExpanded: (guid: string) => boolean;
  onToggleExpanded: (guid: string) => void;
  onViewSelections: (codeGuid: string) => void;
  onMerge: (sourceGuid: string) => void;
  onMove: (codeGuid: string) => void;
  getSelectionCount: (codeGuid: string) => number;
}

const CodeTreeEditor: Component<CodeTreeEditorProps> = (props) => {
  const updateCode = (index: number, updates: Partial<Code>) => {
    const newCodes = [...props.codes];
    newCodes[index] = { ...newCodes[index], ...updates };
    props.onCodesChange(newCodes);
  };

  const deleteCode = (codeGuid: string) => {
    props.onDelete(codeGuid);
  };

  const addSubcode = (index: number) => {
    const newCodes = [...props.codes];
    const parentCode = newCodes[index];
    const siblingIndex = (parentCode.subcodes || []).length;
    const newSubcode: Code = {
      guid: crypto.randomUUID(),
      name: 'New Subcode',
      color: generateSubcodeColor(parentCode.color, props.depth + 1, siblingIndex),
      description: '',
      subcodes: []
    };
    newCodes[index] = {
      ...parentCode,
      subcodes: [...(parentCode.subcodes || []), newSubcode]
    };
    props.onCodesChange(newCodes);
  };

  const updateSubcodes = (index: number, subcodes: Code[]) => {
    const newCodes = [...props.codes];
    newCodes[index] = { ...newCodes[index], subcodes };
    props.onCodesChange(newCodes);
  };

  return (
    <Index each={props.codes}>
      {(code, index) => (
        <CodeEditor
          code={code()}
          codebookGuid={props.codebookGuid}
          depth={props.depth}
          onUpdate={(updates) => updateCode(index, updates)}
          onDelete={(codeGuid) => deleteCode(codeGuid)}
          onMerge={props.onMerge}
          onMove={props.onMove}
          onAddSubcode={() => addSubcode(index)}
          onSubcodesChange={(subcodes) => updateSubcodes(index, subcodes)}
          isExpanded={props.isExpanded(code().guid)}
          onToggleExpanded={() => props.onToggleExpanded(code().guid)}
          isExpandedForCode={props.isExpanded}
          onToggleExpandedForCode={props.onToggleExpanded}
          onViewSelections={props.onViewSelections}
          getSelectionCount={props.getSelectionCount}
        />
      )}
    </Index>
  );
};

export default CodeTreeEditor;
