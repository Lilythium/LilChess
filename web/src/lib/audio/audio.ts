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

export function playSound(sound: SoundName): void {
    if (!enabled) return;

    const audio = getAudio(sound);

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