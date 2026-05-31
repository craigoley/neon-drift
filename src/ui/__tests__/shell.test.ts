// @vitest-environment jsdom
/**
 * Shell screen behaviour: the WIPEOUT peak-combo readout, and the menu/pause
 * routing (return to menu, pause overlay) added in polish pass 3.
 */
import { describe, expect, it } from 'vitest';
import { Shell } from '../Shell';
import { SettingsStore } from '../../state/Settings';
import { BestStore } from '../../storage/BestStore';
import type { AudioEngine } from '../../audio/AudioEngine';

interface Spy {
  shell: Shell;
  parent: HTMLElement;
  calls: {
    play: number;
    pause: number;
    resume: number;
    menu: number;
    pickerEnter: number;
    pickerExit: number;
    pickerCar: string[];
  };
}

function makeShell(): Spy {
  const parent = document.createElement('div');
  const audio = { setEnabled() {}, setMuted() {} } as unknown as AudioEngine;
  const calls = {
    play: 0,
    pause: 0,
    resume: 0,
    menu: 0,
    pickerEnter: 0,
    pickerExit: 0,
    pickerCar: [] as string[],
  };
  const shell = new Shell(parent, new SettingsStore(), new BestStore(), audio, {
    isTouch: false,
    shareUrl: 'https://neon.example/',
    onPlay: () => void calls.play++,
    onPause: () => void calls.pause++,
    onResume: () => void calls.resume++,
    onMenu: () => void calls.menu++,
    applyCar: () => {},
    onCarPickerEnter: () => void calls.pickerEnter++,
    onCarPickerCar: (id: string) => void calls.pickerCar.push(id),
    onCarPickerExit: () => void calls.pickerExit++,
  });
  return { shell, parent, calls };
}

const shown = (parent: HTMLElement, sel: string): boolean => {
  const el = parent.querySelector(sel) as HTMLElement | null;
  return !!el && el.style.display !== 'none';
};

describe('Shell — WIPEOUT peak combo', () => {
  it('headlines the run peak combo (the live combo reset on crash never hides it)', () => {
    const { shell, parent } = makeShell();
    shell.showCrash(30763, 6938, { distance: 6938, score: 30763 }, 4.5);
    expect(parent.querySelector('.shell-crash-combo')?.textContent).toBe('MAX COMBO x4.5');
  });

  it('dims the line when the run never built a combo', () => {
    const { shell, parent } = makeShell();
    shell.showCrash(700, 700, { distance: 700, score: 700 }, 1);
    const el = parent.querySelector('.shell-crash-combo') as HTMLElement;
    expect(el.textContent).toBe('MAX COMBO x1.0');
    expect(el.style.opacity).toBe('0.45');
  });
});

describe('Shell — menu return + pause routing', () => {
  it('the WIPEOUT screen offers a MENU button that returns to the start screen', () => {
    const { shell, parent, calls } = makeShell();
    shell.showCrash(700, 700, { distance: 700, score: 700 }, 1);
    expect(shown(parent, '.shell-crash')).toBe(true);

    (parent.querySelector('.shell-crash .shell-menu') as HTMLButtonElement).click();
    expect(calls.menu).toBe(1); // reset requested
    expect(shown(parent, '.shell-start')).toBe(true);
    expect(shown(parent, '.shell-crash')).toBe(false);
  });

  it('pause -> resume routes through the pause overlay and back into play', () => {
    const { shell, parent, calls } = makeShell();
    shell.hide(); // enter "in play" (no overlay)
    expect(document.body.classList.contains('playing')).toBe(true);

    shell.requestPause();
    expect(calls.pause).toBe(1);
    expect(shown(parent, '.shell-pause')).toBe(true);
    expect(document.body.classList.contains('playing')).toBe(false); // controls hidden

    (parent.querySelector('.shell-resume') as HTMLButtonElement).click();
    expect(calls.resume).toBe(1);
    expect(shown(parent, '.shell-pause')).toBe(false);
    expect(document.body.classList.contains('playing')).toBe(true);
  });

  it('requestPause is a no-op unless actually playing (no double-fire from tab-blur on menus)', () => {
    const { shell, calls } = makeShell();
    shell.showStart(); // an overlay is up — not in play
    shell.requestPause();
    shell.requestPause();
    expect(calls.pause).toBe(0);
  });

  it('QUIT TO MENU from pause returns to the start screen', () => {
    const { shell, parent, calls } = makeShell();
    shell.hide();
    shell.requestPause();
    (parent.querySelector('.shell-quit') as HTMLButtonElement).click();
    expect(calls.menu).toBe(1);
    expect(shown(parent, '.shell-start')).toBe(true);
  });
});

describe('Shell — locked cars cannot be selected', () => {
  it('cycling to a locked car previews it but does NOT change the selection, and shows its requirement', () => {
    const parent = document.createElement('div');
    const audio = { setEnabled() {}, setMuted() {} } as unknown as AudioEngine;
    const settings = new SettingsStore(null); // in-memory; default selected = starter (pulse)
    const applied: string[] = [];
    // Lock everything except the starter (pulse).
    const shell = new Shell(parent, settings, new BestStore(), audio, {
      isTouch: false,
      shareUrl: 'https://neon.example/',
      onPlay: () => {},
      onPause: () => {},
      onResume: () => {},
      onMenu: () => {},
      applyCar: (id: string) => void applied.push(id),
      onCarPickerEnter: () => {},
      onCarPickerCar: () => {},
      onCarPickerExit: () => {},
      carLock: (carId: string) =>
        carId === 'pulse' ? null : { label: 'Drive 2,500m total', have: 0, need: 2500 },
    });
    shell.showStart();
    (parent.querySelector('.shell-cars') as HTMLButtonElement).click(); // open picker at pulse
    expect(settings.get('selectedCarId')).toBe('pulse');

    (parent.querySelector('.shell-next') as HTMLButtonElement).click(); // → vapor (locked)
    // Selection unchanged; the locked car never became the chosen car.
    expect(settings.get('selectedCarId')).toBe('pulse');
    expect(applied).not.toContain('vapor');
    // The picker shows the requirement and marks itself locked.
    const lockText = parent.querySelector('.shell-car-lock')?.textContent ?? '';
    expect(lockText).toContain('Drive 2,500m total');
    expect(lockText).toContain('0/2500');
    expect((parent.querySelector('.shell-carpicker') as HTMLElement).classList.contains('locked')).toBe(true);
  });
});

describe('Shell — WIPEOUT unlock celebration', () => {
  it('shows an UNLOCKED line only when a car was unlocked this run', () => {
    const { shell, parent } = makeShell();
    shell.showCrash(1000, 1000, { distance: 1000, score: 1000 }, 2, ['Vapor']);
    const el = parent.querySelector('.shell-crash-unlock') as HTMLElement;
    expect(el.textContent).toBe('UNLOCKED: Vapor!');
    expect(el.style.display).not.toBe('none');

    shell.showCrash(500, 500, { distance: 500, score: 500 }, 1); // nothing unlocked
    expect((parent.querySelector('.shell-crash-unlock') as HTMLElement).style.display).toBe('none');
  });
});

describe('Shell — car picker preview lifecycle + stat bars', () => {
  it('entering the picker spins up the 3D preview; DONE tears it down', () => {
    const { shell, parent, calls } = makeShell();
    shell.showStart();
    (parent.querySelector('.shell-cars') as HTMLButtonElement).click(); // → carpicker
    expect(calls.pickerEnter).toBe(1);
    expect(shown(parent, '.shell-carpicker')).toBe(true);

    (parent.querySelector('.shell-carpicker .shell-close') as HTMLButtonElement).click(); // DONE
    expect(calls.pickerExit).toBe(1);
    expect(shown(parent, '.shell-start')).toBe(true);
  });

  it('cycling cars updates the preview and moves the stat bars (single source per car)', () => {
    const { shell, parent, calls } = makeShell();
    shell.showStart();
    (parent.querySelector('.shell-cars') as HTMLButtonElement).click();

    const widths = () =>
      Array.from(parent.querySelectorAll('.shell-car-stats .shell-stat-fill')).map(
        (el) => (el as HTMLElement).style.width,
      );
    const before = widths().join(',');
    (parent.querySelector('.shell-next') as HTMLButtonElement).click();

    expect(calls.pickerCar.length).toBeGreaterThan(0); // preview told about the new car
    expect(widths().join(',')).not.toBe(before); // bars moved -> derived from handling
    expect(widths()).toHaveLength(3);
    for (const w of widths()) expect(w).toMatch(/%$/);
  });
});
