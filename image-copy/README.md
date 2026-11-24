# Image Copy

Chrome extension (Manifest V3) that adds two buttons to the top-right corner of every real image on the page (iframes included):

- **Copy** (two squares): copies the image to the clipboard as PNG.
- **Add to list** (＋): saves the image to the extension's list.

The effect selected in the popup is applied to the image in both cases.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this `image-copy` folder

Tabs that are already open get the buttons as soon as the extension is installed or reloaded, without a page refresh.

## Popup (click the toolbar icon)

- **On/off switch**: shows or hides the buttons on every page. While it's off, the toolbar icon shows an `OFF` badge. The saved list still works.
- **Saved images** tab: shows every saved image, newest first. Each row has a thumbnail, the name (the image's `alt`/`title`, or the date and time), the size and format, the effect used, and the site it came from (click the site to open the page).
  - **Copy**: copies the image to the clipboard.
  - **Download**: saves the image with its name and extension.
  - **Delete**: removes the image from the list.
  - **Delete all**: click it twice to confirm.
  - The **Effect: …** chip shows the current effect. Click it to edit the effect.
- **Effect** tab: choose a preset (B&W, Sepia, Vintage, Vivid, Warm, Cool, Dramatic, Invert, Soft) or set brightness, contrast, saturation, grayscale, sepia, invert, hue, blur and opacity with sliders. Rotate in 90° steps and flip horizontally or vertically. A sample picture previews the result, and the toolbar shows `FX` while an effect is set.
  - The effect is saved and stays selected until you change it. It is used for every **copy** and **add** on the page.
  - With no effect, images are saved unchanged in their original format. Copy always produces a PNG, because that is the only image format the clipboard accepts.
  - Hovering a button on the page previews the effect on that image. Colour changes and flips are previewed; rotation only appears in the result.

## Behaviour

- Small images are skipped. An image gets buttons only if it is shown at least 80×80 px and the file itself is at least 64×64 px. You can change these limits at the top of `content.js`.
- The buttons turn green when the action works and red when it fails. Hover a red button to see the reason.
- With an effect set, JPG, PNG and WebP keep their format. Other formats (GIF, SVG, AVIF…) are saved as PNG, and animated images keep only their first frame.
- Images are fetched by the extension, so cross-site images work. If a site blocks that (hotlink protection), the extension uses the pixels the page has already loaded, when the browser allows it.

## Files

- `manifest.json`: extension config
- `content.js`: finds the images, draws the buttons in a shadow DOM, and handles copy and add on the page
- `background.js`: processes copy and add requests, manages the saved list, and updates the toolbar badge
- `offscreen.html` / `offscreen.js`: hidden page that fetches images and applies the effect on a canvas
- `popup.html` / `popup.css` / `popup.js`: on/off switch, saved list and effect editor
- `shared.js`: effect, format, naming and storage helpers

Saved images are kept in the extension's IndexedDB. The list of names, sizes and so on is in `chrome.storage.local`.

## Limitations

- Copying on the page needs a secure (`https`) page. On `http` pages, use **Add to list** and copy from the popup. Some cross-origin iframes also block clipboard access.
- Only `<img>` elements get buttons. CSS background images and `<canvas>` drawings don't.
- The extension can't run on `chrome://` pages or the Chrome Web Store.
