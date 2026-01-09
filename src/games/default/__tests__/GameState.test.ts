import { describe, it, expect, beforeAll } from 'vitest';

const storage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};
(globalThis as any).window = { setInterval: () => 1, clearInterval: () => {} };

import { GameState } from '../GameState';

describe('GameState', () => {
  let state: GameState;

  beforeAll(() => {
    GameState.resetInstance();
    state = GameState.getInstance();
  });

  it('should start with 0 money', () => {
    expect(state.getPlayer().money).toBe(0);
  });

  it('should add money', () => {
    state.addMoney(100);
    expect(state.getPlayer().money).toBe(100);
  });

  it('should spend money', () => {
    const result = state.spendMoney(30);
    expect(result).toBe(true);
    expect(state.getPlayer().money).toBe(70);
  });

  it('should manage inventory', () => {
    state.addItem('test_item', 'seed', 5);
    expect(state.hasItem('test_item', 5)).toBe(true);
  });

  it('should track stats', () => {
    state.incrementStat('testStat', 5);
    expect(state.getStat('testStat')).toBe(5);
  });
});
