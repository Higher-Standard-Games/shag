/**
 * GameClock - Virtual 24-hour day/night cycle
 * 
 * Features:
 * - Configurable day length (default: 3 minutes real time = 24 hours game time)
 * - Day counting
 * - Time-based events
 * - Pause/resume support
 */

// ==================== Types ====================

export interface TimeOfDay {
  hour: number;      // 0-23
  minute: number;    // 0-59
  totalMinutes: number; // 0-1439 (total minutes in day)
  normalized: number;   // 0-1 (0 = midnight, 0.5 = noon)
  period: TimePeriod;
  periodProgress: number; // 0-1 progress through current period
}

export type TimePeriod = 
  | "night"       // 0:00 - 5:00
  | "dawn"        // 5:00 - 7:00
  | "morning"     // 7:00 - 12:00
  | "afternoon"   // 12:00 - 17:00
  | "dusk"        // 17:00 - 19:00
  | "evening";    // 19:00 - 24:00

export interface GameClockConfig {
  dayLengthSeconds: number;  // Real seconds for one full day cycle
  startHour?: number;        // Starting hour (0-23), default 8 (8 AM)
  startDay?: number;         // Starting day number, default 1
}

export interface ScheduledEvent {
  id: string;
  hour: number;
  minute?: number;
  callback: () => void;
  recurring: boolean;
  lastTriggeredDay?: number;
}

// ==================== Time Period Definitions ====================

const TIME_PERIODS: { period: TimePeriod; startHour: number; endHour: number }[] = [
  { period: "night", startHour: 0, endHour: 5 },
  { period: "dawn", startHour: 5, endHour: 7 },
  { period: "morning", startHour: 7, endHour: 12 },
  { period: "afternoon", startHour: 12, endHour: 17 },
  { period: "dusk", startHour: 17, endHour: 19 },
  { period: "evening", startHour: 19, endHour: 24 },
];

// ==================== Event Listener Type ====================

type ClockEventCallback = (event: string, data: unknown) => void;

// ==================== GameClock Class ====================

export class GameClock {
  private static instance: GameClock;

  private dayLengthSeconds: number = 180; // 3 minutes default
  private currentTimeNormalized: number = 0; // 0-1
  private currentDay: number = 1;
  private isPaused: boolean = false;
  private scheduledEvents: Map<string, ScheduledEvent> = new Map();
  private lastPeriod: TimePeriod | null = null;
  private eventListeners: ClockEventCallback[] = [];

  private constructor() {}

  public static getInstance(): GameClock {
    if (!GameClock.instance) {
      GameClock.instance = new GameClock();
    }
    return GameClock.instance;
  }

  /**
   * Initialize the clock with configuration
   * @param config Clock configuration
   * @param preserveTime If true, only sets dayLengthSeconds without resetting time (for loading saves)
   */
  public init(config: GameClockConfig, preserveTime: boolean = false): void {
    this.dayLengthSeconds = config.dayLengthSeconds;
    
    if (!preserveTime) {
      // Only reset time/day on new game, not when loading
      this.currentDay = config.startDay ?? 1;
      
      // Convert start hour to normalized time
      const startHour = config.startHour ?? 8;
      this.currentTimeNormalized = startHour / 24;
    }
    
    this.lastPeriod = this.getTimeOfDay().period;
    
    console.log(`GameClock initialized: Day ${this.currentDay}, ${this.formatTime()}${preserveTime ? ' (time preserved)' : ''}`);
  }

  /**
   * Update the clock - call this every frame
   */
  public update(deltaTime: number): void {
    if (this.isPaused) return;

    // Calculate time progression
    // deltaTime is in seconds, dayLengthSeconds is full day
    const dayProgress = deltaTime / this.dayLengthSeconds;
    const previousTime = this.currentTimeNormalized;
    
    this.currentTimeNormalized += dayProgress;
    
    // Check for day rollover
    if (this.currentTimeNormalized >= 1) {
      this.currentTimeNormalized -= 1;
      this.currentDay++;
      this.emit("day_changed", { day: this.currentDay });
      console.log(`New day: Day ${this.currentDay}`);
    }

    // Check for period changes
    const currentPeriod = this.getTimeOfDay().period;
    if (currentPeriod !== this.lastPeriod) {
      this.emit("period_changed", { 
        from: this.lastPeriod, 
        to: currentPeriod,
        time: this.getTimeOfDay(),
      });
      this.lastPeriod = currentPeriod;
    }

    // Check scheduled events
    this.checkScheduledEvents(previousTime);

    // Emit time update
    this.emit("time_update", this.getTimeOfDay());
  }

  /**
   * Get current time of day information
   */
  public getTimeOfDay(): TimeOfDay {
    const totalMinutes = Math.floor(this.currentTimeNormalized * 1440);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    
    // Determine period
    let period: TimePeriod = "night";
    let periodProgress = 0;
    
    for (const p of TIME_PERIODS) {
      if (hour >= p.startHour && hour < p.endHour) {
        period = p.period;
        const periodLength = p.endHour - p.startHour;
        const hourInPeriod = hour - p.startHour + minute / 60;
        periodProgress = hourInPeriod / periodLength;
        break;
      }
    }

    return {
      hour,
      minute,
      totalMinutes,
      normalized: this.currentTimeNormalized,
      period,
      periodProgress,
    };
  }

  /**
   * Get current day number
   */
  public getCurrentDay(): number {
    return this.currentDay;
  }

  /**
   * Format current time as string (e.g., "14:30")
   */
  public formatTime(): string {
    const time = this.getTimeOfDay();
    const hourStr = time.hour.toString().padStart(2, "0");
    const minStr = time.minute.toString().padStart(2, "0");
    return `${hourStr}:${minStr}`;
  }

  /**
   * Format time with AM/PM
   */
  public formatTime12h(): string {
    const time = this.getTimeOfDay();
    const hour12 = time.hour % 12 || 12;
    const ampm = time.hour < 12 ? "AM" : "PM";
    const minStr = time.minute.toString().padStart(2, "0");
    return `${hour12}:${minStr} ${ampm}`;
  }

  /**
   * Check if it's daytime (6 AM - 6 PM)
   */
  public isDaytime(): boolean {
    const hour = this.getTimeOfDay().hour;
    return hour >= 6 && hour < 18;
  }

  /**
   * Check if it's nighttime
   */
  public isNighttime(): boolean {
    return !this.isDaytime();
  }

  /**
   * Get sun position (0 = sunrise, 0.5 = noon, 1 = sunset)
   * Returns -1 if night
   */
  public getSunPosition(): number {
    const hour = this.getTimeOfDay().hour + this.getTimeOfDay().minute / 60;
    if (hour < 6 || hour >= 18) return -1;
    return (hour - 6) / 12; // 0 at 6 AM, 1 at 6 PM
  }

  /**
   * Get moon position (0 = moonrise, 0.5 = midnight, 1 = moonset)
   * Returns -1 if day
   */
  public getMoonPosition(): number {
    const hour = this.getTimeOfDay().hour + this.getTimeOfDay().minute / 60;
    if (hour >= 6 && hour < 18) return -1;
    
    // Moon rises at 6 PM, sets at 6 AM
    if (hour >= 18) {
      return (hour - 18) / 12;
    } else {
      return (hour + 6) / 12;
    }
  }

  /**
   * Set time directly (for debugging or cutscenes)
   */
  public setTime(hour: number, minute: number = 0): void {
    this.currentTimeNormalized = (hour + minute / 60) / 24;
    this.lastPeriod = this.getTimeOfDay().period;
    this.emit("time_set", this.getTimeOfDay());
  }

  /**
   * Set day directly
   */
  public setDay(day: number): void {
    this.currentDay = day;
    this.emit("day_changed", { day: this.currentDay });
  }

  /**
   * Schedule an event at a specific time
   */
  public scheduleEvent(event: ScheduledEvent): void {
    this.scheduledEvents.set(event.id, event);
  }

  /**
   * Remove a scheduled event
   */
  public removeScheduledEvent(id: string): void {
    this.scheduledEvents.delete(id);
  }

  /**
   * Check and trigger scheduled events
   */
  private checkScheduledEvents(previousTime: number): void {
    const currentTime = this.currentTimeNormalized;
    
    for (const event of this.scheduledEvents.values()) {
      const eventTime = (event.hour + (event.minute ?? 0) / 60) / 24;
      
      // Check if we crossed this event time
      const crossed = previousTime < eventTime && currentTime >= eventTime;
      const crossedMidnight = previousTime > currentTime && 
        (previousTime < eventTime || currentTime >= eventTime);
      
      if (crossed || crossedMidnight) {
        // Check if already triggered today
        if (event.lastTriggeredDay === this.currentDay) continue;
        
        event.callback();
        event.lastTriggeredDay = this.currentDay;
        
        if (!event.recurring) {
          this.scheduledEvents.delete(event.id);
        }
      }
    }
  }

  /**
   * Pause the clock
   */
  public pause(): void {
    this.isPaused = true;
    this.emit("paused", {});
  }

  /**
   * Resume the clock
   */
  public resume(): void {
    this.isPaused = false;
    this.emit("resumed", {});
  }

  /**
   * Check if clock is paused
   */
  public isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get day length in real seconds
   */
  public getDayLengthSeconds(): number {
    return this.dayLengthSeconds;
  }

  /**
   * Set day length (affects time speed)
   */
  public setDayLengthSeconds(seconds: number): void {
    this.dayLengthSeconds = seconds;
    this.emit("speed_changed", { dayLengthSeconds: seconds });
  }

  /**
   * Get time speed multiplier (relative to default 3 min day)
   */
  public getTimeSpeed(): number {
    return 180 / this.dayLengthSeconds;
  }

  /**
   * Reset clock to initial state
   */
  public reset(): void {
    this.currentTimeNormalized = 8 / 24; // 8 AM
    this.currentDay = 1;
    this.isPaused = false;
    this.scheduledEvents.clear();
    this.lastPeriod = this.getTimeOfDay().period;
    this.emit("reset", {});
  }

  /**
   * Get save data
   */
  public getSaveData(): object {
    return {
      currentTimeNormalized: this.currentTimeNormalized,
      currentDay: this.currentDay,
      dayLengthSeconds: this.dayLengthSeconds,
    };
  }

  /**
   * Load save data
   */
  public loadSaveData(data: { 
    currentTimeNormalized: number; 
    currentDay: number;
    dayLengthSeconds?: number;
  }): void {
    this.currentTimeNormalized = data.currentTimeNormalized;
    this.currentDay = data.currentDay;
    if (data.dayLengthSeconds) {
      this.dayLengthSeconds = data.dayLengthSeconds;
    }
    this.lastPeriod = this.getTimeOfDay().period;
  }

  // ==================== Event System ====================

  /**
   * Subscribe to clock events
   */
  public on(callback: ClockEventCallback): void {
    this.eventListeners.push(callback);
  }

  /**
   * Unsubscribe from clock events
   */
  public off(callback: ClockEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: string, data: unknown): void {
    for (const callback of this.eventListeners) {
      callback(event, data);
    }
  }
}
