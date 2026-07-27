(() => {
  if (window.__meetJoinSoundReplacerInjected) return;
  window.__meetJoinSoundReplacerInjected = true;

  const EVENT_PREFIX = "meet-join-sound-replacer";
  const MAX_UI_SOUND_DURATION = 3;
  const GSTATIC_HINT = /gstatic\.com|googleusercontent\.com/i;

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

  function looksLikeUiSound(el) {
    // Never touch video tiles or live WebRTC streams (participant audio).
    if (!(el instanceof HTMLAudioElement)) return false;
    if (el.srcObject) return false;

    const duration = el.duration;
    // Live/stream media reports Infinity; never treat that as a UI ding.
    if (duration === Infinity) return false;

    const src = mediaSrc(el);
    const finiteDuration = Number.isFinite(duration) ? duration : NaN;

    // Meet join/notification clips are short files, usually from gstatic.
    if (Number.isFinite(finiteDuration) && finiteDuration > MAX_UI_SOUND_DURATION) {
      return false;
    }

    if (src && GSTATIC_HINT.test(src)) {
      return !Number.isFinite(finiteDuration) || finiteDuration <= MAX_UI_SOUND_DURATION;
    }

    // Short blob/data clips without a MediaStream are typical notification sounds.
    if (src.startsWith("blob:") || src.startsWith("data:")) {
      return !Number.isFinite(finiteDuration) || finiteDuration <= MAX_UI_SOUND_DURATION;
    }

    // Empty src without srcObject is uncommon for live audio; only suppress if
    // duration is already known and clearly a short cue.
    if (!src && Number.isFinite(finiteDuration) && finiteDuration > 0 && finiteDuration <= MAX_UI_SOUND_DURATION) {
      return true;
    }

    return false;
  }

  const originalPlay = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function play(...args) {
    if (suppressEnabled && looksLikeUiSound(this)) {
      // Do not mutate muted/volume — Meet may reuse elements.
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
