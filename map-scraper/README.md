# Google Maps Business Scraper (Chrome extension)

## Install
1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension to the toolbar.

## Use
1. Go to Google Maps and search, e.g. `restaurants in Pune`.
2. Click the extension, then **Start scraping**.
3. Scroll the results sidebar. New businesses are picked up as they load (or tick **Auto-scroll**).
4. Click **Export CSV**. The file is saved as `<search text>_<YYYY-MM-DD>.csv`, e.g. `restaurants_in_Pune_2026-11-18.csv`.

With **Open each listing for full details** ticked (the default), the scraper clicks each result in turn to read its
phone, website, full address, plus code, hours and so on. Untick it for a faster scrape that reads only the result cards.

Scraped data is kept in extension storage until you click **Clear data**. Starting again with the same search continues
the same dataset. Starting with a different search begins a new one.

## CSV columns
Name, Category, Rating, Reviews, Phone, Website, Address, Plus Code, Located In, Open Status, Opening Hours,
Price Level, Description, Claimed, Menu URL, Booking URL, Latitude, Longitude, CID, Place ID, Google Maps URL,
Search Query, Scraped At.

## Notes
- Google Maps changes its page code from time to time. If fields come back empty, update the selectors in `content.js`.
- Reloading the Maps tab stops scraping. Click Start again to resume; data already collected is kept.
