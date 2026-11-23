# Screen Capture

Chrome extension (Manifest V3) for capturing any area of a web page by dragging a box over it.

## How it works

1. A small blue capture button sits in the bottom-right corner of every page.
2. Click it (or press **Alt+Shift+S**). The page blurs and the cursor turns into a crosshair.
3. Click where the capture should start and drag to the opposite corner. The selected area stays sharp
   and shows its size while you drag. Press **Esc** to cancel.
4. When you release the mouse, the area is captured, **copied to the clipboard**, and added to the list.
   A toast confirms it. Auto-copy can be turned off in the popup. It needs an https page; elsewhere use **Copy** in the popup.
5. Open the extension popup to see all captures. You can **Copy** (to clipboard), **Download** or **Delete** each one, or use
   **Download all** / **Clear all**.

Files are saved as PNGs in `Downloads/Screen Captures/`. Each capture in the popup has a name field:
if you type a name, the file is saved as `<name>.png`; if you leave it empty, it is named with the current
date and time (`YYYY-MM-DD_HH-MM-SS.png`, with `_1`, `_2`, ... added for **Download all**). Names are saved
as you type and are kept with the capture.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this `screen-capture` folder.

## Notes

- Captures are kept in `chrome.storage.local` (with `unlimitedStorage`) until you delete them, so they
  are still there after a browser restart.
- The popup has a setting to hide the floating button. The popup's **Capture area** button and the
  keyboard shortcut still work when it is hidden.
- Only the visible part of the page can be captured. Chrome does not allow extensions to run on
  `chrome://` pages or the Chrome Web Store.
- Captures are sharp on HiDPI screens and at any page zoom level.

## Files

| File | Purpose |
| --- | --- |
| `content.js` | Floating button, blur overlay, drag selection (inside a Shadow DOM) |
| `background.js` | Takes the screenshot, crops it, stores it, handles downloads and the shortcut |
| `popup.html/css/js` | List of captures with download, delete and download-all |
