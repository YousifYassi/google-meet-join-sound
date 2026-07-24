(() => {
  if (window.__meetJoinSoundReplacerInjected) return;
  window.__meetJoinSoundReplacerInjected = true;

  const EVENT_PREFIX = "meet-join-sound-replacer";
  const MAX_UI_SOUND_DURATION = 3;
  const GSTATIC_HINT = /gstatic\.com|googleusercontent\.com|meet\.google\.com/i;

  let suppressEnabled = true;

  function emit(name, detail = {}) {
    try {
      document.dispatchEvent(
        new CustomEvent(`${EVENT_PREFIX}:${name}`, {
          detail,
          bubbles: true,
        })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function mediaSrc(el) {
    try {
      return el.currentSrc || el.src || "";
    } catch (_) {
      return "";
    }
  }

  function isVideoElement(el) {
    return el instanceof HTMLVideoElement;
  }

  function looksLikeUiSound(el) {
    if (isVideoElement(el)) return false;
    if (!(el instanceof HTMLAudioElement) && el.tagName !== "AUDIO") {
      // Audio() creates HTMLAudioElement; also catch generic media used for cues
      if (!(el instanceof HTMLMediaElement)) return false;
    }

    const src = mediaSrc(el);
    const duration = Number.isFinite(el.duration) ? el.duration : NaN;

    // Meet often plays short notification clips; skip long media.
    if (Number.isFinite(duration) && duration > MAX_UI_SOUND_DURATION) {
      return false;
    }

    // No src yet / blob / data / gstatic — treat short audio as UI cue.
    if (!src || src.startsWith("blob:") || src.startsWith("data:")) {
      return !Number.isFinite(duration) || duration <= MAX_UI_SOUND_DURATION;
    }

    if (GSTATIC_HINT.test(src)) {
      return !Number.isFinite(duration) || duration <= MAX_UI_SOUND_DURATION;
    }

    // Unknown remote audio: only suppress if clearly very short.
    if (Number.isFinite(duration) && duration > 0 && duration <= MAX_UI_SOUND_DURATION) {
      return true;
    }

    // Duration unknown (NaN) and not an obvious Meet asset — do not suppress.
    return false;
  }

  const originalPlay = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function play(...args) {
    if (suppressEnabled && looksLikeUiSound(this)) {
      try {
        this.muted = true;
        this.volume = 0;
        this.pause();
        this.currentTime = 0;
      } catch (_) {
        /* ignore */
      }

      emit("ui-sound-suppressed", {
        src: mediaSrc(this),
        duration: this.duration,
      });

      return Promise.resolve();
    }

    return originalPlay.apply(this, args);
  };

  document.addEventListener(`${EVENT_PREFIX}:set-suppress`, (event) => {
    suppressEnabled = Boolean(event?.detail?.enabled);
  });

  emit("inject-ready");
})();
