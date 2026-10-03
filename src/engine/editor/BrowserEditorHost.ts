import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { EditorLauncher, EditorStatus } from "./EditorLauncher";
import { EditorSession } from "./EditorSession";
import { ShaggedApi } from "./ShaggedApi";

/** Owns the reversible game/editor handoff; the app keeps one render loop. */
export class BrowserEditorHost implements EditorLauncher {
  private session: EditorSession | null = null;
  private restoreGame: (() => void) | null = null;

  constructor(
    private readonly engine: AbstractEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly canOpen: () => boolean,
    private readonly suspendGame: () => () => void,
  ) {}

  status(): EditorStatus {
    return this.session
      ? { open: true, draftId: this.session.draftId, revision: this.session.revision }
      : { open: false };
  }

  async open(): Promise<EditorStatus> {
    if (this.session) {
      this.session.root.focus();
      return this.status();
    }
    if (!this.canOpen()) throw new Error("Finish the active match and return to the lobby first");
    const restore = this.suspendGame();
    try {
      this.session = new EditorSession(
        this.engine,
        this.canvas,
        () => {
          void this.close().catch((error) => {
            this.session?.showError(`Exit failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        },
        new ShaggedApi(),
      );
      this.restoreGame = restore;
      return this.status();
    } catch (error) {
      restore();
      throw error;
    }
  }

  async close(): Promise<EditorStatus> {
    if (!this.session) return this.status();
    this.session.save();
    this.session.dispose();
    this.session = null;
    this.restoreGame?.();
    this.restoreGame = null;
    return this.status();
  }

  renderEditor(): boolean {
    if (!this.session) return false;
    this.session.render();
    return true;
  }
}
