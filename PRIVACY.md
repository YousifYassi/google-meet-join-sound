# Privacy Policy — Meet Join Sound Replacer

**Last updated:** July 24, 2026

Meet Join Sound Replacer (“the Extension”) is published by Yassi Technology Services.

## What the Extension does

The Extension runs only on `meet.google.com`. It mutes Google Meet’s local join notification sound and can play a replacement sound or spoken phrase on your device.

## Data we collect

The Extension does **not** collect, transmit, or sell personal data to any server operated by us.

Settings and optional uploaded audio are stored **locally** in your browser using Chrome’s `chrome.storage.local` API:

- Enabled / disabled state
- Replacement mode (custom sound, text-to-speech, or mute)
- TTS phrase text
- Volume
- Custom sound file (if you upload one), stored as a data URL on your device

None of this data leaves your browser as part of the Extension’s normal operation.

## Permissions

- **storage** — Save your preferences and custom sound on your device.
- **Host access to `https://meet.google.com/*`** — Required to detect join events and mute Meet’s join ding while you use Meet.

## Third parties

The Extension does not use analytics SDKs, advertising networks, or remote code. It is not affiliated with Google.

## Contact

For privacy questions or support, open an issue at:  
https://github.com/YousifYassi/google-meet-join-sound/issues
