# Meet Join Sound Replacer

Chrome extension that silences Google Meet’s join ding and replaces it with a custom sound, text-to-speech, or silence.

Replacement audio plays **only on your machine**. Other participants still hear Meet’s default sound.

## Install (Load unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (the one that contains `manifest.json`)
5. Pin the extension from the puzzle-piece menu if you like

## Use

1. Open [Google Meet](https://meet.google.com) and join a call
2. Click the extension icon
3. Leave **Enabled** on
4. Choose a mode:
   - **Text-to-speech** — speaks a phrase (default: “User joined”)
   - **Custom sound** — upload a short WAV/MP3/OGG (max 2 MB)
   - **Mute only** — no join ding and no replacement
5. Use **Preview** to test without waiting for someone to join
6. Reload the Meet tab if you just installed or reloaded the extension

## Notes

- Meet’s UI can change; join detection may need updates later. Short UI-sound suppression is the more stable half.
- TTS voice quality depends on your OS / Chrome voice pack.
- Chat and other short Meet notification sounds may also be muted as a side effect.
