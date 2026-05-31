/**
 * Persists the best run (distance + score) to localStorage. This is a real
 * deployed static site, so localStorage is the right home for a cheap retention
 * hook. Kept out of the pure game import graph; all access is wrapped so a
 * missing/blocked storage (private mode, SSR, Node) degrades gracefully.
 *
 * No three imports.
 */

import { STORAGE_KEY } from '../utils/constants';

export interface BestRun {
  distance: number;
  score: number;
}

export class BestStore {
  best: BestRun = { distance: 0, score: 0 };

  constructor() {
    this.best = this.load();
  }

  private load(): BestRun {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { distance: 0, score: 0 };
      const parsed = JSON.parse(raw) as Partial<BestRun>;
      return {
        distance: Number(parsed.distance) || 0,
        score: Number(parsed.score) || 0,
      };
    } catch {
      return { distance: 0, score: 0 };
    }
  }

  /**
   * Submit a finished run. Updates + persists the best when this run scores
   * higher (distance recorded alongside). Returns true if a new best was set.
   */
  submit(distance: number, score: number): boolean {
    let improved = false;
    if (score > this.best.score) {
      this.best = { distance: Math.max(distance, this.best.distance), score };
      improved = true;
    } else if (distance > this.best.distance) {
      // Keep the furthest distance even if the score didn't beat the record.
      this.best = { ...this.best, distance };
      improved = true;
    }
    if (improved) this.save();
    return improved;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.best));
    } catch {
      // Storage unavailable (private mode / quota) — ignore; non-critical.
    }
  }
}
