const domainElement = document.querySelector("#domain");
try {
  const domain = decodeURIComponent(location.hash.slice(1));
  if (domain && domain.length <= 253 && /^[a-z\d.-]+$/i.test(domain)) {
    domainElement.textContent = domain;
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
