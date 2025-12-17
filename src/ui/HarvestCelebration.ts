/**
 * HarvestCelebration - Satisfying feedback when harvesting plants
 * 
 * Shows yield breakdown, quality bonuses, and celebratory effects
 */

import { EventBus } from "../engine/core/EventBus";
import { PopupSystem } from "../engine/core/PopupSystem";
import { PlantSystem } from "../game/PlantSystem";

export interface HarvestResult {
  plantId: string;
  strainId: string;
  strainName: string;
  totalYield: number;
  quality: number;
  breakdown: {
    base: number;
    waterBonus: number;
    tempBonus: number;
    lightBonus: number;
    masteryBonus: number;
    growLightBonus: number;
  };
  xpGained: number;
  isPerfect: boolean;
  masteryLevel: number;
}

export class HarvestCelebration {
  private static styleInjected: boolean = false;

  /**
   * Show harvest celebration popup
   */
  public static show(result: HarvestResult): void {
    this.injectStyles();

    const content = this.buildContent(result);

    PopupSystem.show({
      id: "harvest_celebration",
      title: result.isPerfect ? "🌟 Perfect Harvest!" : "🌿 Harvest Complete!",
      content,
      width: "380px",
      position: "center",
      buttons: [
        { label: "Awesome!", action: "close", style: "primary" },
      ],
      className: result.isPerfect ? "harvest-perfect" : "",
    });

    // Show particle effects
    if (result.isPerfect) {
      this.showConfetti();
    }

    // Emit event for other systems
    EventBus.emit("ui:harvest_celebrated", { result });
  }

  private static buildContent(result: HarvestResult): string {
    const qualityStars = this.getQualityStars(result.quality);
    const masteryStars = "★".repeat(result.masteryLevel) + "☆".repeat(5 - result.masteryLevel);

    let html = `
      <div class="harvest-content">
        <div class="harvest-strain">
          <div class="harvest-strain-icon">🌱</div>
          <div class="harvest-strain-info">
            <div class="harvest-strain-name">${result.strainName}</div>
            <div class="harvest-mastery">${masteryStars}</div>
          </div>
        </div>

        <div class="harvest-yield">
          <div class="harvest-yield-amount">${result.totalYield}g</div>
          <div class="harvest-yield-label">Total Yield</div>
        </div>

        <div class="harvest-quality">
          <div class="harvest-quality-stars">${qualityStars}</div>
          <div class="harvest-quality-percent">${result.quality}% Quality</div>
        </div>

        <div class="harvest-breakdown">
          <div class="harvest-breakdown-title">Yield Breakdown</div>
          <div class="harvest-breakdown-row">
            <span>Base Yield</span>
            <span>${result.breakdown.base}g</span>
          </div>
    `;

    if (result.breakdown.waterBonus > 0) {
      html += `
          <div class="harvest-breakdown-row harvest-bonus">
            <span>💧 Water Bonus</span>
            <span>+${result.breakdown.waterBonus}g</span>
          </div>
      `;
    }

    if (result.breakdown.tempBonus > 0) {
      html += `
          <div class="harvest-breakdown-row harvest-bonus">
            <span>🌡️ Temperature Bonus</span>
            <span>+${result.breakdown.tempBonus}g</span>
          </div>
      `;
    }

    if (result.breakdown.lightBonus > 0) {
      html += `
          <div class="harvest-breakdown-row harvest-bonus">
            <span>💡 Light Bonus</span>
            <span>+${result.breakdown.lightBonus}g</span>
          </div>
      `;
    }

    if (result.breakdown.masteryBonus > 0) {
      html += `
          <div class="harvest-breakdown-row harvest-bonus">
            <span>⭐ Mastery Bonus</span>
            <span>+${result.breakdown.masteryBonus}g</span>
          </div>
      `;
    }

    if (result.breakdown.growLightBonus > 0) {
      html += `
          <div class="harvest-breakdown-row harvest-bonus">
            <span>🔆 Grow Light Bonus</span>
            <span>+${result.breakdown.growLightBonus}g</span>
          </div>
      `;
    }

    html += `
        </div>

        <div class="harvest-xp">
          <span>✨ +${result.xpGained} XP</span>
        </div>
      </div>
    `;

    return html;
  }

  private static getQualityStars(quality: number): string {
    const fullStars = Math.floor(quality / 20);
    const halfStar = (quality % 20) >= 10;
    
    let stars = "★".repeat(fullStars);
    if (halfStar && fullStars < 5) stars += "✦";
    stars += "☆".repeat(5 - fullStars - (halfStar ? 1 : 0));
    
    return stars;
  }

  private static showConfetti(): void {
    const container = document.createElement("div");
    container.className = "harvest-confetti";
    document.body.appendChild(container);

    // Create confetti particles
    const colors = ["#FFD700", "#4CAF50", "#2196F3", "#FF5722", "#9C27B0"];
    for (let i = 0; i < 50; i++) {
      const particle = document.createElement("div");
      particle.className = "confetti-particle";
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      particle.style.animationDelay = `${Math.random() * 0.5}s`;
      particle.style.animationDuration = `${1 + Math.random() * 1}s`;
      container.appendChild(particle);
    }

    // Remove after animation
    setTimeout(() => container.remove(), 3000);
  }

  /**
   * Listen for harvest events and show celebration
   */
  public static init(): void {
    EventBus.on("plant:harvested", (data: { 
      plantId: string; 
      strain: string;
      yield: number;
      quality: number;
      xpGained: number;
      breakdown?: {
        base: number;
        waterBonus: number;
        tempBonus: number;
        lightBonus: number;
        masteryBonus: number;
      };
    }) => {
      const plantSystem = PlantSystem.getInstance();
      const strain = plantSystem.getStrain(data.strain);
      const mastery = plantSystem.getMastery(data.strain);

      // Calculate if perfect (all bonuses maxed)
      const isPerfect = data.quality >= 95;

      const result: HarvestResult = {
        plantId: data.plantId,
        strainId: data.strain,
        strainName: strain?.name || data.strain,
        totalYield: data.yield,
        quality: data.quality,
        breakdown: {
          base: data.breakdown?.base || data.yield,
          waterBonus: data.breakdown?.waterBonus || 0,
          tempBonus: data.breakdown?.tempBonus || 0,
          lightBonus: data.breakdown?.lightBonus || 0,
          masteryBonus: data.breakdown?.masteryBonus || 0,
          growLightBonus: 0, // TODO: Track this separately
        },
        xpGained: data.xpGained,
        isPerfect,
        masteryLevel: mastery?.level || 0,
      };

      HarvestCelebration.show(result);
    });
  }

  private static injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;

    const style = document.createElement("style");
    style.textContent = `
      .harvest-perfect .popup-header {
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.3) 0%, rgba(255, 140, 0, 0.2) 100%);
      }

      .harvest-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
        text-align: center;
      }

      .harvest-strain {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
      }

      .harvest-strain-icon {
        font-size: 36px;
      }

      .harvest-strain-info {
        text-align: left;
      }

      .harvest-strain-name {
        font-size: 18px;
        font-weight: 600;
        color: #fff;
      }

      .harvest-mastery {
        font-size: 14px;
        color: #FFD700;
        letter-spacing: 2px;
      }

      .harvest-yield {
        padding: 20px;
        background: linear-gradient(135deg, rgba(76, 175, 80, 0.3) 0%, rgba(56, 142, 60, 0.2) 100%);
        border-radius: 12px;
        border: 1px solid rgba(76, 175, 80, 0.4);
      }

      .harvest-yield-amount {
        font-size: 48px;
        font-weight: 700;
        color: #4CAF50;
        text-shadow: 0 2px 10px rgba(76, 175, 80, 0.5);
      }

      .harvest-yield-label {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.6);
        text-transform: uppercase;
        letter-spacing: 2px;
      }

      .harvest-quality {
        padding: 12px;
      }

      .harvest-quality-stars {
        font-size: 24px;
        color: #FFD700;
        letter-spacing: 4px;
        margin-bottom: 4px;
      }

      .harvest-quality-percent {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.7);
      }

      .harvest-breakdown {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
        padding: 12px;
      }

      .harvest-breakdown-title {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8px;
      }

      .harvest-breakdown-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.8);
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }

      .harvest-breakdown-row:last-child {
        border-bottom: none;
      }

      .harvest-bonus span:last-child {
        color: #4CAF50;
        font-weight: 600;
      }

      .harvest-xp {
        padding: 12px;
        background: linear-gradient(135deg, rgba(156, 39, 176, 0.3) 0%, rgba(123, 31, 162, 0.2) 100%);
        border-radius: 10px;
        font-size: 16px;
        font-weight: 600;
        color: #CE93D8;
      }

      /* Confetti */
      .harvest-confetti {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10001;
        overflow: hidden;
      }

      .confetti-particle {
        position: absolute;
        top: -20px;
        width: 10px;
        height: 10px;
        border-radius: 2px;
        animation: confetti-fall linear forwards;
      }

      @keyframes confetti-fall {
        0% {
          transform: translateY(0) rotate(0deg);
          opacity: 1;
        }
        100% {
          transform: translateY(100vh) rotate(720deg);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
