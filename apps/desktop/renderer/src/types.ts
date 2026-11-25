import type { DesktopState } from '../../src/contracts.ts';
import type { Translate } from './words.ts';
export interface WordsProps {
  t: Translate;
}
export interface DialogProps extends WordsProps {
  onClose(): void;
}
export interface WindowProps extends WordsProps {
  state: DesktopState;
  platform: NodeJS.Platform;
}
export interface ArtifactMenu {
  id: string;
  title: string;
  x: number;
  y: number;
}
export type ArtifactAction = (act: 'reveal' | 'move' | 'relocate', id: string) => void;
export type InstallApp = (id: string, title: string) => void;
