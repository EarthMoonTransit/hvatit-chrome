import {normalizeTarget, modeLabel} from "./domains.js";

const form = document.querySelector("#add-form");
const input = document.querySelector("#site");
const mode = document.querySelector("#mode");
const hint = document.querySelector("#hint");
const status = document.querySelector("#status");
const currentButton = document.querySelector("#current-button");
const addButton = document.querySelector("#add-button");
const list = document.querySelector("#sites");
let currentAddress = null;
let ready = false;
let busy = false;

function showStatus(message, kind = "success") {
  status.textContent = message;
  status.dataset.kind = kind;
}
function setBusy(value) {
  busy = value;
  input.disabled = value || !ready;
  mode.disabled = value || !ready;
  addButton.disabled = value || !ready;
  currentButton.disabled = value || !ready || !currentAddress;
  for (const button of list.querySelectorAll("button")) button.disabled = value || !ready;
}
async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({type, ...fields});
  if (!response?.ok) throw new Error(response?.error || "Не удалось связаться с расширением. Открой его заново.");
  return response;
}
function render(entries) {
  list.replaceChildren();
  document.querySelector("#count").textContent = entries.length;
  document.querySelector("#empty").hidden = entries.length > 0;
  for (const entry of entries) {
    const row = document.createElement("li");
    row.className = "site-row";
    const symbol = document.createElement("span");
    symbol.className = "site-symbol";
    symbol.textContent = entry.domain[0];
    symbol.setAttribute("aria-hidden", "true");
    const info = document.createElement("span");
    info.className = "site-info";
    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = entry.value;
    const scope = document.createElement("span");
    scope.className = "site-mode";
    scope.textContent = modeLabel(entry.mode);
    info.append(name, scope);
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "Убрать";
    remove.setAttribute("aria-label", `Убрать правило ${entry.value}, ${modeLabel(entry.mode)}`);
    remove.addEventListener("click", () => mutate("remove", entry.id));
    row.append(symbol, info, remove);
    list.append(row);
  }
}
async function mutate(type, value) {
  if (busy || !ready) return;
  try {
    const target = type === "add" ? normalizeTarget(value, mode.value) : null;
    setBusy(true);
    showStatus("");
    const result = await send(type, type === "add" ? {value: target.value, mode: target.mode} : {id: value});
    render(result.entries);
    if (type === "add") input.value = "";
    updateHint();
    showStatus(result.warning || (result.duplicate ? `${target.value} уже в списке.` :
      type === "add" ? `Добавлено: ${target.value} · ${modeLabel(target.mode).toLowerCase()}.` : "Правило удалено. Можно открыть страницу заново."));
  } catch (error) {
    showStatus(error.message || "Не удалось сохранить изменения. Попробуй ещё раз.", "error");
  } finally {
    setBusy(false);
    input.focus();
  }
}
form.addEventListener("submit", event => { event.preventDefault(); mutate("add", input.value); });
currentButton.addEventListener("click", () => {
  input.value = currentAddress;
  updateHint();
  input.focus();
});

function updateHint() {
  if (!input.value.trim()) {
    hint.textContent = {
      auto: "Домен → весь сайт; путь → раздел; параметры или # → точная страница.",
      site: "Все страницы домена и его поддоменов.",
      section: "Указанный путь и вложенные страницы. Параметры и # не учитываются.",
      page: "Только этот путь. Параметры и # учитываются, если указаны в ссылке."
    }[mode.value];
    return;
  }
  try {
    const target = normalizeTarget(input.value, mode.value);
    hint.textContent = `${modeLabel(target.mode)}: ${target.value}`;
  } catch {
    hint.textContent = "Вставь полный адрес сайта, раздела или страницы.";
  }
}
input.addEventListener("input", updateHint);
mode.addEventListener("change", updateHint);

async function initialize() {
  try {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error("Установи расширение в Chrome, чтобы добавлять сайты.");
    const result = await send("list");
    render(result.entries);
    ready = true;
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      normalizeTarget(tab?.url || "");
      currentAddress = tab.url;
      currentButton.title = currentAddress;
    } catch { currentAddress = null; }
    setBusy(false);
    input.focus();
  } catch (error) {
    setBusy(false);
    showStatus(error.message, "error");
  }
}
initialize();
