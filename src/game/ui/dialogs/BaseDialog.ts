import { UIManager } from "../UIManager";
import { UIStyles } from "../../../engine/ui/UIStyles";
import baseDialogCSS from "./styles/BaseDialog.css?raw";

export interface DialogContext {
  message?: string;
  [key: string]: unknown;
}

export interface DialogOptions {
  title: string;
  width?: string;
  maxWidth?: string;
  showCloseButton?: boolean;
}

/**
 * Base dialog class with beautiful styling.
 * Provides backdrop blur, drop shadow, and standard header with close button.
 */
export abstract class BaseDialog {
  protected element: HTMLElement | null = null;
  protected backdrop: HTMLElement | null = null;
  protected options: DialogOptions;
  private openedAt: number = 0;

  constructor(public id: string, options: Partial<DialogOptions> = {}) {
    this.options = {
      title: options.title || "Dialog",
      width: options.width || "70vw",
      maxWidth: options.maxWidth || "90vw",
      showCloseButton: options.showCloseButton !== false,
    };
    
    // Inject styles once
    UIStyles.injectCSS("base-dialog", baseDialogCSS);
  }

  /**
   * Override this to provide dialog body content.
   * Do NOT include the header or close button - those are handled by BaseDialog.
   */
  public abstract getBodyHTML(context: DialogContext): string;

  /**
   * Override to customize the title per-context.
   */
  protected getTitle(context: DialogContext): string {
    return (context.title as string) || this.options.title;
  }

  public show(context: DialogContext): void {
    if (this.element) return; // Already open

    // Create backdrop with blur
    this.backdrop = document.createElement("div");
    this.backdrop.className = "dialog-backdrop";
    document.body.appendChild(this.backdrop);

    // Create dialog container
    this.element = document.createElement("div");
    this.element.id = `dialog-${this.id}`;
    this.element.className = "game-dialog";
    this.element.style.width = this.options.width || "70vw";
    this.element.style.maxWidth = this.options.maxWidth || "90vw";

    this.element.innerHTML = this.buildDialogHTML(context);
    document.body.appendChild(this.element);

    // Setup close button
    this.setupCloseButton();

    // Track when dialog opened to prevent immediate close from trigger click
    this.openedAt = Date.now();

    // Close on backdrop click (ignore clicks within 200ms of opening)
    this.backdrop.addEventListener("mousedown", (e) => {
      if (Date.now() - this.openedAt > 200 && e.target === this.backdrop) {
        this.close();
      }
    });

    // Prevent clicks inside dialog from closing it
    this.element.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    // Close on Escape key
    this.handleEscape = this.handleEscape.bind(this);
    document.addEventListener("keydown", this.handleEscape);

    this.onOpen(context);
  }

  private buildDialogHTML(context: DialogContext): string {
    const title = this.getTitle(context);

    return `
      <div class="dialog-header">
        <h2 class="dialog-title">${title}</h2>
        ${this.options.showCloseButton ? `
          <button id="dialog-close-${this.id}" class="dialog-close-btn" aria-label="Close dialog">✕</button>
        ` : ""}
      </div>
      <div class="dialog-body">
        ${this.getBodyHTML(context)}
      </div>
    `;
  }

  private setupCloseButton(): void {
    const closeBtn = document.getElementById(`dialog-close-${this.id}`);
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
  }

  private handleEscape(e: KeyboardEvent): void {
    if (e.key === "Escape" && Date.now() - this.openedAt > 200) {
      this.close();
    }
  }

  public close(): void {
    UIManager.getInstance().closeDialog(this.id);
  }

  public hide(): void {
    document.removeEventListener("keydown", this.handleEscape);

    if (this.element) {
      this.element.style.animation = "dialogSlideOut 0.15s ease-in forwards";
    }
    if (this.backdrop) {
      this.backdrop.style.opacity = "0";
      this.backdrop.style.transition = "opacity 0.15s ease";
    }

    setTimeout(() => {
      this.element?.remove();
      this.backdrop?.remove();
      this.element = null;
      this.backdrop = null;
      this.onClose();
    }, 150);
  }

  protected onOpen(_context: DialogContext): void {}
  protected onClose(): void {}

  /**
   * Helper to create styled buttons for dialog content.
   */
  protected createButton(
    id: string,
    text: string,
    variant: "primary" | "secondary" = "primary"
  ): string {
    return `<button id="${id}" class="dialog-btn ${variant}">${text}</button>`;
  }
}
