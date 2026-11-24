# Chat Media: AI Content Generator

A Chrome extension (Manifest V3, side panel) that generates **text, images and video** with **OpenAI**, **Google Gemini** and **xAI Grok**.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `Chat-Media` folder.
3. Click the toolbar icon. The panel opens on the side of the browser.

## Use

1. **API keys** tab: save a key for each provider. You can also pick *Enter key manually…* on the Generate tab and paste a key just for this session, with an optional **Save this key** box.
2. **Prompts** tab: save system prompts (name + text). You can edit or delete them later.
3. **Generate** tab: choose a provider, media type and model, then a system prompt (optional), an API key and your input (optional). Click **Generate** or press Ctrl+Enter.
4. Results show at the top, newest first:
   - Text: **Copy**
   - Image: **Copy** (as PNG) and **Download**. Click the image to open it full size.
   - Video: **Copy** and **Download**

You need a system prompt, some input, or both. If there's only a system prompt, it's sent as the message. For images and video the system prompt goes in front of your input, because those APIs have no system role.

## Supported providers

| Provider | Text | Image | Video |
|---|---|---|---|
| OpenAI | `/v1/chat/completions` | `/v1/images/generations` (gpt-image, dall-e) | Not available. OpenAI shut down the Sora Videos API on 24 Sep 2026 |
| Gemini | `:generateContent` | `:generateContent` (Gemini image models) or `:predict` (Imagen) | `:predictLongRunning` (Veo), then poll and download |
| Grok (xAI) | `/v1/chat/completions` | `/v1/images/generations` | `/v1/videos/generations`, then poll `/v1/videos/{id}` |

Model IDs change often. The ↻ button next to the model list loads the current models from the provider using your key. **Custom model ID…** lets you type any ID, and it's remembered.

## Notes

- Keys, prompts and settings are stored only in `chrome.storage.local`. They are not synced. Each key is sent only to its own provider.
- Video takes several minutes. Keep the side panel open until it finishes, because closing the panel cancels the job.
- Browsers can't put video files on the clipboard. For Grok videos, **Copy** copies the video link instead. Gemini video links need your API key to open, so use **Download** for those.
- `https://*/*` host permission is there so generated media can be fetched from whatever CDN the provider uses.
- Results last only for the current panel session.
