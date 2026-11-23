# Blob Video Downloader

Chrome extension (Manifest V3) that lists every video on the current page, both `blob:` videos and normal URL videos, across all frames/iframes. Click any video in the list to download it. Files are named with the current date & time, e.g. `video_2026-11-23_22-15-08.mp4`.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this `blob-downloader` folder
4. **Reload any tabs that were already open** (the capture hook only attaches to pages loaded after install)

## How it works

| What | How it's found | How it's downloaded |
|---|---|---|
| Blob videos (`URL.createObjectURL(blob)`) | `inject.js` hooks `createObjectURL` at `document_start` in every frame and keeps a reference to the Blob, so it still works after the page revokes the URL | Saved from inside the page |
| Streaming blob videos (MediaSource / MSE, used by most video sites) | `inject.js` hooks `SourceBuffer.appendBuffer` and records every chunk the player appends | The recorded chunks are joined into one file per track (video / audio) |
| `<video>` / `<source>` elements, links to video files (incl. shadow DOM) | DOM scan of every frame when the popup opens | `chrome.downloads` |
| Video files seen in network traffic (mp4, webm, m3u8, mpd, …) | `background.js` via `webRequest` | `chrome.downloads` |

## Managing the list

- **×** on a row removes that video from the list.
- **Clear all** in the header removes every video.
- Removed videos stay hidden on **Refresh** and reappear only when the page is reloaded or navigates. For blob/streaming videos, removing also frees the captured data from the page's memory and stops capturing that stream. To capture it again, reload the page.

## Notes / limitations

- **Streaming (MSE) videos are captured while they play.** Play the video from start to end without seeking to get a complete file. Seeking or quality changes can leave gaps or mixed segments.
- Many sites send **video and audio as separate tracks**; they are listed and saved separately (`video_….mp4` + `audio_….m4a`). Merge them with e.g. `ffmpeg -i video.mp4 -i audio.m4a -c copy out.mp4`.
- DRM-protected videos (Netflix, Prime, etc.) are encrypted and won't play after download.
- `.m3u8` / `.mpd` entries are only playlist files. For HLS/DASH, play the video and use the "Streaming blob video" entry instead.
- MSE capture is capped at ~2 GB per frame.
- Chrome may ask "Allow multiple downloads?" the first time a site saves more than one file. Allow it.

## Files

- `manifest.json`: extension config
- `inject.js`: page hook (MAIN world): captures blobs and MediaSource data
- `background.js`: records video URLs seen in network traffic, per tab
- `popup.html` / `popup.css` / `popup.js`: list UI, scanning and downloading
