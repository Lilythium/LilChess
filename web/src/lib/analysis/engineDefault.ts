/** What the browser tells us about the connection and device. */
export interface NetEnv {
  hasConnectionApi: boolean; // Chromium only; Safari and Firefox don't expose it
  saveData?: boolean;
  type?: string; // "cellular" | "wifi" | ...
  effectiveType?: string; // "slow-2g" | "2g" | "3g" | "4g"
  coarsePointer: boolean; // touch device
  narrow: boolean; // phone-sized viewport
}

/**
 * Should the ~7 MB engine download start by itself the first time someone opens analysis?
 * Not when data looks precious. Where the browser can't say (Safari), a phone-sized touch
 * device is treated as possibly on mobile data. An explicit choice always wins over this.
 */
export function engineOnByDefault(env: NetEnv): boolean {
  if (env.saveData) return false;
  if (env.type === "cellular") return false;
  if (env.effectiveType && ["slow-2g", "2g", "3g"].includes(env.effectiveType)) return false;
  if (env.hasConnectionApi) return true;
  return !(env.coarsePointer && env.narrow);
}

interface ConnectionLike { saveData?: boolean; type?: string; effectiveType?: string }

export function readNetEnv(): NetEnv {
  const connection = (navigator as Navigator & { connection?: ConnectionLike }).connection;
  const media = (q: string) => typeof matchMedia !== "undefined" && matchMedia(q).matches;
  return {
    hasConnectionApi: !!connection,
    saveData: connection?.saveData,
    type: connection?.type,
    effectiveType: connection?.effectiveType,
    coarsePointer: media("(pointer: coarse)"),
    narrow: media("(max-width: 800px)"),
  };
}
