/**
 * GameTimer - Time-based event system
 * Handles game time, timers, and scheduled events
 */

export interface TimerEvent {
  id: string;
  callback: () => void;
  triggerAt: number; // Game time in ms
  repeat?: number; // Repeat interval in ms (0 = one-shot)
  paused: boolean;
}

export interface ScheduledTask {
  id: string;
  callback: () => void;
  interval: number; // Real-time ms
  lastRun: number;
  paused: boolean;
}

export class GameTimer {
  private static instance: GameTimer;

  // Game time (can be accelerated)
  private gameTime: number = 0;
  private gameTimeScale: number = 1; // 1 = real-time, 60 = 1 min = 1 sec
  private lastRealTime: number = 0;
  private isPaused: boolean = false;

  // Timers and tasks
  private timers: Map<string, TimerEvent> = new Map();
  private tasks: Map<string, ScheduledTask> = new Map();
  private updateCallbacks: ((deltaTime: number, gameTime: number) => void)[] = [];

  // Real-time tracking
  private realTimeElapsed: number = 0;

  private constructor() {
    this.lastRealTime = performance.now();
  }

  public static getInstance(): GameTimer {
    if (!GameTimer.instance) {
      GameTimer.instance = new GameTimer();
    }
    return GameTimer.instance;
  }

  public static resetInstance(): void {
    GameTimer.instance = null as any;
  }

  // ==================== Core Update ====================

  /**
   * Call this every frame from the game loop
   */
  public update(): void {
    const now = performance.now();
    const realDelta = now - this.lastRealTime;
    this.lastRealTime = now;

    if (this.isPaused) {
      return;
    }

    // Update real-time tracking
    this.realTimeElapsed += realDelta;

    // Update game time (scaled)
    const gameDelta = realDelta * this.gameTimeScale;
    this.gameTime += gameDelta;

    // Process timers
    this.processTimers();

    // Process scheduled tasks
    this.processTasks();

    // Call update callbacks
    for (const callback of this.updateCallbacks) {
      callback(gameDelta, this.gameTime);
    }
  }

  private processTimers(): void {
    for (const [id, timer] of this.timers) {
      if (timer.paused) continue;

      if (this.gameTime >= timer.triggerAt) {
        timer.callback();

        if (timer.repeat && timer.repeat > 0) {
          // Reschedule repeating timer
          timer.triggerAt = this.gameTime + timer.repeat;
        } else {
          // Remove one-shot timer
          this.timers.delete(id);
        }
      }
    }
  }

  private processTasks(): void {
    const now = performance.now();

    for (const [, task] of this.tasks) {
      if (task.paused) continue;

      if (now - task.lastRun >= task.interval) {
        task.callback();
        task.lastRun = now;
      }
    }
  }

  // ==================== Time Control ====================

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
    this.lastRealTime = performance.now();
  }

  public get paused(): boolean {
    return this.isPaused;
  }

  public setTimeScale(scale: number): void {
    this.gameTimeScale = Math.max(0, scale);
  }

  public getTimeScale(): number {
    return this.gameTimeScale;
  }

  public getGameTime(): number {
    return this.gameTime;
  }

  public getRealTimeElapsed(): number {
    return this.realTimeElapsed;
  }

  /**
   * Set game time (for loading saves)
   */
  public setGameTime(time: number): void {
    this.gameTime = time;
  }

  // ==================== Timers (Game Time) ====================

  /**
   * Set a timer that triggers after a delay (in game time)
   * @param id Unique identifier
   * @param delay Delay in milliseconds (game time)
   * @param callback Function to call
   * @param repeat Optional repeat interval
   */
  public setTimer(id: string, delay: number, callback: () => void, repeat: number = 0): void {
    this.timers.set(id, {
      id,
      callback,
      triggerAt: this.gameTime + delay,
      repeat,
      paused: false,
    });
  }

  /**
   * Set a timer using seconds for convenience
   */
  public setTimerSeconds(id: string, seconds: number, callback: () => void, repeatSeconds: number = 0): void {
    this.setTimer(id, seconds * 1000, callback, repeatSeconds * 1000);
  }

  /**
   * Set a timer using minutes for convenience
   */
  public setTimerMinutes(id: string, minutes: number, callback: () => void, repeatMinutes: number = 0): void {
    this.setTimer(id, minutes * 60 * 1000, callback, repeatMinutes * 60 * 1000);
  }

  public clearTimer(id: string): void {
    this.timers.delete(id);
  }

  public pauseTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      timer.paused = true;
    }
  }

  public resumeTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      timer.paused = false;
    }
  }

  public hasTimer(id: string): boolean {
    return this.timers.has(id);
  }

  public getTimerRemaining(id: string): number {
    const timer = this.timers.get(id);
    if (timer) {
      return Math.max(0, timer.triggerAt - this.gameTime);
    }
    return 0;
  }

  public getTimerProgress(id: string, totalDuration: number): number {
    const remaining = this.getTimerRemaining(id);
    return 1 - (remaining / totalDuration);
  }

  // ==================== Scheduled Tasks (Real Time) ====================

  /**
   * Schedule a task that runs at a fixed real-time interval
   * Good for things like auto-save, UI updates, etc.
   */
  public scheduleTask(id: string, intervalMs: number, callback: () => void): void {
    this.tasks.set(id, {
      id,
      callback,
      interval: intervalMs,
      lastRun: performance.now(),
      paused: false,
    });
  }

  public cancelTask(id: string): void {
    this.tasks.delete(id);
  }

  public pauseTask(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.paused = true;
    }
  }

  public resumeTask(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.paused = false;
    }
  }

  // ==================== Update Callbacks ====================

  /**
   * Register a callback that runs every frame
   */
  public onUpdate(callback: (deltaTime: number, gameTime: number) => void): void {
    this.updateCallbacks.push(callback);
  }

  public offUpdate(callback: (deltaTime: number, gameTime: number) => void): void {
    const index = this.updateCallbacks.indexOf(callback);
    if (index !== -1) {
      this.updateCallbacks.splice(index, 1);
    }
  }

  // ==================== Utility ====================

  /**
   * Format game time as readable string
   */
  public formatTime(ms: number = this.gameTime): string {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format remaining time for a timer
   */
  public formatTimerRemaining(id: string): string {
    return this.formatTime(this.getTimerRemaining(id));
  }

  /**
   * Clear all timers and tasks
   */
  public clear(): void {
    this.timers.clear();
    this.tasks.clear();
    this.updateCallbacks = [];
  }

  // ==================== Day/Night Cycle ====================
  
  // Default: 1 real minute = 1 game hour (24 real minutes = 1 game day)
  private dayLengthMs: number = 24 * 60 * 1000; // 24 minutes real time = 1 day
  private startHour: number = 6; // Game starts at 6 AM
  
  /**
   * Set how long a full day cycle takes in real milliseconds
   * Default: 24 minutes (1440000ms)
   */
  public setDayLength(realTimeMs: number): void {
    this.dayLengthMs = realTimeMs;
  }
  
  /**
   * Get the current game hour (0-23)
   */
  public getHour(): number {
    const msPerHour = this.dayLengthMs / 24;
    const totalHours = Math.floor(this.gameTime / msPerHour) + this.startHour;
    return totalHours % 24;
  }
  
  /**
   * Get the current game minute (0-59)
   */
  public getMinute(): number {
    const msPerHour = this.dayLengthMs / 24;
    const msPerMinute = msPerHour / 60;
    const hourProgress = this.gameTime % msPerHour;
    return Math.floor(hourProgress / msPerMinute);
  }
  
  /**
   * Get current day number (starting from 1)
   */
  public getDay(): number {
    return Math.floor(this.gameTime / this.dayLengthMs) + 1;
  }
  
  /**
   * Get formatted time string (e.g., "14:30" or "2:30 PM")
   */
  public getTimeString(use24Hour: boolean = true): string {
    const hour = this.getHour();
    const minute = this.getMinute();
    const minStr = minute.toString().padStart(2, "0");
    
    if (use24Hour) {
      return `${hour.toString().padStart(2, "0")}:${minStr}`;
    } else {
      const period = hour >= 12 ? "PM" : "AM";
      const hour12 = hour % 12 || 12;
      return `${hour12}:${minStr} ${period}`;
    }
  }
  
  /**
   * Get the current time of day period
   */
  public getTimeOfDay(): "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night" {
    const hour = this.getHour();
    if (hour >= 5 && hour < 7) return "dawn";
    if (hour >= 7 && hour < 12) return "morning";
    if (hour >= 12 && hour < 14) return "noon";
    if (hour >= 14 && hour < 18) return "afternoon";
    if (hour >= 18 && hour < 21) return "evening";
    return "night";
  }
  
  /**
   * Check if it's currently daytime (6 AM - 8 PM)
   */
  public isDaytime(): boolean {
    const hour = this.getHour();
    return hour >= 6 && hour < 20;
  }
  
  /**
   * Check if it's currently nighttime
   */
  public isNighttime(): boolean {
    return !this.isDaytime();
  }
  
  /**
   * Get sun intensity (0-1) based on time of day
   * Useful for lighting adjustments
   */
  public getSunIntensity(): number {
    const hour = this.getHour();
    const minute = this.getMinute();
    const timeDecimal = hour + minute / 60;
    
    // Peak at noon (12:00), dark at midnight
    // Using a sine wave for smooth transitions
    // Shift by 6 hours so peak is at noon
    const radians = ((timeDecimal - 6) / 24) * Math.PI * 2;
    const intensity = (Math.sin(radians) + 1) / 2;
    
    // Clamp to reasonable range (some ambient light at night)
    return Math.max(0.1, intensity);
  }
  
  /**
   * Get sky color based on time of day
   * Returns RGB values 0-1
   */
  public getSkyColor(): { r: number; g: number; b: number } {
    const timeOfDay = this.getTimeOfDay();
    
    switch (timeOfDay) {
      case "dawn":
        return { r: 1.0, g: 0.6, b: 0.4 }; // Orange/pink
      case "morning":
        return { r: 0.5, g: 0.7, b: 1.0 }; // Light blue
      case "noon":
        return { r: 0.4, g: 0.6, b: 1.0 }; // Bright blue
      case "afternoon":
        return { r: 0.5, g: 0.7, b: 0.9 }; // Slightly warmer blue
      case "evening":
        return { r: 1.0, g: 0.5, b: 0.3 }; // Orange/red sunset
      case "night":
        return { r: 0.1, g: 0.1, b: 0.2 }; // Dark blue
    }
  }
  
  /**
   * Skip time forward by hours
   */
  public skipHours(hours: number): void {
    const msPerHour = this.dayLengthMs / 24;
    this.gameTime += hours * msPerHour;
  }
  
  /**
   * Skip to a specific hour (0-23)
   * If the hour has passed today, skips to that hour tomorrow
   */
  public skipToHour(targetHour: number): void {
    const currentHour = this.getHour();
    let hoursToSkip = targetHour - currentHour;
    
    if (hoursToSkip <= 0) {
      hoursToSkip += 24; // Skip to tomorrow
    }
    
    this.skipHours(hoursToSkip);
  }

  /**
   * Get serializable state for saving
   */
  public getState(): { gameTime: number; timers: Array<{ id: string; triggerAt: number; repeat: number }> } {
    const timers: Array<{ id: string; triggerAt: number; repeat: number }> = [];
    
    for (const [id, timer] of this.timers) {
      timers.push({
        id,
        triggerAt: timer.triggerAt,
        repeat: timer.repeat || 0,
      });
    }

    return {
      gameTime: this.gameTime,
      timers,
    };
  }
}
