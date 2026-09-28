import {normalizeTarget, matchesTarget, coversTarget, targetKey, createRule, ruleTarget, blockedURL} from "./domains.js";

// Chrome's persistent dynamic rules are the single source of truth. There is no
// separate saved list that could claim a site is blocked after an API failure.
export function createManager(api) {
  let queue = Promise.resolve();
  const read = () => api.declarativeNetRequest.getDynamicRules();
  const list = rules => rules.map(rule => ({id: rule.id, ...ruleTarget(rule)}))
    .sort((a, b) => a.value.localeCompare(b.value) || a.mode.localeCompare(b.mode));
  const blockURL = target => blockedURL(target, path => api.runtime.getURL(path));
  const coveringRule = (rules, target) => rules.find(rule => coversTarget(ruleTarget(rule), target));
  const coverageWarning = (rules, target) => {
    const covering = coveringRule(rules, target);
    return covering ? `Есть более широкое правило: ${ruleTarget(covering).value}. Убери его из списка, чтобы оставить доступ к остальным страницам.` : "";
  };
  function serial(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }

  async function redirectOpenTabs(target) {
    let tabs;
    try { tabs = await api.tabs.query({}); }
    catch { return "Правило сохранено. Обнови уже открытые вкладки этого сайта."; }
    const results = await Promise.allSettled(tabs
      .filter(tab => tab.id !== undefined && matchesTarget(tab.pendingUrl || tab.url, target))
      .map(async tab => {
        const current = await api.tabs.get(tab.id);
        if (matchesTarget(current.pendingUrl || current.url, target)) {
          await api.tabs.update(tab.id, {url: blockURL(target)});
        }
      }));
    return results.some(result => result.status === "rejected")
      ? "Правило сохранено. Если сайт ещё открыт, обнови его вкладку." : "";
  }

  async function handle(message) {
    const rules = await read();
    if (message?.type === "list") return {entries: list(rules)};
    if (!["add", "remove"].includes(message?.type)) throw new Error("Неизвестная команда.");
    if (message.type === "add") {
      const target = normalizeTarget(message.value, message.mode);
      const existing = rules.find(rule => targetKey(ruleTarget(rule)) === targetKey(target));
      if (existing) return {entries: list(rules), target, duplicate: true,
        warning: coverageWarning(rules.filter(rule => rule.id !== existing.id), target)};
      if (rules.length >= 1000) throw new Error("Лимит — 1000 правил. Удали ненужное правило из списка.");
      const used = new Set(rules.map(rule => rule.id));
      let id = 1;
      while (used.has(id)) id++;
      const rule = createRule(target, id, path => api.runtime.getURL(path));
      if (rule.condition.regexFilter) {
        const support = await api.declarativeNetRequest.isRegexSupported({regex: rule.condition.regexFilter, isCaseSensitive: true});
        if (!support.isSupported) throw new Error("Chrome не может обработать такую длинную или сложную ссылку. Сократи её или выбери раздел.");
      }
      await api.declarativeNetRequest.updateDynamicRules({addRules: [rule], removeRuleIds: []});
      const warning = [coverageWarning(rules, target), await redirectOpenTabs(target)].filter(Boolean).join(" ");
      return {entries: list([...rules, rule]), target, warning};
    }
    if (!Number.isInteger(message.id) || message.id < 1) throw new Error("Не удалось определить правило для удаления.");
    const existing = rules.find(rule => rule.id === message.id);
    if (existing) await api.declarativeNetRequest.updateDynamicRules({removeRuleIds: [existing.id], addRules: []});
    const remaining = rules.filter(rule => rule.id !== existing?.id);
    return {entries: list(remaining), warning: existing ? coverageWarning(remaining, ruleTarget(existing)) : ""};
  }

  return {
    // Serialize writes, including requests from popups in different windows.
    dispatch(message) {
      return serial(() => handle(message));
    },
    async guardTab(tabId, url) {
      if (!url || !/^https?:\/\//i.test(url)) return;
      return serial(async () => {
        const rules = await read();
        const match = rules.sort((a, b) => b.priority - a.priority).find(rule => matchesTarget(url, ruleTarget(rule)));
        if (!match) return;
        // Re-check after the asynchronous read so navigation to an allowed page is not overwritten.
        const tab = await api.tabs.get(tabId);
        if (matchesTarget(tab.pendingUrl || tab.url, ruleTarget(match))) {
          await api.tabs.update(tabId, {url: blockURL(ruleTarget(match))});
        }
      });
    }
  };
}
