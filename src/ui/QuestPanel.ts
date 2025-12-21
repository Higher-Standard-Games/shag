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
        background: #FAFAFA;
        border-radius: 12px;
        min-width: 250px;
        max-width: 300px;
        border: 1px solid #E0E0E0;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      }

      .quest-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 15px;
        border-bottom: 1px solid #E0E0E0;
        background: #F5F5F5;
        border-radius: 12px 12px 0 0;
      }

      .quest-title {
        color: #333333;
        font-size: 16px;
        font-weight: 600;
      }

      .quest-toggle {
        background: #E8E8E8;
        border: none;
        border-bottom: 2px solid #CCCCCC;
        color: #666666;
        font-size: 16px;
        cursor: pointer;
        padding: 4px 10px;
        border-radius: 6px;
        transition: all 0.1s ease;
      }

      .quest-toggle:hover {
        background: #F5F5F5;
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
        border-bottom: 1px solid #E8E8E8;
        background: #FFFFFF;
      }

      .quest-card:last-child {
        border-bottom: none;
        border-radius: 0 0 12px 12px;
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
        color: #333333;
        font-weight: 500;
        flex: 1;
      }

      .quest-category {
        background: #E8E8E8;
        color: #666666;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        text-transform: uppercase;
        font-weight: 500;
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
        border: 2px solid #CCCCCC;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        background: #FFFFFF;
      }

      .objective-check.complete {
        background: #4CAF50;
        border-color: #4CAF50;
        color: white;
      }

      .objective-text {
        color: #333333;
        flex: 1;
      }

      .objective-text.complete {
        text-decoration: line-through;
        color: #999999;
      }

      .objective-progress {
        color: #666666;
        font-size: 11px;
        font-weight: 500;
      }

      .quest-rewards {
        display: flex;
        gap: 10px;
        margin-top: 8px;
        margin-left: 28px;
      }

      .quest-reward {
        background: #FFF8E1;
        color: #F57C00;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid #FFE082;
      }

      .no-quests {
        color: #888888;
        text-align: center;
        padding: 20px;
        font-size: 14px;
        background: #FFFFFF;
        border-radius: 0 0 12px 12px;
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
