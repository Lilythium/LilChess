/*
 * Sound Effects Attribution
 *
 * The sound effects used by LilChess come from the Chess Analyzer Pro project:
 * https://github.com/imutkarsht/Chess_analyzer
 *
 * Original sound directory:
 * https://github.com/imutkarsht/Chess_analyzer/tree/master/assets/sounds
 *
 * The sounds were synthesized from scratch and dedicated to the public domain
 * under the CC0 1.0 Universal license.
 *
 * LilChess is not the original author of these sound effects.
 */

import { sounds, type SoundName } from "./sounds";

const DEFAULT_VOLUME = 0.5;
export const SOUND_PREFS_KEY = "lilchess.sound.v1";

export interface SoundPreferences {
    enabled: boolean;
    volume: number;
}

/** Reads what was saved by a previous visit. Anything missing or malformed falls back to the defaults. */
export function parseSoundPreferences(raw: string | null): SoundPreferences {
    const defaults: SoundPreferences = { enabled: true, volume: DEFAULT_VOLUME };
    if (!raw) return defaults;
    try {
        const value = JSON.parse(raw) as { enabled?: unknown; volume?: unknown } | null;
        return {
            enabled: typeof value?.enabled === "boolean" ? value.enabled : defaults.enabled,
            volume: typeof value?.volume === "number" && Number.isFinite(value.volume)
                ? Math.max(0, Math.min(1, value.volume))
                : defaults.volume,
        };
    } catch {
        return defaults;
    }
}

function readSavedPreferences(): SoundPreferences {
    try {
        return parseSoundPreferences(localStorage.getItem(SOUND_PREFS_KEY));
    } catch {
        return parseSoundPreferences(null); // storage unavailable (private mode): defaults, nothing saved
    }
}

function savePreferences(): void {
    try {
        localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify({ enabled, volume }));
    } catch {
        // Not persisted. Sound settings are a convenience and must never break play.
    }
}

const saved = readSavedPreferences();
let enabled = saved.enabled;
let volume = saved.volume;
let unlocked = false;
// A desktop tab keeps beeping in the background (you may be waiting on a move). The phone app does not: a late
// socket event arriving while the app is hidden would otherwise play over whatever the person is doing.
let playWhenHidden = true;

export function setPlayWhenHidden(value: boolean): void {
    playWhenHidden = value;
}

const audioCache = new Map<SoundName, HTMLAudioElement>();

function getAudio(sound: SoundName): HTMLAudioElement {
    let audio = audioCache.get(sound);

    if (!audio) {
        audio = new Audio(sounds[sound]);
        audio.preload = "auto";
        audio.volume = volume;

        audioCache.set(sound, audio);
    }

    return audio;
}

/** First touch: silently "play" every sound once so later programmatic plays are allowed on iOS. */
export function unlockAudio(): void {
    if (unlocked) return;
    unlocked = true;
    for (const name of Object.keys(sounds) as SoundName[]) {
        const audio = getAudio(name);
        audio.muted = true;
        void audio.play()
            .then(() => {
                // If a real sound started in the meantime, playSound already cleared `muted`; leave it playing.
                if (audio.muted) { audio.pause(); audio.currentTime = 0; audio.muted = false; }
            })
            .catch(() => { audio.muted = false; });
    }
}

export function playSound(sound: SoundName): void {
    if (!enabled) return;
    if (!playWhenHidden && typeof document !== "undefined" && document.hidden) return;

    const audio = getAudio(sound);

    audio.muted = false;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;

    void audio.play().catch(() => {
        // Playback may be blocked by browser autoplay restrictions.
        // Sound failures must never interfere with gameplay.
    });
}

export function playMoveSound(san: string): void {
    if (san === "O-O" || san === "O-O-O") {
        playSound("castle");
    } else if (san.endsWith("+")) {
        playSound("check");
    } else if (san.includes("x")) {
        playSound("capture");
    } else {
        playSound("move");
    }
}

export function setSoundEnabled(value: boolean): void {
    enabled = value;
    savePreferences();
}

export function isSoundEnabled(): boolean {
    return enabled;
}

export function setSoundVolume(value: number): void {
    volume = Math.max(0, Math.min(1, value));
    savePreferences();

    for (const audio of audioCache.values()) {
        audio.volume = volume;
    }
}

export function getSoundVolume(): number {
    return volume;
}

export function preloadSounds(): void {
    for (const sound of Object.keys(sounds) as SoundName[]) {
        getAudio(sound);
    }
}