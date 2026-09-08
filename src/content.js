(() => {
  const EVENT_PREFIX = "meet-join-sound-replacer";
  const DEBOUNCE_MS = 1500;
  const VISIBILITY_GRACE_MS = 3000;
  const SEEN_TOAST_TTL_MS = 60_000;
  // Sound/count often fire before Meet's named toast.
  const NAME_WAIT_MS = 1400;
  // If a generic announcement already started, allow a late name to replace it.
  const NAME_UPGRADE_MS = 2500;
  const PENDING_SCAN_INTERVAL_MS = 200;

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
  let lastPlayWasNameless = false;
  let participantBaseline = null;
  /** @type {Set<string>} */
  let knownParticipantNames = new Set();
  let inCall = false;
  let ignoreJoinsUntil = 0;
  /** True while this tab's user is presenting / screen sharing. */
  let isLocalPresenting = false;
  /** @type {Map<string, number>} */
  const seenJoinToasts = new Map();

  /** @type {ReturnType<typeof setTimeout> | null} */
  let pendingPlayTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pendingScanTimer = null;
  /** @type {string | null} */
  let pendingPlayName = null;

  /** Tile / overflow menu labels that must never be treated as people. */
  const UI_CHROME_LABELS = new Set([
    "remove this tile",
    "minimise",
    "minimize",
    "pin to the screen",
    "pin for everyone",
    "unpin",
    "unpin from the screen",
    "show my full video to others",
    "hide my full video from others",
    "mute",
    "unmute",
    "mute for everyone",
    "more options",
    "more actions",
    "spotlight",
    "remove spotlight",
    "add to spotlight",
    "expand",
    "collapse",
    "close",
    "picture in picture",
    "enter picture in picture",
    "exit picture in picture",
  ]);

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

  function getEffectiveMode() {
    // Avoid announcing over a local screen share (audio may be captured).
    if (isLocalPresenting) return "mute";
    return settings.mode;
  }

  function isMutedMode() {
    return getEffectiveMode() === "mute";
  }

  function stopAnnouncements() {
    cancelPendingPlay();
    try {
      window.speechSynthesis.cancel();
    } catch (_) {
      /* ignore */
    }
  }

  function detectLocalPresenting() {
    // Prefer stable control labels over class names (Meet DOM churns often).
    const selectors = [
      '[aria-label*="Stop presenting" i]',
      '[aria-label*="Stop sharing" i]',
      '[aria-label*="You are presenting" i]',
      '[aria-label*="You are sharing" i]',
      '[data-is-presenting="true"]',
      // Tooltip / title fallbacks on the present control.
      '[title*="Stop presenting" i]',
      '[title*="You are presenting" i]',
    ];
    for (const sel of selectors) {
      if (document.querySelector(sel)) return true;
    }
    return false;
  }

  function updatePresentingState() {
    const wasPresenting = isLocalPresenting;
    isLocalPresenting = detectLocalPresenting();
    if (isLocalPresenting && !wasPresenting) {
      stopAnnouncements();
      // Treat presentation tile churn as known so it isn't a join when sharing ends.
      refreshParticipantBaseline();
    } else if (!isLocalPresenting && wasPresenting) {
      refreshParticipantBaseline();
    }
  }

  function joinsAllowed() {
    if (!settings.enabled) return false;
    if (document.visibilityState !== "visible") return false;
    if (Date.now() < ignoreJoinsUntil) return false;
    return true;
  }

  function isInsideUiChrome(el) {
    if (!(el instanceof Element)) return false;
    return Boolean(
      el.closest('[role="menu"], [role="menuitem"], [role="listbox"]')
    );
  }

  function isUiChromeLabel(raw) {
    if (!raw) return true;
    const label = raw.replace(/\s+/g, " ").trim().toLowerCase();
    if (!label) return true;
    if (UI_CHROME_LABELS.has(label)) return true;
    // Screen-share tile actions: "Don't watch Jane", "Watch Jane", etc.
    if (
      /^don'?t\s+watch\b/i.test(label) ||
      /^stop\s+watching\b/i.test(label) ||
      /^watch\s+.+/i.test(label)
    ) {
      return true;
    }
    // Action-style chrome that isn't a person name.
    return /^(remove|minimi[sz]e|pin|unpin|mute|unmute|hide|show|spotlight|expand|collapse|close|more options|more actions|picture[- ]in[- ]picture)\b/i.test(
      label
    );
  }

  function canPlayNow() {
    const now = Date.now();
    if (now - lastPlayAt < DEBOUNCE_MS) return false;
    lastPlayAt = now;
    return true;
  }

  function rememberToast(text) {
    const key = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) return false;
    const now = Date.now();
    for (const [k, at] of seenJoinToasts) {
      if (now - at > SEEN_TOAST_TTL_MS) seenJoinToasts.delete(k);
    }
    if (seenJoinToasts.has(key)) return false;
    seenJoinToasts.set(key, now);
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

  function stopPendingScans() {
    if (pendingScanTimer !== null) {
      clearInterval(pendingScanTimer);
      pendingScanTimer = null;
    }
  }

  function cancelPendingPlay() {
    if (pendingPlayTimer !== null) {
      clearTimeout(pendingPlayTimer);
      pendingPlayTimer = null;
    }
    stopPendingScans();
    pendingPlayName = null;
  }

  function commitPlay(optionalName) {
    const name =
      typeof optionalName === "string" && optionalName.trim()
        ? optionalName.trim()
        : null;

    // Late named toast after a generic "User joined" — interrupt and upgrade.
    if (
      name &&
      lastPlayWasNameless &&
      Date.now() - lastPlayAt < NAME_UPGRADE_MS
    ) {
      cancelPendingPlay();
      lastPlayWasNameless = false;
      lastPlayAt = Date.now();
      rememberParticipantName(name);
      if (getEffectiveMode() === "tts") {
        playTts(`${name} joined`);
      }
      return;
    }

    cancelPendingPlay();
    if (!joinsAllowed()) return;
    if (isMutedMode()) return;
    if (!canPlayNow()) return;

    if (getEffectiveMode() === "custom") {
      lastPlayWasNameless = false;
      if (name) rememberParticipantName(name);
      else syncKnownParticipantNames();
      playCustom();
      return;
    }

    if (name) {
      lastPlayWasNameless = false;
      rememberParticipantName(name);
      playTts(`${name} joined`);
    } else {
      lastPlayWasNameless = true;
      syncKnownParticipantNames();
      playTts(settings.ttsText);
    }
  }

  function tryResolvePendingName() {
    if (pendingPlayName) return pendingPlayName;

    scanForJoinToasts(document.body);
    if (pendingPlayName) return pendingPlayName;

    const fromDom = findNewestParticipantName();
    if (fromDom) {
      pendingPlayName = fromDom;
      return fromDom;
    }
    return null;
  }

  function startPendingScans() {
    stopPendingScans();
    pendingScanTimer = setInterval(() => {
      if (pendingPlayTimer === null) {
        stopPendingScans();
        return;
      }
      const name = tryResolvePendingName();
      if (name) {
        commitPlay(name);
      }
    }, PENDING_SCAN_INTERVAL_MS);
  }

  /**
   * Coalesce join signals. Nameless cues wait so a toast/DOM name can win.
   * Named cues play immediately (or upgrade a recent generic play).
   */
  function schedulePlay(optionalName) {
    if (!joinsAllowed()) return;
    if (isMutedMode()) return;

    const name =
      typeof optionalName === "string" && optionalName.trim()
        ? optionalName.trim()
        : null;

    if (name) {
      pendingPlayName = name;
      commitPlay(name);
      return;
    }

    // Prefer any name we can already see in the people/tiles DOM.
    const fromDom = findNewestParticipantName();
    if (fromDom) {
      commitPlay(fromDom);
      return;
    }

    if (pendingPlayTimer !== null) return;

    pendingPlayName = null;
    startPendingScans();
    pendingPlayTimer = setTimeout(() => {
      pendingPlayTimer = null;
      stopPendingScans();
      const resolved = pendingPlayName || findNewestParticipantName();
      pendingPlayName = null;
      commitPlay(resolved);
    }, NAME_WAIT_MS);
  }

  function normalizeToastText(text) {
    if (!text) return "";
    return (
      text
        .split(/\n+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .find((line) => line.length > 0) || ""
    );
  }

  function cleanDisplayName(raw) {
    if (!raw) return null;
    let name = raw.replace(/\s+/g, " ").trim();
    name = name.replace(/\s*\(you\)\s*$/i, "").trim();
    name = name.replace(/\s*\(presentation\)\s*$/i, "").trim();
    name = name.replace(/\s*[-–—].*$/, "").trim();
    if (!name || name.length > 80) return null;
    if (/^(you|me|someone|a user|user)$/i.test(name)) return null;
    if (isUiChromeLabel(name)) return null;
    return name;
  }

  function parseJoinName(text) {
    const cleaned = normalizeToastText(text);
    if (!cleaned) return null;
    const patterns = [
      /^(.+?)\s+has\s+joined(?:\s+the\s+(?:meeting|call))?\.?$/i,
      /^(.+?)\s+is\s+joining\.?$/i,
      /^(.+?)\s+joined(?:\s+the\s+(?:meeting|call))?\.?$/i,
      /^you\s+admitted\s+(.+?)\.?$/i,
      /^(.+?)\s+was\s+admitted\.?$/i,
      /^(.+?)\s+entered(?:\s+the\s+(?:meeting|call))?\.?$/i,
    ];
    for (const re of patterns) {
      const match = cleaned.match(re);
      if (match?.[1]) {
        const name = cleanDisplayName(match[1]);
        if (name) return name;
      }
    }
    return null;
  }

  function textLooksLikeJoin(text) {
    const cleaned = normalizeToastText(text);
    if (!cleaned || cleaned.length > 120) return false;
    // Require a leading name — bare "joined" is too ambiguous / partial.
    return (
      /^.+?\s+(?:has\s+)?joined(?:\s+the\s+(?:meeting|call))?\.?$/i.test(
        cleaned
      ) ||
      /^.+?\s+is\s+joining\.?$/i.test(cleaned) ||
      /^you\s+admitted\s+.+/i.test(cleaned) ||
      /^.+?\s+was\s+admitted\.?$/i.test(cleaned) ||
      /^.+?\s+entered(?:\s+the\s+(?:meeting|call))?\.?$/i.test(cleaned)
    );
  }

  function textLooksLikeLeave(text) {
    const cleaned = normalizeToastText(text);
    if (!cleaned || cleaned.length > 120) return false;
    return /^(?:.+?\s+)?(?:has\s+)?left(?:\s+the\s+(?:meeting|call))?\.?$/i.test(
      cleaned
    );
  }

  function textLooksLikePresenting(text) {
    const cleaned = normalizeToastText(text);
    if (!cleaned || cleaned.length > 160) return false;
    return (
      /\b(?:started|is|stopped)\s+presenting\b/i.test(cleaned) ||
      /\b(?:started|is|stopped)\s+sharing(?:\s+(?:their|a)\s+screen)?\b/i.test(
        cleaned
      ) ||
      /\byou\s+are\s+(?:presenting|sharing)\b/i.test(cleaned)
    );
  }

  function getSelfName() {
    const el = document.querySelector("[data-self-name]");
    const attr = el?.getAttribute("data-self-name");
    return cleanDisplayName(attr) || null;
  }

  function collectParticipantNames() {
    const names = new Set();
    const selfName = getSelfName();

    const add = (raw) => {
      const name = cleanDisplayName(raw);
      if (!name) return;
      if (selfName && name.toLowerCase() === selfName.toLowerCase()) return;
      names.add(name);
    };

    document.querySelectorAll("[data-self-name]").forEach((el) => {
      if (isInsideUiChrome(el)) return;
      add(el.getAttribute("data-self-name"));
    });

    document
      .querySelectorAll(
        "[data-participant-id], [data-allocation-index], [data-requested-participant-id]"
      )
      .forEach((el) => {
        if (isInsideUiChrome(el)) return;
        // Ignore overflow menus rendered inside a tile.
        if (el.querySelector('[role="menu"], [role="menuitem"]')) {
          const label = el.getAttribute("aria-label") || "";
          if (label) add(label.split(",")[0]);
          return;
        }
        const label = el.getAttribute("aria-label") || "";
        if (label) add(label.split(",")[0]);
      });

    document
      .querySelectorAll(
        '[aria-label*="Participants" i] [role="listitem"], [aria-label*="People" i] [role="listitem"]'
      )
      .forEach((el) => {
        if (isInsideUiChrome(el)) return;
        if (el.querySelector('[role="menu"], [role="menuitem"]')) return;
        const label = el.getAttribute("aria-label") || "";
        if (label) {
          add(label.split(",")[0].split("\n")[0]);
          return;
        }
        const text = (el.innerText || "").split("\n")[0];
        add(text);
      });

    return names;
  }

  function findNewestParticipantName() {
    const current = collectParticipantNames();
    for (const name of current) {
      if (!knownParticipantNames.has(name)) return name;
    }
    return null;
  }

  function syncKnownParticipantNames() {
    const current = collectParticipantNames();
    // Empty while still in-call is usually a transient tile remount — keep prior names
    // so everyone doesn't look "new" when the DOM comes back.
    if (current.size === 0 && knownParticipantNames.size > 0 && inCall) {
      return;
    }
    knownParticipantNames = current;
  }

  function rememberParticipantName(name) {
    if (name) knownParticipantNames.add(name);
  }

  function countParticipantButtons() {
    const selectors = [
      '[aria-label*="Participants" i] [role="listitem"]',
      '[aria-label*="People" i] [role="listitem"]',
      "[data-participant-id]",
      "[data-self-name]",
    ];

    const found = new Set();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => found.add(el));
    }

    document
      .querySelectorAll(
        "[data-requested-participant-id], [data-allocation-index]"
      )
      .forEach((el) => found.add(el));

    return found.size;
  }

  function detectInCall() {
    const mic = document.querySelector(
      '[aria-label*="microphone" i], [aria-label*="Turn off microphone" i], [aria-label*="Turn on microphone" i], [data-is-muted]'
    );
    return Boolean(mic);
  }

  function refreshParticipantBaseline() {
    const nowInCall = detectInCall();
    inCall = nowInCall;
    if (nowInCall) {
      participantBaseline = countParticipantButtons();
      syncKnownParticipantNames();
    } else {
      participantBaseline = null;
      knownParticipantNames = new Set();
    }
  }

  function armVisibilityGrace() {
    ignoreJoinsUntil = Date.now() + VISIBILITY_GRACE_MS;
    stopAnnouncements();
    updatePresentingState();
    refreshParticipantBaseline();
  }

  function handleToastText(text) {
    if (textLooksLikePresenting(text)) {
      updatePresentingState();
      return;
    }
    if (textLooksLikeLeave(text)) {
      cancelPendingPlay();
      return;
    }
    if (textLooksLikeJoin(text) && rememberToast(text)) {
      schedulePlay(parseJoinName(text));
    }
  }

  function scanForJoinToasts(root = document.body) {
    if (!root || !joinsAllowed()) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_SKIP;
        const role = node.getAttribute("role");
        const live = node.getAttribute("aria-live");
        if (
          role === "alert" ||
          role === "status" ||
          live === "polite" ||
          live === "assertive"
        ) {
          return NodeFilter.FILTER_ACCEPT;
        }
        const text = node.innerText || "";
        if (
          text &&
          text.length < 120 &&
          (textLooksLikeJoin(text) || textLooksLikeLeave(text))
        ) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    while (node) {
      const text = (node.innerText || node.textContent || "").trim();
      if (textLooksLikeLeave(text) || textLooksLikeJoin(text)) {
        handleToastText(text);
        if (textLooksLikeJoin(text)) return;
      }
      node = walker.nextNode();
    }
  }

  function onPossibleParticipantChange() {
    if (!settings.enabled) return;
    updatePresentingState();

    const nowInCall = detectInCall();
    if (nowInCall && !inCall) {
      inCall = true;
      participantBaseline = countParticipantButtons();
      syncKnownParticipantNames();
      return;
    }
    if (!nowInCall) {
      inCall = false;
      participantBaseline = null;
      knownParticipantNames = new Set();
      cancelPendingPlay();
      isLocalPresenting = false;
      return;
    }

    const count = countParticipantButtons();
    const newestName = findNewestParticipantName();

    if (participantBaseline === null) {
      participantBaseline = count;
      syncKnownParticipantNames();
      return;
    }

    if (!joinsAllowed() || isMutedMode()) {
      cancelPendingPlay();
      participantBaseline = count;
      syncKnownParticipantNames();
      return;
    }

    if (count < participantBaseline) {
      cancelPendingPlay();
      syncKnownParticipantNames();
    } else if (count > participantBaseline || newestName) {
      schedulePlay(newestName);
      // If we already know the joiner, record them. If not, leave them unknown
      // so the pending name wait can still discover them from the DOM/toast.
      if (newestName) rememberParticipantName(newestName);
    } else {
      syncKnownParticipantNames();
    }
    participantBaseline = count;
  }

  function onUiSoundSuppressed() {
    updatePresentingState();
    if (!joinsAllowed() || isMutedMode()) return;
    if (!inCall && !detectInCall()) return;
    inCall = true;

    const count = countParticipantButtons();
    const newestName = findNewestParticipantName();

    if (participantBaseline === null) {
      participantBaseline = count;
      syncKnownParticipantNames();
      return;
    }

    if (count > participantBaseline || newestName) {
      schedulePlay(newestName);
      participantBaseline = Math.max(count, participantBaseline);
      if (newestName) rememberParticipantName(newestName);
    } else if (count < participantBaseline) {
      cancelPendingPlay();
      participantBaseline = count;
      syncKnownParticipantNames();
    }
  }

  document.addEventListener(`${EVENT_PREFIX}:ui-sound-suppressed`, () => {
    onUiSoundSuppressed();
  });

  document.addEventListener(`${EVENT_PREFIX}:inject-ready`, () => {
    syncSuppressToPage();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      armVisibilityGrace();
    } else {
      stopAnnouncements();
    }
  });

  window.addEventListener("focus", () => {
    armVisibilityGrace();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    loadSettings().then(() => {
      if (isMutedMode()) stopAnnouncements();
    });
  });

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;

    let shouldScanParticipants = false;
    let sawNonMenuDomChange = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        shouldScanParticipants = true;
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (!isInsideUiChrome(node)) {
              sawNonMenuDomChange = true;
              if (joinsAllowed()) scanForJoinToasts(node);
            }
          } else if (node.nodeType === Node.TEXT_NODE) {
            if (!isInsideUiChrome(node.parentElement)) {
              sawNonMenuDomChange = true;
              if (joinsAllowed()) handleToastText(node.textContent || "");
            }
          }
        }
        if (mutation.removedNodes.length > 0) {
          for (const node of mutation.removedNodes) {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              !isInsideUiChrome(node)
            ) {
              sawNonMenuDomChange = true;
              break;
            }
          }
        }
      } else if (mutation.type === "characterData") {
        const parent = mutation.target?.parentElement;
        if (isInsideUiChrome(parent)) continue;
        sawNonMenuDomChange = true;
        if (!joinsAllowed()) continue;
        handleToastText(mutation.target?.textContent || "");
      }
    }

    // Opening a tile overflow menu should not look like a participant join.
    if (shouldScanParticipants && sawNonMenuDomChange) {
      onPossibleParticipantChange();
    } else if (shouldScanParticipants) {
      updatePresentingState();
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
    updatePresentingState();
    refreshParticipantBaseline();
    ignoreJoinsUntil = Date.now() + VISIBILITY_GRACE_MS;
    setInterval(() => {
      if (settings.enabled) onPossibleParticipantChange();
    }, 2000);
  });
})();
