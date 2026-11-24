// Clicking the toolbar icon opens the side panel. A side panel stays open while
// you browse, so long video jobs aren't lost the way they would be in a popup.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('Chat Media: could not set side panel behavior', err));
