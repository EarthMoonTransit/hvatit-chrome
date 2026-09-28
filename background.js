import {createManager} from "./manager.js";

const manager = createManager(chrome);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  manager.dispatch(message).then(
    result => sendResponse({ok: true, ...result}),
    error => sendResponse({ok: false, error: error.message || "Не удалось сохранить изменения."})
  );
  return true;
});

// Covers already cached pages and same-tab navigation as well as DNR's network redirects.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === "loading") {
    manager.guardTab(tabId, change.url || tab.pendingUrl || tab.url).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({tabId}) => {
  chrome.tabs.get(tabId)
    .then(tab => manager.guardTab(tabId, tab.pendingUrl || tab.url))
    .catch(() => {});
});

// Site-independent handling of History API navigation, hash routers and Back/Forward cache.
const guardNavigation = details => {
  if (details.frameId === 0) manager.guardTab(details.tabId, details.url).catch(() => {});
};
chrome.webNavigation.onHistoryStateUpdated.addListener(guardNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(guardNavigation);
chrome.webNavigation.onCommitted.addListener(guardNavigation);
