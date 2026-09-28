import {normalizeDomain} from "./domains.js";

const form = document.querySelector("#add-form");
const input = document.querySelector("#site");
const status = document.querySelector("#status");
const currentButton = document.querySelector("#current-button");
const addButton = document.querySelector("#add-button");
const list = document.querySelector("#sites");
let currentDomain = null;
let ready = false;
let busy = false;

function showStatus(message, kind = "success") {
  status.textContent = message;
  status.dataset.kind = kind;
}
function setBusy(value) {
  busy = value;
  input.disabled = value || !ready;
  addButton.disabled = value || !ready;
  currentButton.disabled = value || !ready || !currentDomain;
  for (const button of list.querySelectorAll("button")) button.disabled = value || !ready;
}
async function send(type, value) {
  const response = await chrome.runtime.sendMessage({type, value});
  if (!response?.ok) throw new Error(response?.error || "Не удалось связаться с расширением. Открой его заново.");
  return response;
}
function render(domains) {
  list.replaceChildren();
  document.querySelector("#count").textContent = domains.length;
  document.querySelector("#empty").hidden = domains.length > 0;
  for (const domain of domains) {
    const row = document.createElement("li");
    row.className = "site-row";
    const symbol = document.createElement("span");
    symbol.className = "site-symbol";
    symbol.textContent = domain[0];
    symbol.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = domain;
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "Убрать";
    remove.setAttribute("aria-label", `Разблокировать ${domain}`);
    remove.addEventListener("click", () => mutate("remove", domain));
    row.append(symbol, name, remove);
    list.append(row);
  }
}
async function mutate(type, value) {
  if (busy || !ready) return;
  try {
    const domain = normalizeDomain(value);
    setBusy(true);
    showStatus("");
    const result = await send(type, domain);
    render(result.domains);
    if (type === "add") input.value = "";
    showStatus(result.warning || (result.duplicate ? `${domain} уже в списке.` :
      type === "add" ? `${domain} заблокирован.` : `${domain} разблокирован. Можно открыть сайт заново.`));
  } catch (error) {
    showStatus(error.message || "Не удалось сохранить изменения. Попробуй ещё раз.", "error");
  } finally {
    setBusy(false);
    input.focus();
  }
}
form.addEventListener("submit", event => { event.preventDefault(); mutate("add", input.value); });
currentButton.addEventListener("click", () => mutate("add", currentDomain));

async function initialize() {
  try {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error("Установи расширение в Chrome, чтобы добавлять сайты.");
    const result = await send("list");
    render(result.domains);
    ready = true;
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      currentDomain = normalizeDomain(tab?.url || "");
      currentButton.title = currentDomain;
    } catch { currentDomain = null; }
    setBusy(false);
    input.focus();
  } catch (error) {
    setBusy(false);
    showStatus(error.message, "error");
  }
}
initialize();
