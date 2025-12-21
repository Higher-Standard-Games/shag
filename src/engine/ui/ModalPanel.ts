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

  constructor(config: ModalConfig, callbacks: ModalCallbacks) {
    this.config = {
      width: 320,
      showClose: true,
      closeOnBackdrop: true,
      ...config,
    };
    this.callbacks = callbacks;
    
    this.backdrop = this.createBackdrop();
    this.container = this.createContainer();
    this.backdrop.appendChild(this.container);
  }

  private createBackdrop(): HTMLDivElement {
    const backdrop = document.createElement("div");
    backdrop.id = `modal-backdrop-${this.config.id}`;
    backdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 2000;
      opacity: 0;
      transition: opacity 0.2s ease;
      padding: 20px;
      box-sizing: border-box;
    `;
    
    if (this.config.closeOnBackdrop) {
      backdrop.onclick = (e) => {
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
    container.style.cssText = `
      background: #FAFAFA;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      width: 100%;
      max-width: ${this.config.width}px;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      font-family: 'Segoe UI', system-ui, sans-serif;
      border: 1px solid #E0E0E0;
      transform: scale(0.9);
      transition: transform 0.2s ease;
    `;
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
      <div class="modal-header" style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid #E0E0E0;
        background: #F5F5F5;
        border-radius: 16px 16px 0 0;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${this.config.icon ? `<span style="font-size: 24px;">${this.config.icon}</span>` : ''}
          <span class="modal-title" style="color: #333333; font-weight: 600; font-size: 22px;">${this.config.title}</span>
        </div>
        ${this.config.showClose ? `
          <button class="modal-close" style="
            background: #E8E8E8;
            border: none;
            border-bottom: 2px solid #CCCCCC;
            color: #666666;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.1s ease;
          " onmouseenter="this.style.background='#F5F5F5'"
             onmouseleave="this.style.background='#E8E8E8'">✕</button>
        ` : ''}
      </div>
    `;
  }

  private renderActions(actions: ModalAction[]): string {
    const actionButtons = actions.map(action => {
      const isPrimary = action.primary;
      const bgColor = action.disabled 
        ? '#E0E0E0' 
        : (action.color || (isPrimary ? '#4CAF50' : '#F5F5F5'));
      const borderColor = action.disabled
        ? '#CCCCCC'
        : (isPrimary ? '#3D9140' : '#CCCCCC');
      const textColor = action.disabled ? '#999999' : (isPrimary ? '#FFFFFF' : '#333333');
      const cursor = action.disabled ? 'not-allowed' : 'pointer';
      const minHeight = isPrimary ? '56px' : '48px';
      const fontSize = isPrimary ? '15px' : '14px';
      
      return `
        <button class="modal-action" data-action-id="${action.id}" style="
          background: ${bgColor};
          border: none;
          border-bottom: 3px solid ${borderColor};
          color: ${textColor};
          padding: 12px 16px;
          border-radius: 10px;
          cursor: ${cursor};
          font-size: ${fontSize};
          font-weight: 500;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          min-height: ${minHeight};
          flex: 1;
          transition: all 0.1s ease;
          opacity: ${action.disabled ? '0.6' : '1'};
          position: relative;
          top: 0;
        " ${action.disabled ? 'disabled' : ''}>
          <span style="font-size: 24px;">${action.icon}</span>
          <span>${action.label}</span>
        </button>
      `;
    }).join('');
    
    return `
      <div class="modal-actions" style="
        display: flex;
        gap: 10px;
        padding: 16px;
        border-top: 1px solid #E0E0E0;
        background: #F5F5F5;
      ">${actionButtons}</div>
    `;
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
        // Hover effects
        btn.addEventListener('mouseenter', () => {
          if (!action.disabled) {
            (btn as HTMLElement).style.filter = 'brightness(1.2)';
          }
        });
        btn.addEventListener('mouseleave', () => {
          (btn as HTMLElement).style.filter = 'brightness(1)';
        });
      }
    });
  }

  public show(): void {
    if (this.isVisible) return;
    
    if (!this.backdrop.parentElement) {
      document.body.appendChild(this.backdrop);
    }
    
    this.render();
    this.backdrop.style.display = "flex";
    
    // Trigger animation
    requestAnimationFrame(() => {
      this.backdrop.style.opacity = "1";
      this.container.style.transform = "scale(1)";
    });
    
    this.isVisible = true;
  }

  public hide(): void {
    if (!this.isVisible) return;
    
    this.backdrop.style.opacity = "0";
    this.container.style.transform = "scale(0.9)";
    
    setTimeout(() => {
      this.backdrop.style.display = "none";
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
