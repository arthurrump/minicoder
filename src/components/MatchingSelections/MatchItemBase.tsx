import { For, type JSX, type Component } from 'solid-js';
import styles from './MatchingSelections.module.css';
import ColorChip from '../ColorChip';
import type { Code, Codebook } from '../../models/files';

export interface MatchItemBaseProps {
  sourcePath: string;
  codes: { code: Code; codebook: Codebook }[];
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  charOffset?: number;
  onCodeClick?: (codeGuid: string, e: MouseEvent) => void;
  children: JSX.Element;
}

const MatchItemBase: Component<MatchItemBaseProps> = (props) => {
  return (
    <div class={styles.matchItem}>
      <div class={styles.matchHeader}>
        <span
          class={`${styles.matchSource} ${props.onOpenSource ? styles.matchSourceLink : ''}`}
          onClick={() => props.onOpenSource?.(props.sourcePath, props.charOffset ?? 0)}
          title={props.onOpenSource ? 'Open file at this position' : undefined}
        >
          {props.sourcePath}
        </span>
        <div class={styles.matchCodes}>
          <For each={props.codes}>
            {(info) => (
              <span
                class={`${styles.matchCodeTag} ${props.onCodeClick ? styles.matchCodeTagClickable : ''}`}
                onClick={(e: MouseEvent) => props.onCodeClick?.(info.code.guid, e)}
              >
                <ColorChip color={info.code.color} class={styles.codeChip} />
                <span>{info.code.name}</span>
              </span>
            )}
          </For>
        </div>
      </div>
      {props.children}
    </div>
  );
};

export default MatchItemBase;
