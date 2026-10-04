import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { getGameplayMapLauncher } from "../console/GameplayMapLauncher";
import { type EditorLauncher, type EditorStatus, PLAYTEST_RETURN_KEY } from "./EditorLauncher";
import { EditorSession } from "./EditorSession";
import { preparePublishedMap } from "./PublishedMapClient";
import { type EditorCompileJob, ShaggedApi } from "./ShaggedApi";

/** Owns the reversible game/editor handoff; the app keeps one render loop. */
export class BrowserEditorHost implements EditorLauncher {
  private session: EditorSession | null = null;
  private restoreGame: (() => void) | null = null;
  private playtestInProgress = false;

  constructor(
    private readonly engine: AbstractEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly canOpen: () => boolean,
    private readonly suspendGame: () => () => void,
    private readonly recoverLobby?: () => void,
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
        (job) => this.playtest(job),
      );
      this.restoreGame = restore;
      return this.status();
    } catch (error) {
      restore();
      throw error;
    }
  }

  async playtest(job: EditorCompileJob): Promise<void> {
    if (this.playtestInProgress) throw new Error("Playtest is already starting");
    if (!this.session || !job.runtimeMapName || !job.packageName || !job.bspHash)
      throw new Error("This build is not ready for Playtest");
    this.playtestInProgress = true;
    try {
      const build = await preparePublishedMap(job.runtimeMapName, job.id);
      if (!build || build.package !== job.packageName || build.bspHash !== job.bspHash)
        throw new Error(`Published build changed for ${job.runtimeMapName}`);
      const launcher = getGameplayMapLauncher();
      if (!launcher) throw new Error("Gameplay map launcher is unavailable");
      sessionStorage.setItem(PLAYTEST_RETURN_KEY, this.session.draftId);
      try {
        await this.close();
      } catch (error) {
        sessionStorage.removeItem(PLAYTEST_RETURN_KEY);
        throw error;
      }
      try {
        await launcher.launch(job.runtimeMapName, "duel");
        const current = await fetch(`data/shagged_${job.runtimeMapName}.json`, { cache: "no-store" });
        if (!current.ok || ((await current.json()) as { buildId?: string }).buildId !== job.id)
          throw new Error("Published build changed while the playtest server was starting");
      } catch (error) {
        try {
          await launcher.unload();
        } catch (cleanupError) {
          console.warn("Playtest cleanup failed:", cleanupError);
        }
        sessionStorage.removeItem(PLAYTEST_RETURN_KEY);
        this.recoverLobby?.();
        await this.open();
        this.session?.showError(error instanceof Error ? error.message : String(error));
        throw error;
      }
    } finally {
      this.playtestInProgress = false;
    }
  }

  async returnToEditor(): Promise<EditorStatus> {
    if (!sessionStorage.getItem(PLAYTEST_RETURN_KEY)) throw new Error("No editor playtest to return to");
    window.location.reload();
    return { open: false };
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
