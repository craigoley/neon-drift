// @vitest-environment jsdom
/**
 * PROG-1 PR3a — the STORE live cosmetic preview wiring. Asserts the preview-vs-commit
 * separation at the UI seam: hovering/focusing a cosmetic row PREVIEWS it (no commit),
 * leaving reverts to equipped, and only a BUY/EQUIP click mutates progression. The
 * 3D render itself is canvas-walled (→ playtest); this pins the event plumbing.
 */
import { describe, expect, it } from 'vitest';
import { Shell, type StorePanel } from '../Shell';
import { SettingsStore } from '../../state/Settings';
import { LeaderboardStore } from '../../state/Leaderboard';
import type { AudioEngine } from '../../audio/AudioEngine';

interface StoreCalls {
  previewCosmetic: Array<[string, string | null]>;
  buyCosmetic: string[];
  equip: Array<[string, string]>;
  previewEnter: number;
  previewExit: number;
}

function makeShell() {
  const parent = document.createElement('div');
  const audio = { setEnabled() {}, setMuted() {} } as unknown as AudioEngine;
  const calls: StoreCalls = { previewCosmetic: [], buyCosmetic: [], equip: [], previewEnter: 0, previewExit: 0 };
  const store: StorePanel = {
    balance: () => 1000,
    cars: () => [],
    cosmetics: () => [
      // one owned-not-equipped (→ EQUIP button) + one not-owned (→ BUY button)
      { id: 'trail-magenta', name: 'Magenta Trail', slot: 'trail', price: 150, color: '#ff00ff', owned: true, equipped: false, affordable: true },
      { id: 'glow-gold', name: 'Gold Glow', slot: 'glow', price: 250, color: '#ffc400', owned: false, equipped: false, affordable: true },
    ],
    buyCar: () => {},
    buyCosmetic: (id) => void calls.buyCosmetic.push(id),
    equip: (slot, id) => void calls.equip.push([slot, id]),
    onPreviewEnter: () => void calls.previewEnter++,
    onPreviewExit: () => void calls.previewExit++,
    previewCosmetic: (slot, id) => void calls.previewCosmetic.push([slot, id]),
  };
  const shell = new Shell(parent, new SettingsStore(null), new LeaderboardStore(null), audio, {
    isTouch: false,
    shareUrl: 'https://neon.example/',
    onPlay: () => {},
    onPause: () => {},
    onResume: () => {},
    onMenu: () => {},
    applyCar: () => {},
    onCarPickerEnter: () => {},
    onCarPickerCar: () => {},
    onCarPickerExit: () => {},
    store,
  });
  shell.showStart();
  return { shell, parent, calls };
}

const openStore = (parent: HTMLElement) =>
  (parent.querySelector('.shell-store-open') as HTMLButtonElement).click();
const row = (parent: HTMLElement, id: string) =>
  parent.querySelector(`.shell-store-cosmetics .shell-store-row[data-cos-id="${id}"]`) as HTMLElement;

describe('Store preview — mounts with the screen', () => {
  it('opening the store spins up the preview; leaving tears it down', () => {
    const { parent, calls } = makeShell();
    expect(calls.previewEnter).toBe(0);
    openStore(parent);
    expect(calls.previewEnter).toBe(1);
    (parent.querySelector('.shell-close-store') as HTMLButtonElement).click();
    expect(calls.previewExit).toBe(1);
  });
});

describe('Store preview — hover previews, leaving reverts (NO commit)', () => {
  it('hovering a cosmetic row previews it; mouseout reverts to equipped (null)', () => {
    const { parent, calls } = makeShell();
    openStore(parent);

    row(parent, 'trail-magenta').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(calls.previewCosmetic.at(-1)).toEqual(['trail', 'trail-magenta']);

    row(parent, 'trail-magenta').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(calls.previewCosmetic.at(-1)).toEqual(['trail', null]); // back to equipped

    // Hovering NEVER buys or equips — preview is not a commit.
    expect(calls.buyCosmetic).toEqual([]);
    expect(calls.equip).toEqual([]);
  });

  it('keyboard focus previews too (focusin/focusout)', () => {
    const { parent, calls } = makeShell();
    openStore(parent);
    row(parent, 'glow-gold').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(calls.previewCosmetic.at(-1)).toEqual(['glow', 'glow-gold']);
    expect(calls.buyCosmetic).toEqual([]); // still no commit
  });
});

describe('Store preview — only a click commits', () => {
  it('clicking EQUIP commits (reuses the PR2 transaction); clicking BUY commits', () => {
    const { parent, calls } = makeShell();
    openStore(parent);
    (parent.querySelector('.shell-store-cosmetics button[data-action="equip"]') as HTMLButtonElement).click();
    expect(calls.equip).toEqual([['trail', 'trail-magenta']]);
    (parent.querySelector('.shell-store-cosmetics button[data-action="buy-cosmetic"]') as HTMLButtonElement).click();
    expect(calls.buyCosmetic).toEqual(['glow-gold']);
  });
});
