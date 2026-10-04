/** Browser composition hook. The auto-discovered command remains headless-safe. */
export const PLAYTEST_RETURN_KEY = "shagged:return-playtest";
export interface EditorStatus {
  open: boolean;
  draftId?: string;
  revision?: number;
}

export interface EditorLauncher {
  open(): Promise<EditorStatus>;
  close(): Promise<EditorStatus>;
  returnToEditor?(): Promise<EditorStatus>;
  status(): EditorStatus;
}

let launcher: EditorLauncher | null = null;
export function registerEditorLauncher(value: EditorLauncher | null): void {
  launcher = value;
}
export function getEditorLauncher(): EditorLauncher | null {
  return launcher;
}
