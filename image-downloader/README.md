# Image Downloader

Chrome extension (Manifest V3) that puts a download button on the top-right corner of every real image on the current page (iframes included). Hover over the button to get the hand cursor. Click it and the image downloads right away, with no Save dialog.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this `image-downloader` folder

Tabs that were already open get the buttons automatically when the extension is installed or reloaded.

## Behaviour

- **Small images are skipped.** An image gets a button only if it is shown at least 80 px wide and 80 px high (and at least 100×100 px in area), and the image file itself is at least 64×64 px. That excludes icons, logos, avatars, emoji, spacers and tracking pixels. You can change the limits at the top of `content.js` (`MIN_SIDE`, `MIN_AREA`, `MIN_NATURAL`).
- **File name**: the image's `alt` text, cleaned of characters that aren't allowed in file names. If there is no `alt`, the current date and time is used, e.g. `2026-11-23_22-15-08`. If a file with that name already exists, Chrome adds ` (1)`, ` (2)` and so on.
- **Extension**: the file is saved in its original format with the matching extension (jpg/jpeg, png, gif, webp, avif, svg, bmp, ico, tiff, heic, heif, jxl, apng…). The extension comes from the server's real content type, so a `.jpg` URL that a CDN actually serves as WebP is saved as `.webp`. If the server gives no useful type, the extension from the URL is used.
- Works with `http(s)`, `data:` and `blob:` image sources, `<picture>`/`srcset` (whichever version the browser is showing), and lazy-loaded images.
- The button turns green when the download has started and red if it failed (hover over it to see why).

## Files

- `manifest.json`: extension config
- `content.js`: finds the images, draws the buttons (in a shadow DOM so page CSS can't affect them) and names the file
- `background.js`: downloads the file and picks the correct extension. If Chrome's own download fails (e.g. a site that blocks hotlinking), it fetches the image and saves it another way.

## Limitations

- Only `<img>` elements are covered. CSS `background-image` pictures and `<canvas>` drawings don't get a button.
- If a `blob:` image has already been revoked by the page, it is saved as PNG.
- Pages Chrome doesn't let extensions run on (`chrome://`, the Web Store) are not supported.
