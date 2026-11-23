# Area Video Recorder (Chrome extension, MV3)

Record **a selected area** of the current tab, including everything happening there (video, animations, scrolling, playback), together with **tab audio + your microphone voice**. A text label is burned into the video.

## Install
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `video-recorder` folder.

## Use
1. Click the extension icon.
2. (Optional) Set up the **Label overlay**:
   - Text (multi-line allowed)
   - Position: one of 9 combinations: top / middle / bottom × left / center / right
   - Size (px), Rotation (°), color, bold, background
   - A live preview shows the result.
3. (Optional) Set up **Video effects**. They are applied automatically to every frame while recording:
   - Presets: Black & white, Noir, Sepia, Vintage, Warm, Cool, Vivid, Dramatic, Faded, Invert
   - Fine-tune: Brightness, Contrast, Saturation, Hue, Blur, Pixelate, Vignette, Film grain
   - **Reset** turns all effects off. The preview shows the effect and the label together.
   - The label is drawn after the effects, so it stays sharp and keeps its colors.
4. Choose audio (tab audio / microphone), format (WebM / MP4), quality and FPS.
5. Click **Select area & record**, then drag a rectangle on the page.
   `Enter` = whole tab, `Esc` = cancel. Or use **Record whole visible tab**.
6. A red frame marks the recorded area. Interact with the page normally.
7. Stop with the floating **Stop** button (you can drag it) or from the popup.
8. Open the popup again. Your recordings are listed with a preview. Type a name (optional) and click **Download**. Use **✕** to delete one or **Clear all** to delete everything.

The first time you use the microphone, a tab opens to ask for permission. Click **Allow**, then start again.

## Notes
- The area is fixed to the **viewport** (the screen region), not to a page element. If you scroll, whatever moves into that region gets recorded.
- Browser pages (`chrome://`, Web Store) cannot be captured.
- Recordings are stored locally in IndexedDB until you delete them.
- MediaRecorder WebM files don't contain duration metadata, so some players show the length only after playback finishes or seek slowly. Choose MP4 if your player has problems.

## Files
| File | Role |
|---|---|
| `background.js` | Service worker: orchestrates the flow and keeps state |
| `offscreen.js` | Tab capture, cropping, effects and label on each frame, audio mixing, MediaRecorder |
| `content.js` | Area selection overlay, recording frame and stop toolbar |
| `popup.*` | Settings, label editor, recordings list (download / delete / clear all) |
| `permission.*` | One-time microphone permission page |
| `effects.js` | Effect presets and renderer, shared by the recorder and the popup preview |
| `db.js` | IndexedDB storage for recordings |
