import { UIManager } from "../UIManager";

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
    this.backdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 900;
      animation: dialogBackdropIn 0.2s ease-out;
    `;
    document.body.appendChild(this.backdrop);

    // Create dialog container
    this.element = document.createElement("div");
    this.element.id = `dialog-${this.id}`;
    this.element.className = "game-dialog";
    this.element.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${this.options.width};
      max-width: ${this.options.maxWidth};
      height: 70vh;
      max-height: 85vh;
      background: linear-gradient(180deg, #1a1a2e 0%, #16162a 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 
        0 25px 50px -12px rgba(0, 0, 0, 0.8),
        0 0 0 1px rgba(255, 255, 255, 0.05),
        0 0 80px rgba(100, 100, 255, 0.1);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: dialogSlideIn 0.25s ease-out;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    this.element.innerHTML = this.buildDialogHTML(context);
    document.body.appendChild(this.element);

    // Add animations
    this.injectStyles();

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
      <!-- Header -->
      <div class="dialog-header" style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        background: rgba(0, 0, 0, 0.3);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      ">
        <h2 style="
          margin: 0;
          font-size: 1.25rem;
          font-weight: 500;
          color: #fff;
          letter-spacing: 0.02em;
        ">${title}</h2>
        ${this.options.showCloseButton ? `
          <button id="dialog-close-${this.id}" class="dialog-close-btn" style="
            width: 32px;
            height: 32px;
            border: none;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #888;
            font-size: 1.25rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
          " aria-label="Close dialog">
            ✕
          </button>
        ` : ""}
      </div>

      <!-- Body -->
      <div class="dialog-body" style="
        padding: 20px;
        overflow-y: auto;
        color: #e0e0e0;
        line-height: 1.6;
      ">
        ${this.getBodyHTML(context)}
      </div>
    `;
  }

  private setupCloseButton(): void {
    const closeBtn = document.getElementById(`dialog-close-${this.id}`);
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
      closeBtn.addEventListener("mouseenter", () => {
        closeBtn.style.background = "rgba(255, 100, 100, 0.3)";
        closeBtn.style.color = "#ff6b6b";
      });
      closeBtn.addEventListener("mouseleave", () => {
        closeBtn.style.background = "rgba(255, 255, 255, 0.1)";
        closeBtn.style.color = "#888";
      });
    }
  }

  private handleEscape(e: KeyboardEvent): void {
    if (e.key === "Escape" && Date.now() - this.openedAt > 200) {
      this.close();
    }
  }

  private injectStyles(): void {
    if (document.getElementById("dialog-animations")) return;

    const style = document.createElement("style");
    style.id = "dialog-animations";
    style.textContent = `
      @keyframes dialogBackdropIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes dialogSlideIn {
        from {
          opacity: 0;
          transform: translate(-50%, -48%);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%);
        }
      }
      @keyframes dialogSlideOut {
        from {
          opacity: 1;
          transform: translate(-50%, -50%);
        }
        to {
          opacity: 0;
          transform: translate(-50%, -48%);
        }
      }
    `;
    document.head.appendChild(style);
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
    const isPrimary = variant === "primary";
    return `
      <button id="${id}" style="
        padding: 10px 20px;
        font-size: 0.95rem;
        font-weight: 500;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
        ${isPrimary
          ? `background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
             color: #fff;
             box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);`
          : `background: rgba(255, 255, 255, 0.1);
             color: #ccc;
             border: 1px solid rgba(255, 255, 255, 0.2);`
        }
      ">${text}</button>
    `;
  }
}
