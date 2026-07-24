(() => {
  const EVENT_PREFIX = "meet-join-sound-replacer";
  const DEBOUNCE_MS = 1500;

  const DEFAULTS = {
    enabled: true,
    mode: "tts",
    ttsText: "User joined",
    customSoundDataUrl: null,
    volume: 0.8,
  };

  /** @type {typeof DEFAULTS} */
  let settings = { ...DEFAULTS };

  let lastPlayAt = 0;
  let participantBaseline = null;
  let inCall = false;

  function clampVolume(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS.volume;
    return Math.min(1, Math.max(0, n));
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(DEFAULTS);
    settings = {
      enabled: stored.enabled !== false,
      mode: ["custom", "tts", "mute"].includes(stored.mode)
        ? stored.mode
        : DEFAULTS.mode,
      ttsText:
        typeof stored.ttsText === "string" && stored.ttsText.trim()
          ? stored.ttsText
          : DEFAULTS.ttsText,
      customSoundDataUrl:
        typeof stored.customSoundDataUrl === "string"
          ? stored.customSoundDataUrl
          : null,
      volume: clampVolume(stored.volume),
    };
    syncSuppressToPage();
  }

  function syncSuppressToPage() {
    document.dispatchEvent(
      new CustomEvent(`${EVENT_PREFIX}:set-suppress`, {
        detail: { enabled: settings.enabled },
        bubbles: true,
      })
    );
  }

  function canPlayNow() {
    const now = Date.now();
    if (now - lastPlayAt < DEBOUNCE_MS) return false;
    lastPlayAt = now;
    return true;
  }

  function playCustom() {
    if (!settings.customSoundDataUrl) return;
    const audio = new Audio(settings.customSoundDataUrl);
    audio.volume = clampVolume(settings.volume);
    audio.play().catch(() => {});
  }

  function playTts(text) {
    const phrase =
      typeof text === "string" && text.trim() ? text.trim() : settings.ttsText;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.volume = clampVolume(settings.volume);
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      /* ignore */
    }
  }

  function playReplacement(optionalName) {
    if (!settings.enabled) return;
    if (settings.mode === "mute") return;
    if (!canPlayNow()) return;

    if (settings.mode === "custom") {
      playCustom();
      return;
    }

    // tts
    if (optionalName) {
      playTts(`${optionalName} joined`);
    } else {
      playTts(settings.ttsText);
    }
  }

  function parseJoinName(text) {
    if (!text) return null;
    const cleaned = text.replace(/\s+/g, " ").trim();
    const patterns = [
      /^(.+?)\s+joined(?:\s+the\s+(?:meeting|call))?\.?$/i,
      /^(.+?)\s+has\s+joined(?:\s+the\s+(?:meeting|call))?\.?$/i,
      /^(.+?)\s+is\s+joining\.?$/i,
    ];
    for (const re of patterns) {
      const match = cleaned.match(re);
      if (match?.[1]) {
        const name = match[1].trim();
        if (name && name.length < 80) return name;
      }
    }
    return null;
  }

  function textLooksLikeJoin(text) {
    if (!text) return false;
    return /\b(joined|is joining|has joined)\b/i.test(text);
  }

  function countParticipantButtons() {
    // Meet commonly exposes people via aria labels / list items in the people panel.
    const selectors = [
      '[aria-label*="Participants" i] [role="listitem"]',
      '[aria-label*="People" i] [role="listitem"]',
      '[data-participant-id]',
      '[data-self-name]',
    ];

    const found = new Set();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => found.add(el));
    }

    // Fallback: tiles that look like participant videos with name labels.
    document
      .querySelectorAll('[data-requested-participant-id], [data-allocation-index]')
      .forEach((el) => found.add(el));

    return found.size;
  }

  function detectInCall() {
    // Mic / camera controls appear once you are in (or about to enter) a call.
    const mic = document.querySelector(
      '[aria-label*="microphone" i], [aria-label*="Turn off microphone" i], [aria-label*="Turn on microphone" i], [data-is-muted]'
    );
    return Boolean(mic);
  }

  function scanForJoinToasts(root = document.body) {
    if (!root || !settings.enabled) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_SKIP;
        const role = node.getAttribute("role");
        const live = node.getAttribute("aria-live");
        if (role === "alert" || role === "status" || live === "polite" || live === "assertive") {
          return NodeFilter.FILTER_ACCEPT;
        }
        // Meet toast / snackbar-ish nodes often have short text.
        const text = node.innerText || "";
        if (text && text.length < 120 && textLooksLikeJoin(text)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    while (node) {
      const text = (node.innerText || node.textContent || "").trim();
      if (textLooksLikeJoin(text)) {
        const name = parseJoinName(text);
        playReplacement(name);
        return;
      }
      node = walker.nextNode();
    }
  }

  function onPossibleParticipantChange() {
    if (!settings.enabled) return;

    const nowInCall = detectInCall();
    if (nowInCall && !inCall) {
      inCall = true;
      participantBaseline = countParticipantButtons();
      return;
    }
    if (!nowInCall) {
      inCall = false;
      participantBaseline = null;
      return;
    }

    const count = countParticipantButtons();
    if (participantBaseline === null) {
      participantBaseline = count;
      return;
    }

    if (count > participantBaseline) {
      playReplacement(null);
    }
    participantBaseline = count;
  }

  function onUiSoundSuppressed() {
    if (!settings.enabled) return;
    // Fallback: only replace when a suppressed ding coincides with more participants.
    // Other short Meet cues (chat, etc.) stay muted without a replacement.
    if (!inCall && !detectInCall()) return;
    inCall = true;

    const count = countParticipantButtons();
    if (participantBaseline === null) {
      participantBaseline = count;
      // If Meet isn't exposing participant nodes, fall back to sound-triggered replace.
      if (count === 0) playReplacement(null);
      return;
    }

    if (count > participantBaseline) {
      playReplacement(null);
      participantBaseline = count;
    }
  }

  document.addEventListener(`${EVENT_PREFIX}:ui-sound-suppressed`, () => {
    onUiSoundSuppressed();
  });

  document.addEventListener(`${EVENT_PREFIX}:inject-ready`, () => {
    syncSuppressToPage();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    loadSettings();
  });

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;

    let shouldScanParticipants = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        shouldScanParticipants = true;
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanForJoinToasts(node);
          } else if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || "";
            if (textLooksLikeJoin(text)) {
              playReplacement(parseJoinName(text));
            }
          }
        }
      } else if (mutation.type === "characterData") {
        const text = mutation.target?.textContent || "";
        if (textLooksLikeJoin(text)) {
          playReplacement(parseJoinName(text));
        }
      }
    }

    if (shouldScanParticipants) {
      onPossibleParticipantChange();
    }
  });

  function startObserver() {
    const target = document.documentElement || document.body;
    if (!target) return;
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  loadSettings().then(() => {
    startObserver();
    // Periodic light check in case mutations are missed for participant tiles.
    setInterval(() => {
      if (settings.enabled) onPossibleParticipantChange();
    }, 2000);
  });
})();
