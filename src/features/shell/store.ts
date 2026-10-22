import { useSyncExternalStore } from 'react';

/**
 * Small shared state of the app shell that pages affect without props:
 * whether a page shows sticky editor actions (the phone tab bar makes way
 * for them) or a bar floating at its bottom, and whether someone is typing
 * (the phone keyboard is likely open).
 */

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let stickyActions = 0;

/** Called by `StickyActions` while it is on the page; returns the cleanup. */
export function registerStickyActions(): () => void {
  stickyActions += 1;
  emit();
  return () => {
    stickyActions -= 1;
    emit();
  };
}

export function useHasStickyActions(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => stickyActions > 0,
    () => false,
  );
}

let bottomBars = 0;

/**
 * Called while a bar floats at the bottom of the page (the settings' Save
 * changes bar); returns the cleanup. Floating buttons (Ask AI) move up
 * above it.
 */
export function registerBottomBar(): () => void {
  bottomBars += 1;
  emit();
  return () => {
    bottomBars -= 1;
    emit();
  };
}

export function useHasBottomBar(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => bottomBars > 0,
    () => false,
  );
}

/** Fields that bring up the on-screen keyboard. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(
    target.type,
  );
}

let typing = false;
let watching = false;

function watchTyping() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('focusin', (e) => {
    const next = isTypingTarget(e.target);
    if (next !== typing) {
      typing = next;
      emit();
    }
  });
  document.addEventListener('focusout', (e) => {
    // Moving straight to another field keeps the keyboard up.
    if (isTypingTarget((e as FocusEvent).relatedTarget)) return;
    if (typing) {
      typing = false;
      emit();
    }
  });
}

/** True while a text field has focus. */
export function useTyping(): boolean {
  watchTyping();
  return useSyncExternalStore(
    subscribe,
    () => typing,
    () => false,
  );
}
