// @vitest-environment jsdom
/**
 * The peak combo (run high-water mark) is displayed on the WIPEOUT screen,
 * which lives in the Shell. This locks that the live-combo reset on crash never
 * hides how daring the run was.
 */
import { describe, expect, it } from 'vitest';
import { Shell } from '../Shell';
import { SettingsStore } from '../../state/Settings';
import { BestStore } from '../../storage/BestStore';
import type { AudioEngine } from '../../audio/AudioEngine';

function makeShell(parent: HTMLElement): Shell {
  const audio = { setEnabled() {} } as unknown as AudioEngine;
  return new Shell(parent, new SettingsStore(), new BestStore(), audio, {
    isTouch: false,
    shareUrl: 'https://neon.example/',
    onPlay: () => {},
    applyCar: () => {},
  });
}

describe('Shell — WIPEOUT peak combo', () => {
  it('headlines the run peak combo (the live combo reset on crash never hides it)', () => {
    const parent = document.createElement('div');
    makeShell(parent).showCrash(30763, 6938, { distance: 6938, score: 30763 }, 4.5);
    expect(parent.querySelector('.shell-crash-combo')?.textContent).toBe('MAX COMBO x4.5');
  });

  it('dims the line when the run never built a combo', () => {
    const parent = document.createElement('div');
    makeShell(parent).showCrash(700, 700, { distance: 700, score: 700 }, 1);
    const el = parent.querySelector('.shell-crash-combo') as HTMLElement;
    expect(el.textContent).toBe('MAX COMBO x1.0');
    expect(el.style.opacity).toBe('0.45');
  });
});
