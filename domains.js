// URL parses Unicode hostnames into the ASCII form required by Chrome DNR.
export function normalizeDomain(input) {
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
  return domain;
}

export function matchesDomain(urlString, domain) {
  try {
    const url = new URL(urlString);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch { return false; }
}

export function createRule(domain, id, getURL) {
  return {
    id,
    priority: domain.split(".").length,
    action: {type: "redirect", redirect: {url: getURL(`blocked.html#${encodeURIComponent(domain)}`)}},
    condition: {requestDomains: [domain], resourceTypes: ["main_frame", "sub_frame"]}
  };
}

export function ruleDomain(rule) {
  return rule.condition.requestDomains[0];
}
