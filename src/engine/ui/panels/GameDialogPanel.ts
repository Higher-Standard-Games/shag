/**
 * GameDialogPanel - compact modal panel for in-engine UI flows.
 *
 * Use this for pause menus, confirmations, and other focused UI that should
 * sit over gameplay without taking over the whole screen like GamePanel.
 */
export interface GameDialogPanelOptions {
  title: string;
  extraClass?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
}

export class GameDialogPanel {
  protected backdrop: HTMLElement;
  protected dialog: HTMLElement;
  protected headerEl: HTMLElement;
  protected titleEl: HTMLElement;
  protected bodyEl: HTMLElement;
  protected footerEl: HTMLElement;

  private visible: boolean = false;
  private readonly closeOnEscape: boolean;
  private onCloseCallback: (() => void) | null = null;
  private escHandler: (e: KeyboardEvent) => void;

  constructor(options: GameDialogPanelOptions) {
    const {
      title,
      extraClass = "",
      closeOnBackdrop = true,
      closeOnEscape = true,
      showCloseButton = true,
    } = options;

    this.closeOnEscape = closeOnEscape;

    this.backdrop = document.createElement("div");
    this.backdrop.className = `game-dialog-backdrop fps-dialog-backdrop ${extraClass}`.trim();
    this.backdrop.style.display = "none";
    if (closeOnBackdrop) {
      this.backdrop.addEventListener("click", (e) => {
        if (e.target === this.backdrop) this.close();
      });
    }

    this.dialog = document.createElement("div");
    this.dialog.className = "game-dialog fps-dialog manga-panel";

    const corners = document.createElement("div");
    corners.className = "manga-panel-corners";
    this.dialog.appendChild(corners);

    this.headerEl = document.createElement("div");
    this.headerEl.className = "game-dialog__header fps-dialog-header";

    this.titleEl = document.createElement("span");
    this.titleEl.className = "game-dialog__title fps-dialog-title";
    this.titleEl.textContent = title;
    this.headerEl.appendChild(this.titleEl);

    if (showCloseButton) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "game-dialog__close fps-dialog-close";
      closeBtn.type = "button";
      closeBtn.textContent = "X";
      closeBtn.addEventListener("click", () => this.close());
      this.headerEl.appendChild(closeBtn);
    }

    this.dialog.appendChild(this.headerEl);

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "game-dialog__body fps-dialog-body";
    this.dialog.appendChild(this.bodyEl);

    this.footerEl = document.createElement("div");
    this.footerEl.className = "game-dialog__footer fps-dialog-footer";
    this.dialog.appendChild(this.footerEl);

    this.backdrop.appendChild(this.dialog);
    document.body.appendChild(this.backdrop);

    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.visible && this.closeOnEscape) {
        this.close();
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }

  public onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  public open(): void {
    if (this.visible) return;
    this.visible = true;
    this.backdrop.style.display = "";
    document.addEventListener("keydown", this.escHandler, true);
  }

  public close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.backdrop.style.display = "none";
    document.removeEventListener("keydown", this.escHandler, true);
    this.onCloseCallback?.();
  }

  public isOpen(): boolean {
    return this.visible;
  }

  public setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  protected setContent(element: HTMLElement): void {
    this.bodyEl.innerHTML = "";
    this.bodyEl.appendChild(element);
  }

  protected createButton(text: string, variant: string = "", onClick?: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `fps-btn ${variant}`.trim();
    btn.type = "button";
    btn.textContent = text;
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  public destroy(): void {
    document.removeEventListener("keydown", this.escHandler, true);
    this.backdrop.remove();
  }
}
