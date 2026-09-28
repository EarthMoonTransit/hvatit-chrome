// URL parses Unicode hostnames into the ASCII form required by Chrome DNR.
function parseAddress(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Вставь ссылку или название сайта.");
  }
  const value = input.trim();
  if (/[\s\\]/u.test(value)) throw new Error("В адресе не должно быть пробелов или обратных слешей.");
  let candidate = value;
  if (value.startsWith("//")) candidate = `https:${value}`;
  else if (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^[^/:]+:\d+(?:[/?#]|$)/.test(value)) {
    candidate = `https://${value}`;
  }
  let url;
  try { url = new URL(candidate); }
  catch { throw new Error("Не похоже на адрес сайта. Например: youtube.com"); }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Подойдут только обычные сайты: http:// или https://.");
  }
  if (url.username || url.password) throw new Error("Введи адрес без логина и пароля.");
  const domain = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const labels = domain.split(".");
  if (domain.length > 253 || !labels.every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) ||
      (labels.length < 2 && domain !== "localhost")) {
    throw new Error("Введи полный домен, например youtube.com. IPv6-адреса не поддерживаются.");
  }
  return {url, domain};
}

export const normalizeDomain = input => parseAddress(input).domain;

export function normalizeTarget(input, mode = "auto") {
  if (!["auto", "site", "section", "page"].includes(mode)) throw new Error("Выбери режим блокировки.");
  const {url, domain} = parseAddress(input);
  if (input.length > 2048) throw new Error("Ссылка слишком длинная. Максимум — 2048 символов.");
  if (mode === "auto") mode = url.search || url.hash ? "page" : url.pathname === "/" ? "site" : "section";
  const path = mode === "site" ? "" : mode === "section" ? url.pathname.replace(/\/+$/, "") || "/" : url.pathname;
  const search = mode === "page" ? url.search : "";
  const hash = mode === "page" ? url.hash : "";
  const value = domain + path + search + hash;
  if (value.length > 2048) throw new Error("Ссылка слишком длинная после кодирования. Сократи её или выбери весь сайт.");
  return {mode, domain, path, search, hash, value};
}

export const modeLabel = mode => ({site: "Весь сайт", section: "Раздел", page: "Точная страница"})[mode];
export const targetKey = target => `${target.mode}:${target.value}`;

function pathWithin(path, section) {
  return section === "/" || path === section || path.startsWith(`${section}/`);
}

export function matchesTarget(urlString, target) {
  if (!matchesDomain(urlString, target.domain)) return false;
  if (target.mode === "site") return true;
  const url = new URL(urlString);
  if (target.mode === "section") return pathWithin(url.pathname, target.path);
  return url.pathname === target.path && (!target.search || url.search === target.search) && (!target.hash || url.hash === target.hash);
}

export function coversTarget(parent, child) {
  if (!matchesDomain(`https://${child.domain}`, parent.domain)) return false;
  if (parent.mode === "site") return true;
  if (child.mode === "site") return false;
  if (parent.mode === "section") return pathWithin(child.path, parent.path);
  return child.mode === "page" && parent.path === child.path &&
    (!parent.search || parent.search === child.search) && (!parent.hash || parent.hash === child.hash);
}

export function matchesDomain(urlString, domain) {
  try {
    const url = new URL(urlString);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch { return false; }
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function targetPattern(target) {
  // Fragments never reach the network. Keep a non-matching persistent rule for
  // these targets and enforce them through webNavigation in the top-level tab.
  if (target.hash) return "^$";
  const start = `^https?://[^/?#]+${escapeRegex(target.path)}`;
  if (target.mode === "section") return target.path === "/" ? start : `${start}([/?#]|$)`;
  return target.search ? `${start}${escapeRegex(target.search)}(#|$)` : `${start}([?#]|$)`;
}

export function blockedURL(target, getURL) {
  return getURL(`blocked.html#v2=${encodeURIComponent(JSON.stringify({mode: target.mode, value: target.value}))}`);
}

export function createRule(target, id, getURL) {
  const condition = {requestDomains: [target.domain], resourceTypes: ["main_frame", "sub_frame"]};
  if (target.mode !== "site") {
    condition.regexFilter = targetPattern(target);
    condition.isUrlFilterCaseSensitive = true;
  }
  return {
    id,
    priority: (target.mode === "page" ? 10000 : target.mode === "section" ? 100 : 0) + target.domain.split(".").length + target.path.length,
    action: {type: "redirect", redirect: {url: blockedURL(target, getURL)}},
    condition
  };
}

export function ruleTarget(rule) {
  const hash = new URL(rule.action.redirect.url).hash;
  if (hash.startsWith("#v2=")) {
    const saved = JSON.parse(decodeURIComponent(hash.slice(4)));
    return normalizeTarget(saved.value, saved.mode);
  }
  // Version 1 saved only domains. Keep those rules without broadening or deleting them.
  return normalizeTarget(rule.condition.requestDomains[0], "site");
}
