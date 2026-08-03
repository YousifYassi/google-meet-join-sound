(() => {
  if (window.__meetJoinSoundReplacerInjected) return;
  window.__meetJoinSoundReplacerInjected = true;

  const EVENT_PREFIX = "meet-join-sound-replacer";
  const MAX_UI_SOUND_DURATION = 3;
  const UI_HOST_HINT =
    /gstatic\.com|googleusercontent\.com|meet\.google\.com|ggpht\.com/i;

  let suppressEnabled = true;

  function emit(name, detail = {}) {
    try {
      document.dispatchEvent(
        new CustomEvent(`${EVENT_PREFIX}:${name}`, {
          detail,
          bubbles: true,
          cancelable: false,
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

  function silenceElement(el) {
    try {
      el.pause();
      el.currentTime = 0;
    } catch (_) {
      /* ignore */
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

    // Known long clips — leave alone.
    if (Number.isFinite(finiteDuration) && finiteDuration > MAX_UI_SOUND_DURATION) {
      return false;
    }

    // Meet join/notification clips are short files from Google hosts, or
    // blob/data URLs. Duration is often still NaN when play() is first called.
    if (src && UI_HOST_HINT.test(src)) return true;
    if (src.startsWith("blob:") || src.startsWith("data:")) return true;

    // Empty/unknown src, short or not-yet-known duration — typical UI cue on Meet.
    if (
      !src &&
      (!Number.isFinite(finiteDuration) ||
        (finiteDuration > 0 && finiteDuration <= MAX_UI_SOUND_DURATION))
    ) {
      return true;
    }

    // Any other short HTMLAudioElement without a MediaStream (delayed admit ding, etc.).
    if (
      Number.isFinite(finiteDuration) &&
      finiteDuration > 0 &&
      finiteDuration <= MAX_UI_SOUND_DURATION
    ) {
      return true;
    }

    // Metadata not loaded yet — on meet.google.com these are almost always UI sounds.
    if (!Number.isFinite(finiteDuration)) return true;

    return false;
  }

  const originalPlay = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function play(...args) {
    if (suppressEnabled && looksLikeUiSound(this)) {
      // Do not mutate muted/volume — Meet may reuse elements.
      silenceElement(this);
      emit("ui-sound-suppressed", {
        src: mediaSrc(this),
        duration: this.duration,
      });
      return Promise.resolve();
    }

    return originalPlay.apply(this, args);
  };

  // Catch autoplay / play paths that bypass our patched play().
  document.addEventListener(
    "play",
    (event) => {
      const el = event.target;
      if (!suppressEnabled || !(el instanceof HTMLAudioElement)) return;
      if (!looksLikeUiSound(el)) return;
      silenceElement(el);
      emit("ui-sound-suppressed", {
        src: mediaSrc(el),
        duration: el.duration,
      });
    },
    true
  );

  // Some Meet cues use Web Audio short buffers instead of <audio>.
  try {
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function start(...args) {
      const buffer = this.buffer;
      const duration = buffer && Number.isFinite(buffer.duration) ? buffer.duration : NaN;
      if (
        suppressEnabled &&
        Number.isFinite(duration) &&
        duration > 0 &&
        duration <= MAX_UI_SOUND_DURATION
      ) {
        emit("ui-sound-suppressed", { src: "webaudio", duration });
        try {
          this.disconnect();
        } catch (_) {
          /* ignore */
        }
        return;
      }
      return originalStart.apply(this, args);
    };
  } catch (_) {
    /* AudioBufferSourceNode may be unavailable */
  }

  document.addEventListener(`${EVENT_PREFIX}:set-suppress`, (event) => {
    suppressEnabled = Boolean(event?.detail?.enabled);
  });

  emit("inject-ready");
})();
