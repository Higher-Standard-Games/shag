/**
 * DebugConsole - Quake-style dropdown debug console
 * 
 * Engine-level debugging console that opens with tilde key.
 * Features:
 * - Command history with up/down arrows
 * - Tab autocomplete
 * - Captures console.log output
 * - Persists history to localStorage
 */

import { ConsoleCommandRegistry } from './ConsoleCommandRegistry';
import { EngineVersion } from '../core/EngineVersion';
import './debug-console.css';

const HISTORY_KEY = 'debug_console_history';
const CONSOLE_SIZE_KEY = 'debug_console_size';
const MAX_HISTORY = 100;
const MAX_OUTPUT_LINES = 500;
const DEFAULT_CONSOLE_SIZE = 0.5; // 0.5 = half screen, 1.0 = full screen

export class DebugConsole {
  private static instance: DebugConsole;
  
  private enabled: boolean = false;
  private isOpen: boolean = false;
  private consoleSize: number = DEFAULT_CONSOLE_SIZE;
  
  // DOM elements
  private container: HTMLDivElement | null = null;
  private outputEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private autocompleteEl: HTMLDivElement | null = null;
  
  // State
  private commandHistory: string[] = [];
  private historyIndex: number = -1;
  private currentInput: string = '';
  // private outputLines: string[] = []; // Reserved for future use
  private autocompleteItems: string[] = [];
  private autocompleteIndex: number = -1;
  
  // Original console methods
  private originalLog: typeof console.log;
  private originalWarn: typeof console.warn;
  private originalError: typeof console.error;
  private originalInfo: typeof console.info;
  
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private constructor() {
    // Store original console methods
    this.originalLog = console.log.bind(console);
    this.originalWarn = console.warn.bind(console);
    this.originalError = console.error.bind(console);
    this.originalInfo = console.info.bind(console);
    
    this.loadHistory();
    this.loadConsoleSize();
  }

  static getInstance(): DebugConsole {
    if (!DebugConsole.instance) {
      DebugConsole.instance = new DebugConsole();
    }
    return DebugConsole.instance;
  }

  /**
   * Enable the debug console (call once at startup)
   */
  enable(): void {
    if (this.enabled) return;
    
    // Only enable on desktop (check for touch)
    if (this.isMobileDevice()) {
      this.originalLog('[DebugConsole] Disabled on mobile devices');
      return;
    }
    
    this.enabled = true;
    this.createDOM();
    this.setupKeyboardHandler();
    this.interceptConsoleLogs();
    this.registerBuiltinCommands();
    
    this.log('system', 'Debug console enabled. Press ~ to toggle.');
  }

  /**
   * Disable the debug console
   */
  disable(): void {
    if (!this.enabled) return;
    
    this.enabled = false;
    this.restoreConsoleLogs();
    this.removeKeyboardHandler();
    this.destroyDOM();
  }

  /**
   * Check if running on mobile
   */
  private isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  }

  /**
   * Toggle console visibility
   */
  toggle(): void {
    if (!this.enabled) return;

    this.isOpen = !this.isOpen;

    if (this.container) {
      this.container.classList.toggle('open', this.isOpen);
    }

    if (this.isOpen) {
      // Opening console - release input grabs and dismiss loading screen
      this.onConsoleOpen();
      this.inputEl?.focus();
    } else {
      this.inputEl?.blur();
      this.hideAutocomplete();
    }
  }

  /**
   * Called when console opens - handles input release and loading screen dismiss
   */
  private onConsoleOpen(): void {
    // Release pointer lock so user can type freely
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Dismiss loading screen if waiting for ready
    // Use dynamic import to avoid circular dependency
    import('../ui/LoadingScreen').then(({ LoadingScreen }) => {
      if (LoadingScreen.isWaitingForReady()) {
        LoadingScreen.forceDismiss();
      }
    }).catch(() => {
      // Ignore import errors (loading screen may not be available)
    });
  }

  /**
   * Open the console
   */
  open(): void {
    if (!this.enabled || this.isOpen) return;
    this.toggle();
  }

  /**
   * Close the console
   */
  close(): void {
    if (!this.enabled || !this.isOpen) return;
    this.toggle();
  }

  /**
   * Check if console is currently open
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }

  // ============================================================================
  // DOM Creation
  // ============================================================================

  private createDOM(): void {
    // Main container
    this.container = document.createElement('div');
    this.container.className = 'debug-console';
    this.container.innerHTML = `
      <div class="debug-console-header">
        <span class="debug-console-title">Engine Console</span>
        <span class="debug-console-version">${EngineVersion.getInstance().getVersionString()}</span>
      </div>
      <div class="debug-console-output"></div>
      <div class="debug-console-input-container">
        <span class="debug-console-prompt">></span>
        <input type="text" class="debug-console-input" placeholder="Type a command... (Tab for autocomplete)" spellcheck="false" autocomplete="off">
        <div class="debug-console-autocomplete"></div>
      </div>
    `;
    
    document.body.appendChild(this.container);
    
    // Get references
    this.outputEl = this.container.querySelector('.debug-console-output');
    this.inputEl = this.container.querySelector('.debug-console-input');
    this.autocompleteEl = this.container.querySelector('.debug-console-autocomplete');
    
    // Setup input handlers
    this.inputEl?.addEventListener('keydown', (e) => this.handleInputKeydown(e));
    this.inputEl?.addEventListener('input', () => this.handleInputChange());
    
    // Apply saved console size
    this.applyConsoleSize();
  }

  private destroyDOM(): void {
    this.container?.remove();
    this.container = null;
    this.outputEl = null;
    this.inputEl = null;
    this.autocompleteEl = null;
  }

  // ============================================================================
  // Keyboard Handling
  // ============================================================================

  private setupKeyboardHandler(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Tilde key (` or ~) - toggle console
      if (e.key === '`' || e.key === '~' || e.code === 'Backquote') {
        // Don't toggle if typing in an input (unless it's our console input)
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          if (target !== this.inputEl) return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      }
      
      // Escape - close console
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    };
    
    document.addEventListener('keydown', this.keyHandler, true);
  }

  private removeKeyboardHandler(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this.executeCurrentInput();
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        this.navigateHistory(1);  // Go to older commands
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        this.navigateHistory(-1);  // Go to newer commands
        break;
        
      case 'Tab':
        e.preventDefault();
        this.handleTabComplete();
        break;
        
      case 'Escape':
        if (this.autocompleteItems.length > 0) {
          e.preventDefault();
          this.hideAutocomplete();
        }
        break;
    }
  }

  private handleInputChange(): void {
    const value = this.inputEl?.value || '';
    this.currentInput = value;
    this.updateAutocomplete(value);
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  private async executeCurrentInput(): Promise<void> {
    const input = this.inputEl?.value.trim() || '';
    if (!input) return;
    
    // Add to history
    this.addToHistory(input);
    
    // Clear input
    if (this.inputEl) {
      this.inputEl.value = '';
    }
    this.historyIndex = -1;
    this.currentInput = '';
    this.hideAutocomplete();
    
    // Log the command
    this.log('command', input);
    
    // Execute
    const registry = ConsoleCommandRegistry.getInstance();
    const result = await registry.execute(input);
    
    if (result) {
      this.log('result', result);
    }
  }

  // ============================================================================
  // History
  // ============================================================================

  private addToHistory(command: string): void {
    // Don't add duplicates of the last command
    if (this.commandHistory[0] === command) return;
    
    this.commandHistory.unshift(command);
    
    // Limit history size
    if (this.commandHistory.length > MAX_HISTORY) {
      this.commandHistory.pop();
    }
    
    this.saveHistory();
  }

  private navigateHistory(direction: number): void {
    if (this.commandHistory.length === 0) return;
    
    // Save current input if starting to navigate (going up from fresh input)
    if (this.historyIndex === -1 && direction === 1) {
      this.currentInput = this.inputEl?.value || '';
    }
    
    // direction: 1 = up (older), -1 = down (newer)
    this.historyIndex += direction;
    
    // Clamp: -1 means current input, 0+ means history
    if (this.historyIndex < -1) {
      this.historyIndex = -1;
    } else if (this.historyIndex >= this.commandHistory.length) {
      this.historyIndex = this.commandHistory.length - 1;
    }
    
    // Set input value
    if (this.inputEl) {
      if (this.historyIndex === -1) {
        this.inputEl.value = this.currentInput;
      } else {
        this.inputEl.value = this.commandHistory[this.historyIndex];
      }
      // Move cursor to end
      this.inputEl.selectionStart = this.inputEl.selectionEnd = this.inputEl.value.length;
    }
  }

  private loadHistory(): void {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        this.commandHistory = JSON.parse(saved);
      }
    } catch {
      this.commandHistory = [];
    }
  }

  private saveHistory(): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.commandHistory));
    } catch {
      // Ignore storage errors
    }
  }

  // ============================================================================
  // Console Size (con_size)
  // ============================================================================

  private loadConsoleSize(): void {
    try {
      const saved = localStorage.getItem(CONSOLE_SIZE_KEY);
      if (saved) {
        const size = parseFloat(saved);
        if (!isNaN(size) && size >= 0.1 && size <= 1.0) {
          this.consoleSize = size;
        }
      }
    } catch {
      this.consoleSize = DEFAULT_CONSOLE_SIZE;
    }
  }

  private saveConsoleSize(): void {
    try {
      localStorage.setItem(CONSOLE_SIZE_KEY, this.consoleSize.toString());
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Set console size (0.1 to 1.0, where 1.0 = full screen height)
   */
  setSize(size: number): string {
    if (size < 0.1 || size > 1.0) {
      return `Invalid size: ${size}. Must be between 0.1 and 1.0`;
    }
    
    this.consoleSize = size;
    this.saveConsoleSize();
    this.applyConsoleSize();
    
    return `Console size set to ${(size * 100).toFixed(0)}%`;
  }

  /**
   * Get current console size
   */
  getSize(): number {
    return this.consoleSize;
  }

  /**
   * Apply console size to DOM
   */
  private applyConsoleSize(): void {
    if (!this.container) return;
    
    const heightPercent = this.consoleSize * 100;
    this.container.style.height = `${heightPercent}%`;
    this.container.style.maxHeight = this.consoleSize >= 1.0 ? '100%' : `${heightPercent}vh`;
  }

  // ============================================================================
  // Autocomplete
  // ============================================================================

  private updateAutocomplete(input: string): void {
    if (!input) {
      this.hideAutocomplete();
      return;
    }
    
    const registry = ConsoleCommandRegistry.getInstance();
    this.autocompleteItems = registry.getAutocompleteSuggestions(input);
    this.autocompleteIndex = -1;
    
    if (this.autocompleteItems.length === 0) {
      this.hideAutocomplete();
      return;
    }
    
    this.showAutocomplete();
  }

  private showAutocomplete(): void {
    if (!this.autocompleteEl) return;
    
    const registry = ConsoleCommandRegistry.getInstance();
    
    this.autocompleteEl.innerHTML = this.autocompleteItems.map((item, i) => {
      const parts = item.split(' ');
      const cmdName = parts[0];
      const def = registry.getDefinition(cmdName);
      const desc = parts.length > 1 
        ? def?.subcommands?.find(s => s.name === parts[1])?.description || ''
        : def?.description || '';
      
      return `
        <div class="autocomplete-item${i === this.autocompleteIndex ? ' selected' : ''}" data-index="${i}">
          <span class="autocomplete-item-name">${item}</span>
          <span class="autocomplete-item-desc">${desc}</span>
        </div>
      `;
    }).join('');
    
    this.autocompleteEl.classList.add('visible');
    
    // Add click handlers
    this.autocompleteEl.querySelectorAll('.autocomplete-item').forEach((el) => {
      el.addEventListener('click', () => {
        const index = parseInt(el.getAttribute('data-index') || '0');
        this.selectAutocomplete(index);
      });
    });
  }

  private hideAutocomplete(): void {
    this.autocompleteItems = [];
    this.autocompleteIndex = -1;
    this.autocompleteEl?.classList.remove('visible');
  }

  private handleTabComplete(): void {
    if (this.autocompleteItems.length === 0) {
      this.updateAutocomplete(this.inputEl?.value || '');
      return;
    }
    
    if (this.autocompleteItems.length === 1) {
      // Single match - complete it
      this.selectAutocomplete(0);
    } else {
      // Multiple matches - cycle through
      this.autocompleteIndex = (this.autocompleteIndex + 1) % this.autocompleteItems.length;
      this.showAutocomplete();
    }
  }

  private selectAutocomplete(index: number): void {
    if (index < 0 || index >= this.autocompleteItems.length) return;
    
    if (this.inputEl) {
      this.inputEl.value = this.autocompleteItems[index] + ' ';
      this.inputEl.focus();
    }
    
    this.hideAutocomplete();
  }

  // ============================================================================
  // Logging
  // ============================================================================

  log(type: 'command' | 'result' | 'error' | 'warn' | 'info' | 'log' | 'system', message: string): void {
    if (!this.outputEl) return;
    
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.innerHTML = this.formatMessage(message);
    
    this.outputEl.appendChild(line);
    
    // Limit output lines
    while (this.outputEl.children.length > MAX_OUTPUT_LINES) {
      this.outputEl.removeChild(this.outputEl.firstChild!);
    }
    
    // Scroll to bottom
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  private interceptConsoleLogs(): void {
    const self = this;
    
    console.log = function(...args: unknown[]) {
      self.originalLog.apply(console, args);
      self.log('log', args.map(a => String(a)).join(' '));
    };
    
    console.warn = function(...args: unknown[]) {
      self.originalWarn.apply(console, args);
      self.log('warn', args.map(a => String(a)).join(' '));
    };
    
    console.error = function(...args: unknown[]) {
      self.originalError.apply(console, args);
      self.log('error', args.map(a => String(a)).join(' '));
    };
    
    console.info = function(...args: unknown[]) {
      self.originalInfo.apply(console, args);
      self.log('info', args.map(a => String(a)).join(' '));
    };
  }

  private restoreConsoleLogs(): void {
    console.log = this.originalLog;
    console.warn = this.originalWarn;
    console.error = this.originalError;
    console.info = this.originalInfo;
  }

  /**
   * Format message with syntax highlighting
   * - [text] becomes highlighted in cyan
   * - label: value becomes label highlighted
   * - Numbers are highlighted
   */
  private formatMessage(message: string): string {
    // Check if message already contains HTML (from help command etc.)
    // If so, skip escaping to preserve the formatting
    const containsHtml = /<span\s+class=/.test(message);
    
    // Escape HTML entities first (unless message already has HTML)
    const escapeHtml = (str: string) => str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    
    const escaped = containsHtml ? message : escapeHtml(message);
    
    // Convert newlines to <br> tags
    let result = escaped.replace(/\n/g, '<br>');
    
    // Build result by finding patterns and wrapping them
    // Process in order of priority to avoid nested replacements
    
    // 1. Highlight [bracketed text] in cyan - most specific
    result = result.replace(
      /\[([^\]]+)\]/g,
      (_, content) => `<span class="hl-bracket">[${content}]</span>`
    );
    
    // 2. Highlight "quoted strings"
    result = result.replace(
      /&quot;([^&]+)&quot;/g,
      (_, content) => `<span class="hl-string">"${content}"</span>`
    );
    
    // 3. Highlight label: patterns (but not inside already highlighted spans)
    result = result.replace(
      /(\b[A-Za-z_]\w*):/g,
      (match, label) => {
        // Don't highlight if it's part of a class attribute
        if (label === 'class' || label === 'span') return match;
        return `<span class="hl-label">${label}:</span>`;
      }
    );
    
    // 4. Highlight standalone numbers (not inside spans)
    result = result.replace(
      /\b(\d+\.?\d*)\b(?![^<]*>)/g,
      '<span class="hl-number">$1</span>'
    );
    
    return result;
  }

  // ============================================================================
  // Built-in Commands
  // ============================================================================

  private registerBuiltinCommands(): void {
    const registry = ConsoleCommandRegistry.getInstance();
    
    // Help command
    registry.register('help', (args) => {
      if (args.length > 0) {
        const def = registry.getDefinition(args[0]);
        if (!def) {
          return `Unknown command: ${args[0]}`;
        }
        
        let help = `<span class="hl-command">${def.name}</span> - ${def.description}\n`;
        if (def.usage) {
          help += `<span class="hl-label">Usage:</span> <span class="hl-string">${def.usage}</span>\n`;
        }
        if (def.subcommands) {
          help += '<span class="hl-label">Subcommands:</span>\n';
          for (const sub of def.subcommands) {
            help += `  <span class="hl-command">${sub.name.padEnd(12)}</span> ${sub.description}\n`;
          }
        }
        return help.trim();
      }
      
      const defs = registry.getAllDefinitions();
      
      // Sort commands alphabetically
      const sortedDefs = [...defs].sort((a, b) => a.name.localeCompare(b.name));
      
      // Group by category (infer from name patterns)
      const categories: Record<string, typeof sortedDefs> = {
        'System': [],
        'Game': [],
        'Debug': [],
        'Other': []
      };
      
      for (const def of sortedDefs) {
        const name = def.name.toLowerCase();
        if (['help', 'clear', 'version', 'commands'].includes(name)) {
          categories['System'].push(def);
        } else if (['debug', 'camera', 'map', 'weather', 'wind', 'audio', 'time', 'fx'].includes(name)) {
          categories['Debug'].push(def);
        } else if (['game', 'plant', 'quest', 'spawn', 'give', 'save', 'load', 'teleport', 'unlock', 'custom'].includes(name)) {
          categories['Game'].push(def);
        } else {
          categories['Other'].push(def);
        }
      }
      
      let help = '<span class="hl-label">═══════════════════════════════════════</span>\n';
      help += '<span class="hl-string">           CONSOLE COMMANDS</span>\n';
      help += '<span class="hl-label">═══════════════════════════════════════</span>\n\n';
      
      for (const [category, cmds] of Object.entries(categories)) {
        if (cmds.length === 0) continue;
        
        help += `<span class="hl-label">▸ ${category}</span>\n`;
        for (const def of cmds) {
          help += `  <span class="hl-command">${def.name.padEnd(14)}</span> ${def.description}\n`;
        }
        help += '\n';
      }
      
      help += '<span class="hl-label">───────────────────────────────────────</span>\n';
      help += 'Type <span class="hl-command">help &lt;command&gt;</span> for detailed info.\n';
      help += 'Use <span class="hl-command">Tab</span> for autocomplete.';
      return help;
    });
    
    // Clear command
    registry.register('clear', () => {
      if (this.outputEl) {
        this.outputEl.innerHTML = '';
      }
    });
    
    // Version command
    registry.register('version', () => {
      return EngineVersion.getInstance().getFullVersionString();
    });
    
    // Console size command (con_size)
    registry.register('con_size', (args) => {
      if (args.length === 0) {
        const current = this.getSize();
        return `Console size: ${(current * 100).toFixed(0)}% (${current.toFixed(2)})\nUsage: con_size <0.1-1.0>`;
      }
      
      const size = parseFloat(args[0]);
      if (isNaN(size)) {
        return `Invalid size: ${args[0]}. Must be a number between 0.1 and 1.0`;
      }
      
      return this.setSize(size);
    });
  }
}
