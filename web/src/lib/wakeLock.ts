// Keeps the screen on during a live game. Needs HTTPS (or localhost); silently does nothing elsewhere.
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let stopped = false;

  async function acquire() {
    if (stopped || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { lock = await navigator.wakeLock.request("screen"); } catch { /* denied or low battery */ }
  }

  // The browser drops the lock whenever the tab is hidden, so take it again on return.
  const onVisible = () => void acquire();
  document.addEventListener("visibilitychange", onVisible);
  void acquire();

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    void lock?.release();
  };
}