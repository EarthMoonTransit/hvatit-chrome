const domainElement = document.querySelector("#domain");
try {
  const value = location.hash.startsWith("#v2=")
    ? JSON.parse(decodeURIComponent(location.hash.slice(4))).value
    : decodeURIComponent(location.hash.slice(1));
  if (typeof value === "string" && value && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value)) {
    domainElement.textContent = value;
    domainElement.hidden = false;
  }
} catch { /* A malformed hash does not affect the blocking page. */ }

const closeButton = document.querySelector("#close-tab");
if (globalThis.chrome?.tabs?.getCurrent) {
  chrome.tabs.getCurrent().then(tab => {
    if (!tab?.id) return;
    closeButton.hidden = false;
    closeButton.addEventListener("click", async () => {
      try { await chrome.tabs.remove(tab.id); }
      catch { closeButton.textContent = "Закрой вкладку через Ctrl+W / ⌘W"; }
    });
  }).catch(() => {});
}
