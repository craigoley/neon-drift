/**
 * Share helper — iOS-correct. Pure DOM, no three.
 *
 * iOS gotchas this is built to (do not "simplify" these away):
 *  - Feature-detect `navigator.share`; otherwise copy the URL to the clipboard.
 *  - `navigator.share()` MUST be called synchronously inside the tap handler —
 *    it needs transient user activation. Calling it after an `await`/`.then`
 *    throws NotAllowedError on iOS. So `share()` invokes it synchronously; only
 *    the returned promise is handled afterwards.
 *  - Pass ONLY { title, url }. On iOS a `text` field overrides `url` on the
 *    sheet's "Copy" action, so the wrong thing gets copied. Never pass `text`.
 *  - Swallow AbortError (the user dismissed the share sheet — not an error).
 */

import { UI } from '../utils/constants';

export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Share the game. Call this DIRECTLY from a click/tap handler (synchronously).
 * `toastParent` hosts the "link copied" toast for the clipboard fallback.
 */
export function share(opts: { title: string; url: string }, toastParent: HTMLElement): void {
  if (canShare()) {
    try {
      // Only title + url — never `text` (see header).
      navigator
        .share({ title: opts.title, url: opts.url })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return; // user cancelled
          copyToClipboard(opts.url, toastParent); // real failure → fall back
        });
    } catch {
      // Some engines throw synchronously if activation is missing — fall back.
      copyToClipboard(opts.url, toastParent);
    }
    return;
  }
  copyToClipboard(opts.url, toastParent);
}

function copyToClipboard(url: string, toastParent: HTMLElement): void {
  const ok = () => showToast(toastParent, 'Link copied');
  const fail = () => showToast(toastParent, url); // worst case: show it to copy by hand
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(ok, fail);
    } else {
      fail();
    }
  } catch {
    fail();
  }
}

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(parent: HTMLElement, message: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'ui-toast';
    parent.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('ui-toast--visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove('ui-toast--visible'), UI.toastDurationMs);
}
