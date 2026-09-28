import {normalizeDomain, matchesDomain, createRule, ruleDomain} from "./domains.js";

// Chrome's persistent dynamic rules are the single source of truth. There is no
// separate saved list that could claim a site is blocked after an API failure.
export function createManager(api) {
  let queue = Promise.resolve();
  const read = () => api.declarativeNetRequest.getDynamicRules();
  const list = rules => rules.map(ruleDomain).sort((a, b) => a.localeCompare(b));
  const blockURL = domain => api.runtime.getURL(`blocked.html#${encodeURIComponent(domain)}`);

  async function redirectOpenTabs(domain) {
    let tabs;
    try { tabs = await api.tabs.query({}); }
    catch { return "Правило сохранено. Обнови уже открытые вкладки этого сайта."; }
    const results = await Promise.allSettled(tabs
      .filter(tab => tab.id !== undefined && matchesDomain(tab.pendingUrl || tab.url, domain))
      .map(tab => api.tabs.update(tab.id, {url: blockURL(domain)})));
    return results.some(result => result.status === "rejected")
      ? "Правило сохранено. Если сайт ещё открыт, обнови его вкладку." : "";
  }

  async function handle(message) {
    const rules = await read();
    if (message?.type === "list") return {domains: list(rules)};
    if (!["add", "remove"].includes(message?.type)) throw new Error("Неизвестная команда.");
    const domain = normalizeDomain(message.value);
    const existing = rules.find(rule => ruleDomain(rule) === domain);
    if (message.type === "add") {
      if (existing) return {domains: list(rules), domain, duplicate: true};
      if (rules.length >= 1000) throw new Error("Лимит — 1000 сайтов. Удали ненужный сайт из списка.");
      const used = new Set(rules.map(rule => rule.id));
      let id = 1;
      while (used.has(id)) id++;
      const rule = createRule(domain, id, path => api.runtime.getURL(path));
      await api.declarativeNetRequest.updateDynamicRules({addRules: [rule], removeRuleIds: []});
      const warning = await redirectOpenTabs(domain);
      return {domains: list([...rules, rule]), domain, warning};
    }
    if (existing) await api.declarativeNetRequest.updateDynamicRules({removeRuleIds: [existing.id], addRules: []});
    const remaining = rules.filter(rule => rule.id !== existing?.id);
    const parent = remaining.find(rule => matchesDomain(`https://${domain}`, ruleDomain(rule)));
    return {
      domains: list(remaining), domain,
      warning: parent ? `Удалено, но сайт всё ещё заблокирован правилом ${ruleDomain(parent)}.` : ""
    };
  }

  return {
    // Serialize writes, including requests from popups in different windows.
    dispatch(message) {
      const result = queue.then(() => handle(message));
      queue = result.catch(() => {});
      return result;
    },
    async guardTab(tabId, url) {
      if (!url || !/^https?:\/\//i.test(url)) return;
      await queue;
      const rules = await read();
      const match = rules.sort((a, b) => b.priority - a.priority).find(rule => matchesDomain(url, ruleDomain(rule)));
      if (!match) return;
      // Re-check after the asynchronous read so a completed navigation is not overwritten.
      const tab = await api.tabs.get(tabId);
      if (matchesDomain(tab.pendingUrl || tab.url, ruleDomain(match))) {
        await api.tabs.update(tabId, {url: blockURL(ruleDomain(match))});
      }
    }
  };
}
