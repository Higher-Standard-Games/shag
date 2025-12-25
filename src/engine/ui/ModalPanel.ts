/**
 * ModalPanel - Generic centered modal panel (Engine Component)
 * 
 * A reusable modal that appears centered on screen with backdrop.
 * Designed for mobile-first with large touch targets.
 * Game code provides content via callbacks.
 * 
 * Features:
 * - Centered with responsive width
 * - Dimmed backdrop (click to close)
 * - Large touch-friendly buttons
 * - Customizable via callbacks
 * - Smooth animations
 */

import { UIStyles } from "./UIStyles";
import modalPanelCSS from "./styles/ModalPanel.css?raw";

export interface ModalAction {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;    // Primary action (larger, highlighted)
  color?: string;       // Custom button color
}

export interface ModalConfig {
  id: string;
  title: string;
  icon?: string;
  width?: number;       // Max width in pixels (default: 320)
  showClose?: boolean;  // Show X button (default: true)
  closeOnBackdrop?: boolean;  // Close when clicking backdrop (default: true)
}

export interface ModalCallbacks {
  onClose?: () => void;
  renderContent: () => string;  // Returns HTML for modal body
  getActions?: () => ModalAction[];
  renderHeader?: () => string;  // Custom header HTML (optional)
}

export class ModalPanel {
  private backdrop: HTMLDivElement;
  private container: HTMLDivElement;
  private config: ModalConfig;
  private callbacks: ModalCallbacks;
  private isVisible: boolean = false;
  private canCloseOnBackdrop: boolean = false; // Prevents immediate close on touch devices

  constructor(config: ModalConfig, callbacks: ModalCallbacks) {
    this.config = {
      width: 320,
      showClose: true,
      closeOnBackdrop: true,
      ...config,
    };
    this.callbacks = callbacks;
    
    // Inject styles once
    UIStyles.injectCSS("modal-panel", modalPanelCSS);
    
    this.backdrop = this.createBackdrop();
    this.container = this.createContainer();
    this.backdrop.appendChild(this.container);
  }

  private createBackdrop(): HTMLDivElement {
    const backdrop = document.createElement("div");
    backdrop.id = `modal-backdrop-${this.config.id}`;
    backdrop.className = "modal-backdrop";
    
    if (this.config.closeOnBackdrop) {
      backdrop.onclick = (e) => {
        // Prevent immediate close on touch devices - the touch that opened
        // the modal can also trigger backdrop click
        if (!this.canCloseOnBackdrop) return;
        if (e.target === backdrop) {
          this.hide();
        }
      };
    }
    
    return backdrop;
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.id = `modal-${this.config.id}`;
    container.className = "modal-container";
    container.style.maxWidth = `${this.config.width}px`;
    return container;
  }

  public render(): void {
    let html = "";
    
    // Header
    html += this.renderHeader();
    
    // Content
    html += `<div class="modal-content" style="
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    ">${this.callbacks.renderContent()}</div>`;
    
    // Actions
    const actions = this.callbacks.getActions?.() ?? [];
    if (actions.length > 0) {
      html += this.renderActions(actions);
    }
    
    this.container.innerHTML = html;
    this.attachActionHandlers(actions);
  }

  private renderHeader(): string {
    if (this.callbacks.renderHeader) {
      return this.callbacks.renderHeader();
    }
    
    return `
      <div class="modal-header">
        <div class="modal-header-left">
          ${this.config.icon ? `<span class="modal-header-icon">${this.config.icon}</span>` : ''}
          <span class="modal-title">${this.config.title}</span>
        </div>
        ${this.config.showClose ? `<button class="modal-close">✕</button>` : ''}
      </div>
    `;
  }

  private renderActions(actions: ModalAction[]): string {
    const actionButtons = actions.map(action => {
      const classes = ['modal-action'];
      if (action.primary) classes.push('primary');
      if (action.disabled) classes.push('disabled');
      
      // Custom color via CSS variable
      const customStyle = action.color && !action.disabled 
        ? `style="--action-color: ${action.color}; background: ${action.color};"` 
        : '';
      
      return `
        <button class="${classes.join(' ')}" data-action-id="${action.id}" ${customStyle} ${action.disabled ? 'disabled' : ''}>
          <span class="modal-action-icon">${action.icon}</span>
          <span>${action.label}</span>
        </button>
      `;
    }).join('');
    
    return `<div class="modal-actions">${actionButtons}</div>`;
  }

  private attachActionHandlers(actions: ModalAction[]): void {
    // Close button
    const closeBtn = this.container.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }
    
    // Action buttons
    actions.forEach(action => {
      if (action.disabled) return;
      const btn = this.container.querySelector(`[data-action-id="${action.id}"]`);
      if (btn) {
        btn.addEventListener('click', () => action.onClick());
      }
    });
  }

  public show(): void {
    if (this.isVisible) return;
    
    if (!this.backdrop.parentElement) {
      document.body.appendChild(this.backdrop);
    }
    
    this.render();
    
    // Trigger animation
    requestAnimationFrame(() => {
      this.backdrop.classList.add("visible");
    });
    
    this.isVisible = true;
    
    // Delay enabling backdrop close to prevent touch event from immediately closing
    this.canCloseOnBackdrop = false;
    setTimeout(() => {
      this.canCloseOnBackdrop = true;
    }, 300);
  }

  public hide(): void {
    if (!this.isVisible) return;
    
    this.backdrop.classList.remove("visible");
    
    setTimeout(() => {
      this.callbacks.onClose?.();
    }, 200);
    
    this.isVisible = false;
  }

  public refresh(): void {
    this.render();
  }

  public destroy(): void {
    this.backdrop.remove();
  }

  public isShowing(): boolean {
    return this.isVisible;
  }

  public setTitle(title: string): void {
    this.config.title = title;
    if (this.isVisible) {
      this.render();
    }
  }
}
