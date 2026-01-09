/**
 * QuestPanel - UI for displaying quests and objectives
 */

import { EventBus } from "../../../engine/core/EventBus";
import { QuestSystem, type ActiveQuest, type Quest } from "../QuestSystem";
import { UIStyles } from "../../../engine/ui/UIStyles";
import questPanelCSS from "./styles/QuestPanel.css?raw";

export class QuestPanel {
  private static instance: QuestPanel;
  private container: HTMLElement | null = null;
  private isVisible: boolean = false;

  private constructor() {}

  public static getInstance(): QuestPanel {
    if (!QuestPanel.instance) {
      QuestPanel.instance = new QuestPanel();
    }
    return QuestPanel.instance;
  }

  public show(): void {
    if (this.isVisible) return;

    this.createPanel();
    this.setupEventListeners();
    this.isVisible = true;
  }

  public hide(): void {
    if (!this.isVisible) return;

    this.container?.remove();
    this.container = null;
    this.isVisible = false;
  }

  private createPanel(): void {
    // Inject styles once
    UIStyles.injectCSS("quest-panel", questPanelCSS);

    this.container = document.createElement("div");
    this.container.id = "quest-panel";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

    this.update();
  }

  private getHTML(): string {
    return `
      <div class="quest-panel-container">
        <div class="quest-panel-header">
          <span class="quest-title">📜 Quests</span>
          <button class="quest-toggle" id="quest-toggle">−</button>
        </div>
        <div class="quest-list" id="quest-list">
          <!-- Quests populated dynamically -->
        </div>
      </div>
    `;
  }

  public update(): void {
    const listEl = this.container?.querySelector("#quest-list");
    if (!listEl) return;

    const activeQuests = QuestSystem.getInstance().getActiveQuests();

    if (activeQuests.length === 0) {
      listEl.innerHTML = `<div class="no-quests">No active quests</div>`;
      return;
    }

    listEl.innerHTML = activeQuests.map(active => {
      const quest = QuestSystem.getInstance().getQuest(active.questId);
      if (!quest) return "";
      return this.renderQuest(quest, active);
    }).join("");
  }

  private renderQuest(quest: Quest, active: ActiveQuest): string {
    const objectivesHtml = active.objectives.map(obj => `
      <div class="quest-objective">
        <span class="objective-check ${obj.isComplete ? 'complete' : ''}">
          ${obj.isComplete ? '✓' : ''}
        </span>
        <span class="objective-text ${obj.isComplete ? 'complete' : ''}">${obj.description}</span>
        <span class="objective-progress">${obj.current}/${obj.target}</span>
      </div>
    `).join("");

    const rewardsHtml = quest.rewards.map(r => {
      switch (r.type) {
        case "money": return `<span class="quest-reward">$${r.amount}</span>`;
        case "xp": return `<span class="quest-reward">${r.amount} XP</span>`;
        default: return "";
      }
    }).join("");

    return `
      <div class="quest-card">
        <div class="quest-header">
          <span class="quest-icon">${quest.icon}</span>
          <span class="quest-name">${quest.name}</span>
          <span class="quest-category">${quest.category}</span>
        </div>
        <div class="quest-objectives">${objectivesHtml}</div>
        <div class="quest-rewards">${rewardsHtml}</div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    // Toggle collapse
    this.container.querySelector("#quest-toggle")?.addEventListener("click", () => {
      this.toggleCollapse();
    });
    
    // Clicking the header also toggles
    this.container.querySelector(".quest-panel-header")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id !== "quest-toggle") {
        this.toggleCollapse();
      }
    });

    // Listen for quest events via EventBus
    const questEvents = ["quest:quest_started", "quest:quest_completed", "quest:objective_completed"];
    questEvents.forEach(event => {
      EventBus.on(event, () => this.update());
    });
    
    // Accordion behavior: collapse when another panel opens
    EventBus.on<{ panel: string }>("ui:panel_expanded", ({ panel }) => {
      if (panel !== "quest") {
        this.collapse();
      }
    });
  }
  
  private toggleCollapse(): void {
    const list = this.container?.querySelector("#quest-list");
    const btn = this.container?.querySelector("#quest-toggle");
    if (list && btn) {
      const wasCollapsed = list.classList.contains("collapsed");
      list.classList.toggle("collapsed");
      btn.textContent = list.classList.contains("collapsed") ? "+" : "−";
      
      // Emit event when expanding (for accordion behavior)
      if (wasCollapsed) {
        EventBus.emit("ui:panel_expanded", { panel: "quest" });
      }
    }
  }
  
  private collapse(): void {
    const list = this.container?.querySelector("#quest-list");
    const btn = this.container?.querySelector("#quest-toggle");
    if (list && btn && !list.classList.contains("collapsed")) {
      list.classList.add("collapsed");
      btn.textContent = "+";
    }
  }
}
