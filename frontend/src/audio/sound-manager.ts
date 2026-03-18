type SoundId = 'hover' | 'select' | 'event' | 'error' | 'complete';

class SoundManager {
  private context: AudioContext | null = null;
  private muted = false;
  private lastPlayedAt = 0;
  private readonly cooldownMs = 80;

  get isMuted() {
    return this.muted;
  }

  setMuted(value: boolean) {
    this.muted = value;
  }

  toggleMuted() {
    this.muted = !this.muted;
    return this.muted;
  }

  play(sound: SoundId) {
    if (this.muted || typeof window === 'undefined') {
      return;
    }

    const nowMs = performance.now();
    if (nowMs - this.lastPlayedAt < this.cooldownMs) {
      return;
    }
    this.lastPlayedAt = nowMs;

    const context = this.getContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    const triggerOscillator = (frequency: number, start: number, end: number, type: OscillatorType, peak = 0.4) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * peak), end);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.45, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    };

    switch (sound) {
      case 'hover':
        triggerOscillator(660, now, now + 0.08, 'triangle', 0.82);
        break;
      case 'select':
        triggerOscillator(520, now, now + 0.12, 'sine', 1.18);
        triggerOscillator(780, now + 0.05, now + 0.18, 'triangle', 0.94);
        break;
      case 'event':
        triggerOscillator(440, now, now + 0.12, 'triangle', 1.3);
        triggerOscillator(660, now + 0.04, now + 0.18, 'sine', 1.06);
        break;
      case 'error':
        triggerOscillator(220, now, now + 0.2, 'sawtooth', 0.5);
        break;
      case 'complete':
        triggerOscillator(392, now, now + 0.12, 'triangle', 1.12);
        triggerOscillator(523, now + 0.08, now + 0.2, 'triangle', 1.14);
        triggerOscillator(659, now + 0.16, now + 0.3, 'triangle', 1.18);
        break;
    }
  }

  private getContext() {
    if (this.context) {
      if (this.context.state === 'suspended') {
        void this.context.resume();
      }
      return this.context;
    }

    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }

    this.context = new AudioCtor();
    return this.context;
  }
}

export const soundManager = new SoundManager();
