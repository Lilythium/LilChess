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

let enabled = true;
let volume = DEFAULT_VOLUME;
let unlocked = false;

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

export function setSoundEnabled(value: boolean): void {
    enabled = value;
}

export function isSoundEnabled(): boolean {
    return enabled;
}

export function setSoundVolume(value: number): void {
    volume = Math.max(0, Math.min(1, value));

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