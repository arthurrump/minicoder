import { createMemo, createSignal, Show, type Component } from 'solid-js';
import { useStore } from '../../store';
import styles from './MatchingSelections.module.css';
import MatchItemBase from './MatchItemBase';
import SourceCodePopover from '../SourceCodesBar/SourceCodePopover';
import type { AppliedCode, Code, Codebook } from '../../models/files';

export interface FileMatchItemProps {
  sourcePath: string;
  sourceCodes: AppliedCode[];
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
}

const FileMatchItem: Component<FileMatchItemProps> = (props) => {
  const { indices } = useStore();
  const [popover, setPopover] = createSignal<{ appliedCode: AppliedCode; x: number; y: number } | null>(null);

  const resolvedCodes = createMemo(() => {
    const idx = indices.codeByGuid();
    const result: { code: Code; codebook: Codebook }[] = [];
    for (const sc of props.sourceCodes) {
      const info = idx[sc.code.codeGuid];
      if (info) result.push(info);
    }
    return result;
  });

  const handleCodeClick = (codeGuid: string, e: MouseEvent) => {
    const ac = props.sourceCodes.find(sc => sc.code.codeGuid === codeGuid);
    if (ac) {
      setPopover({ appliedCode: ac, x: e.clientX, y: e.clientY });
    }
  };

  const handleClosePopover = () => setPopover(null);

  return (
    <>
      <MatchItemBase
        sourcePath={props.sourcePath}
        codes={resolvedCodes()}
        onOpenSource={props.onOpenSource}
        onCodeClick={handleCodeClick}
      >
        <span class={styles.fileMatchLabel}>Full file match</span>
      </MatchItemBase>
      <Show when={popover()}>
        {(p) => (
          <SourceCodePopover
            sourcePath={props.sourcePath}
            appliedCode={p().appliedCode}
            x={p().x}
            y={p().y}
            onClose={handleClosePopover}
          />
        )}
      </Show>
    </>
  );
};

export default FileMatchItem;
