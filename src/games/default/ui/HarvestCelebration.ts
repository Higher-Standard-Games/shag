/**
 * HarvestCelebration - Satisfying feedback when harvesting plants
 * 
 * Shows yield breakdown, quality bonuses, and celebratory effects
 */

import { EventBus } from "../../../engine/core/EventBus";
import { PopupSystem } from "../../../engine/core/PopupSystem";
import { PlantSystem } from "../PlantSystem";
import { UIStyles } from "../../../engine/ui/UIStyles";
import harvestCelebrationCSS from "./styles/HarvestCelebration.css?raw";

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
      xp: number;
      bonuses?: {
        base: number;
        water: number;
        temp: number;
        light: number;
        mastery: number;
      };
      isPerfectGrow?: boolean;
    }) => {
      const plantSystem = PlantSystem.getInstance();
      const strain = plantSystem.getStrain(data.strain);
      const mastery = plantSystem.getMastery(data.strain);

      // Calculate if perfect (all bonuses maxed or isPerfectGrow flag)
      const isPerfect = data.isPerfectGrow || data.quality >= 95;

      const result: HarvestResult = {
        plantId: data.plantId,
        strainId: data.strain,
        strainName: strain?.name || data.strain,
        totalYield: data.yield,
        quality: data.quality,
        breakdown: {
          base: data.bonuses?.base || data.yield,
          waterBonus: data.bonuses?.water || 0,
          tempBonus: data.bonuses?.temp || 0,
          lightBonus: data.bonuses?.light || 0,
          masteryBonus: data.bonuses?.mastery || 0,
          growLightBonus: 0, // TODO: Track this separately
        },
        xpGained: data.xp,
        isPerfect,
        masteryLevel: mastery?.level || 0,
      };

      HarvestCelebration.show(result);
    });
  }

  private static injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;
    UIStyles.injectCSS("harvest-celebration", harvestCelebrationCSS);
  }
}
