const DEFAULTS = {
  enabled: true,
  mode: "tts",
  ttsText: "User joined",
  customSoundDataUrl: null,
  volume: 0.8,
};

const MAX_SOUND_BYTES = 2 * 1024 * 1024;

const enabledEl = document.getElementById("enabled");
const ttsTextEl = document.getElementById("ttsText");
const soundFileEl = document.getElementById("soundFile");
const soundStatusEl = document.getElementById("soundStatus");
const clearSoundEl = document.getElementById("clearSound");
const volumeEl = document.getElementById("volume");
const volumeValueEl = document.getElementById("volumeValue");
const previewEl = document.getElementById("preview");
const statusEl = document.getElementById("status");
const ttsSection = document.getElementById("ttsSection");
const customSection = document.getElementById("customSection");
const modeRadios = [...document.querySelectorAll('input[name="mode"]')];

function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.volume;
  return Math.min(1, Math.max(0, n));
}

function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function selectedMode() {
  return modeRadios.find((r) => r.checked)?.value || DEFAULTS.mode;
}

function updateModeSections() {
  const mode = selectedMode();
  ttsSection.classList.toggle("hidden", mode !== "tts");
  customSection.classList.toggle("hidden", mode !== "custom");
  previewEl.disabled = mode === "mute";
}

function updateSoundStatus(dataUrl) {
  const hasSound = Boolean(dataUrl);
  soundStatusEl.textContent = hasSound ? "Custom sound saved" : "No sound uploaded";
  clearSoundEl.hidden = !hasSound;
}

function updateVolumeLabel() {
  volumeValueEl.textContent = `${Math.round(clampVolume(volumeEl.value) * 100)}%`;
}

async function save(patch) {
  await chrome.storage.local.set(patch);
  setStatus("Saved");
}

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  enabledEl.checked = stored.enabled !== false;

  const mode = ["custom", "tts", "mute"].includes(stored.mode)
    ? stored.mode
    : DEFAULTS.mode;
  modeRadios.forEach((radio) => {
    radio.checked = radio.value === mode;
  });

  ttsTextEl.value =
    typeof stored.ttsText === "string" && stored.ttsText.trim()
      ? stored.ttsText
      : DEFAULTS.ttsText;

  volumeEl.value = String(clampVolume(stored.volume));
  updateVolumeLabel();
  updateSoundStatus(stored.customSoundDataUrl);
  updateModeSections();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function playPreview() {
  const mode = selectedMode();
  const volume = clampVolume(volumeEl.value);

  if (mode === "mute") {
    setStatus("Mute mode has nothing to preview");
    return;
  }

  if (mode === "tts") {
    const text = ttsTextEl.value.trim() || DEFAULTS.ttsText;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = volume;
    window.speechSynthesis.speak(utterance);
    setStatus("Playing TTS…");
    return;
  }

  chrome.storage.local.get({ customSoundDataUrl: null }).then(({ customSoundDataUrl }) => {
    if (!customSoundDataUrl) {
      setStatus("Upload a sound first", true);
      return;
    }
    const audio = new Audio(customSoundDataUrl);
    audio.volume = volume;
    audio.play().then(
      () => setStatus("Playing custom sound…"),
      () => setStatus("Could not play sound", true)
    );
  });
}

enabledEl.addEventListener("change", () => {
  save({ enabled: enabledEl.checked });
});

modeRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    updateModeSections();
    save({ mode: selectedMode() });
  });
});

ttsTextEl.addEventListener("change", () => {
  const ttsText = ttsTextEl.value.trim() || DEFAULTS.ttsText;
  ttsTextEl.value = ttsText;
  save({ ttsText });
});

volumeEl.addEventListener("input", updateVolumeLabel);
volumeEl.addEventListener("change", () => {
  save({ volume: clampVolume(volumeEl.value) });
});

soundFileEl.addEventListener("change", async () => {
  const file = soundFileEl.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)) {
    setStatus("Please choose an audio file", true);
    soundFileEl.value = "";
    return;
  }

  if (file.size > MAX_SOUND_BYTES) {
    setStatus("File is larger than 2 MB", true);
    soundFileEl.value = "";
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    await save({ customSoundDataUrl: dataUrl, mode: "custom" });
    modeRadios.find((r) => r.value === "custom").checked = true;
    updateModeSections();
    updateSoundStatus(dataUrl);
    setStatus("Sound uploaded");
  } catch (err) {
    setStatus(err.message || "Upload failed", true);
  } finally {
    soundFileEl.value = "";
  }
});

clearSoundEl.addEventListener("click", async () => {
  await save({ customSoundDataUrl: null });
  updateSoundStatus(null);
  setStatus("Sound cleared");
});

previewEl.addEventListener("click", playPreview);

load().catch(() => setStatus("Could not load settings", true));
