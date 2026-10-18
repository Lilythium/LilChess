// On-screen keyboard handling for phones and the native WebView.
//
// Browsers and WebViews disagree about what the keyboard does to the page: iOS usually leaves the layout
// viewport alone and shrinks only the *visual* viewport, while Android (adjustResize) shrinks both. So the
// "is the keyboard open" decision compares the current height with the largest height seen since the last
// width change, and only counts while a text field has focus (the URL bar collapsing is not a keyboard).

/** A height drop smaller than this is browser chrome (URL bar, toolbars), not a keyboard. */
export const KEYBOARD_MIN_PX = 120;

export interface ViewportBaseline { width: number; height: number }

/** Largest viewport height seen since the width last changed (a width change means a rotation or resize). */
export function nextBaseline(previous: ViewportBaseline | null, width: number, height: number): ViewportBaseline {
  if (!previous || previous.width !== width) return { width, height };
  return { width, height: Math.max(previous.height, height) };
}

/** Pixels of screen the keyboard is taking, or 0 when it is closed. */
export function keyboardInset(baselineHeight: number, currentHeight: number, textFieldFocused: boolean): number {
  if (!textFieldFocused) return 0;
  const drop = baselineHeight - currentHeight;
  return drop >= KEYBOARD_MIN_PX ? Math.round(drop) : 0;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "datetime-local", "date", "time"]);

/** True for elements that bring up the on-screen keyboard. */
export function isTextEntry(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLInputElement) return !target.readOnly && TEXT_INPUT_TYPES.has(target.type);
  return target.isContentEditable;
}

/**
 * Marks `<html>` with `kb-open` and `--kb-inset` while the keyboard is up (so sticky bars can step aside),
 * and scrolls a focused field into view once the keyboard has finished animating. Returns a cleanup function.
 */
export function installKeyboardHandling(root: HTMLElement = document.documentElement): () => void {
  const visual = window.visualViewport;
  let baseline: ViewportBaseline | null = null;
  let focused = false;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  function currentHeight(): number { return visual?.height ?? window.innerHeight; }

  function update() {
    // The baseline tracks the larger of the layout and visual heights so it survives an Android resize.
    baseline = nextBaseline(baseline, window.innerWidth, Math.max(window.innerHeight, currentHeight()));
    const inset = keyboardInset(baseline.height, currentHeight(), focused);
    root.classList.toggle("kb-open", inset > 0);
    root.style.setProperty("--kb-inset", `${inset}px`);
  }

  function onFocusIn(event: FocusEvent) {
    if (!isTextEntry(event.target)) return;
    focused = true;
    update();
    const field = event.target;
    clearTimeout(scrollTimer);
    // Wait for the keyboard animation; scrolling earlier measures the wrong viewport.
    scrollTimer = setTimeout(() => {
      if (document.activeElement === field) field.scrollIntoView({ block: "center", behavior: "auto" });
    }, 320);
  }

  function onFocusOut(event: FocusEvent) {
    if (!isTextEntry(event.target)) return;
    focused = false;
    clearTimeout(scrollTimer);
    // Let the viewport settle before measuring, so a field-to-field tap doesn't flicker the bars.
    setTimeout(() => { if (!focused) update(); }, 100);
  }

  update();
  visual?.addEventListener("resize", update);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);

  return () => {
    clearTimeout(scrollTimer);
    visual?.removeEventListener("resize", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    root.classList.remove("kb-open");
    root.style.removeProperty("--kb-inset");
  };
}
