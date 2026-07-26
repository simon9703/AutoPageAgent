export interface DismissKeyboardTarget {
  focus(options?: FocusOptions): void;
  blur(): void;
  dispatchEvent(event: Event): boolean;
  getAttribute(name: string): string | null;
}

type KeyboardEventFactory = (type: "keydown" | "keyup", init: KeyboardEventInit) => Event;

const ESCAPE_KEY_CODE = 27;

export function dispatchEscapeKey(
  recipient: DismissKeyboardTarget,
  createEvent: KeyboardEventFactory = (type, init) => new KeyboardEvent(type, init),
): void {
  recipient.focus({ preventScroll: true });
  const keyboardInit: KeyboardEventInit = {
    key: "Escape",
    code: "Escape",
    location: 0,
    repeat: false,
    isComposing: false,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  for (const type of ["keydown", "keyup"] as const) {
    const event = createEvent(type, keyboardInit);
    exposeLegacyEscapeCodes(event);
    recipient.dispatchEvent(event);
  }
}

export function blurComboboxAfterFailedDismiss(recipient: DismissKeyboardTarget | undefined): boolean {
  if (recipient?.getAttribute("role") !== "combobox") return false;
  recipient.blur();
  return true;
}

function exposeLegacyEscapeCodes(event: Event): void {
  for (const property of ["keyCode", "which"] as const) {
    try {
      Object.defineProperty(event, property, {
        configurable: true,
        enumerable: true,
        get: () => ESCAPE_KEY_CODE,
      });
    } catch {
      // Modern components use key/code. Legacy numeric fields are best-effort
      // compatibility only and must not turn dispatch into a reported success.
    }
  }
}
