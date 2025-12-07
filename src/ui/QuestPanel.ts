/**
 * QuestPanel - UI for displaying quests and objectives
 */

import { QuestSystem, type ActiveQuest, type Quest } from "../game/QuestSystem";

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
    this.container = document.createElement("div");
    this.container.id = "quest-panel";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

    const style = document.createElement("style");
    style.textContent = this.getStyles();
    this.container.appendChild(style);

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

  private getStyles(): string {
    return `
      #quest-panel {
        position: fixed;
        top: 80px;
        left: 20px;
        z-index: 100;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .quest-panel-container {
        background: rgba(0, 0, 0, 0.85);
        border-radius: 10px;
        min-width: 250px;
        max-width: 300px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
      }

      .quest-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 15px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .quest-title {
        color: white;
        font-size: 16px;
        font-weight: bold;
      }

      .quest-toggle {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0 5px;
      }

      .quest-list {
        max-height: 350px;
        overflow-y: auto;
      }

      .quest-list.collapsed {
        display: none;
      }

      .quest-card {
        padding: 12px 15px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }

      .quest-card:last-child {
        border-bottom: none;
      }

      .quest-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .quest-icon {
        font-size: 20px;
      }

      .quest-name {
        color: white;
        font-weight: 500;
        flex: 1;
      }

      .quest-category {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.7);
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        text-transform: uppercase;
      }

      .quest-objectives {
        margin-left: 28px;
      }

      .quest-objective {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 5px;
        font-size: 13px;
      }

      .objective-check {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
      }

      .objective-check.complete {
        background: #4CAF50;
        border-color: #4CAF50;
        color: white;
      }

      .objective-text {
        color: rgba(255, 255, 255, 0.8);
        flex: 1;
      }

      .objective-text.complete {
        text-decoration: line-through;
        color: rgba(255, 255, 255, 0.4);
      }

      .objective-progress {
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
      }

      .quest-rewards {
        display: flex;
        gap: 10px;
        margin-top: 8px;
        margin-left: 28px;
      }

      .quest-reward {
        background: rgba(255, 215, 0, 0.2);
        color: #ffd700;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
      }

      .no-quests {
        color: rgba(255, 255, 255, 0.5);
        text-align: center;
        padding: 20px;
        font-size: 14px;
      }
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
      const list = this.container?.querySelector("#quest-list");
      const btn = this.container?.querySelector("#quest-toggle");
      if (list && btn) {
        list.classList.toggle("collapsed");
        btn.textContent = list.classList.contains("collapsed") ? "+" : "−";
      }
    });

    // Listen for quest events
    QuestSystem.getInstance().onQuestEvent((event) => {
      if (["quest_started", "quest_completed", "objective_completed"].includes(event)) {
        this.update();
      }
    });
  }
}
