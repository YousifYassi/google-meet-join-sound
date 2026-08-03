# Chrome Web Store — copy/paste answers

Use these on the [item edit page](https://chrome.google.com/webstore/devconsole/7f9b81c3-1a7f-4fe2-9adf-59e4b9c69711/nhdbdjghmhpifmbjhchplhdnoedfklie/edit).

## Store listing (already partly filled)

| Field | Value |
|--------|--------|
| Category | **Tools** (under Productivity) |
| Language | **English (United States)** |
| Homepage URL | `https://github.com/YousifYassi/google-meet-join-sound` |
| Support URL | `https://github.com/YousifYassi/google-meet-join-sound/issues` |
| Official URL | `yassitechnologyservices.ca` |
| Mature content | Off |

### Description (paste if missing)

```
Hate Google Meet’s join ding? Meet Join Sound Replacer replaces that notification sound on your computer with something you actually want to hear.

Choose how joins are announced:
• Text-to-speech — speaks a custom phrase (default: “User joined”), and can say a participant’s name when Meet shows it
• Custom sound — upload your own short audio file (WAV, MP3, OGG, and similar; max 2 MB)
• Mute only — silence the join ding with no replacement

How to use:
1. Install the extension and open a Meet call
2. Click the extension icon
3. Turn Enabled on and pick a mode
4. Optionally upload a sound or edit the TTS phrase
5. Use Preview to test instantly

Notes:
• The replacement plays only on your machine. Other participants still hear Meet’s default sound on theirs.
• Your settings and uploaded sound are stored locally in Chrome. Nothing is uploaded to a remote server.
• This extension is not affiliated with Google.
• Meet’s interface can change over time; if join detection needs a tweak after a Meet update, reload the Meet tab or check for an extension update.

Permissions explained:
• storage — saves your preferences and custom sound on your device
• meet.google.com access — required so the extension can mute Meet’s join ding and play your replacement while you are in a meeting
```

### Images to upload (required)

Files are ready in `store-assets/` (1280×800, 24-bit PNG, no alpha):

1. **Store icon (128×128):** `store-assets/store-icon-128.png`
2. **Screenshots** (upload in this order — real Meet + popup shots):
   - `store-assets/screenshot-01-tts.png` — Text-to-speech mode
   - `store-assets/screenshot-02-custom.png` — Custom sound mode
   - `store-assets/screenshot-03-mute.png` — Mute only mode

Drop the icon onto **Store icon**, and the three screenshots onto **Screenshots**. Small/marquee promo tiles are optional.

---

## Privacy tab

### Single purpose description

```
Replace Google Meet’s local join notification sound with a custom sound, text-to-speech, or silence on the user’s device.
```

### storage justification

```
Stores user preferences (enabled, mode, TTS phrase, volume) and an optional uploaded custom sound file locally via chrome.storage.local. Data never leaves the user’s browser.
```

### Host permission justification (`https://meet.google.com/*`)

```
Required to run content scripts on Meet pages so the extension can mute Meet’s join ding and play the user’s chosen replacement when someone joins a meeting.
```

### Remote code

Select **No** (this extension does not use remote code).

If a justification box still appears:

```
This extension does not execute remote code. All logic ships inside the extension package.
```

### Privacy policy URL

```
https://raw.githubusercontent.com/YousifYassi/google-meet-join-sound/main/PRIVACY.md
```

(Repo must be public so Chrome can reach this URL.)

### Data usage certification

Check the box certifying compliance with Chrome Web Store Developer Program Policies.

Typical data practice answers for this extension:

- **Does not** sell user data
- **Does not** use data for advertising
- User data is used only to provide the extension’s features (local settings / custom sound)
- Data is stored locally; not transferred to a developer server

---

## Test instructions tab

```
1. Install the extension.
2. Open https://meet.google.com and join a meeting.
3. Click the extension icon → leave Enabled on → choose Text-to-speech (or upload a short audio file).
4. Optionally click Preview in the popup to hear the replacement.
5. Have a second account/browser join the same meeting.
6. Confirm Meet’s default join ding is silenced and the TTS/custom sound plays instead on the machine with the extension installed.
```

---

## Still required on your account (Settings)

1. Open the developer dashboard **Account / Settings** page.
2. Add and **verify a publisher contact email**.
3. Click **Save draft** on the item, then **Submit for review** when the checklist is clear.
