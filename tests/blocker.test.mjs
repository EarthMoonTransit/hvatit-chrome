import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {normalizeDomain, normalizeTarget, matchesDomain, createRule, ruleTarget} from '../domains.js';
import {createManager} from '../manager.js';

test('normalizes links, www, case, ports, paths, Unicode and trailing dots', () => {
  for (const [input, expected] of [
    [' HTTPS://WWW.YouTube.com/watch?v=test#x ', 'youtube.com'],
    ['youtube.com', 'youtube.com'], ['//www.youtube.com/a', 'youtube.com'],
    ['m.youtube.com/feed', 'm.youtube.com'], ['example.com:8443/a', 'example.com'],
    ['https://ПРИМЕР.РФ/страница', 'xn--e1afmkfd.xn--p1ai'],
    ['https://www.example.com./', 'example.com'], ['http://127.0.0.1:3000', '127.0.0.1'],
    ['localhost:8000/test', 'localhost']
  ]) assert.equal(normalizeDomain(input), expected, input);
});

test('rejects malformed input, browser pages, credentials and unsupported schemes', () => {
  for (const input of ['', '  ', undefined, 'not a site', 'example', 'https://', 'chrome://extensions',
    'file:///tmp/index.html', 'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com',
    'https://me:secret@example.com', 'example.com\\fake', 'https://[::1]/', 'https://bad..com',
    'https://-bad.com', 'https://foo_bar.com', 'https://*.example.com', 'https://' + 'a'.repeat(64) + '.com']) {
    assert.throws(() => normalizeDomain(input), undefined, String(input));
  }
});

test('matches only the hostname and real subdomains, regardless of port/path/case', () => {
  for (const url of ['http://example.com', 'https://example.com:8443/a?q=1',
    'https://a.b.example.com/test', 'https://EXAMPLE.com./']) assert.ok(matchesDomain(url, 'example.com'), url);
  for (const url of ['https://notexample.com', 'https://example.com.evil.org',
    'https://evil.org/?url=example.com', 'https://example.company', 'chrome://example.com', 'broken']) {
    assert.equal(matchesDomain(url, 'example.com'), false, url);
  }
});

function fixture(initialRules = []) {
  let rules = structuredClone(initialRules);
  let failWrite = false;
  let failTabs = false;
  let unsupportedRegex = false;
  const updates = [];
  const tabs = [{id: 1, url: 'https://www.example.com/x'}, {id: 2, url: 'https://unrelated.com'},
    {id: 3, url: 'https://other.test', pendingUrl: 'https://sub.example.com/x'}];
  const api = {
    runtime: {getURL: path => `chrome-extension://testid/${path}`},
    declarativeNetRequest: {
      getDynamicRules: async () => structuredClone(rules),
      isRegexSupported: async () => ({isSupported: !unsupportedRegex}),
      updateDynamicRules: async ({removeRuleIds = [], addRules = []}) => {
        if (failWrite) throw new Error('Write failed');
        const next = rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
        assert.equal(new Set(next.map(r => r.id)).size, next.length);
        rules = structuredClone(next);
      }
    },
    tabs: {
      query: async () => { if (failTabs) throw new Error('Tab failure'); return structuredClone(tabs); },
      get: async id => structuredClone(tabs.find(tab => tab.id === id)),
      update: async (id, values) => { updates.push({id, ...values}); Object.assign(tabs.find(t => t.id === id), values); }
    }
  };
  return {api, updates, tabs, manager: createManager(api),
    failWrite: value => { failWrite = value; }, failTabs: value => { failTabs = value; },
    unsupportedRegex: value => { unsupportedRegex = value; }};
}

const values = result => result.entries.map(entry => entry.value);
async function remove(f, value, mode = 'site') {
  const {entries} = await f.manager.dispatch({type: 'list'});
  const entry = entries.find(entry => entry.value === value && entry.mode === mode);
  assert.ok(entry);
  return f.manager.dispatch({type: 'remove', id: entry.id});
}

test('adds persistent redirect rules and immediately replaces matching open tabs', async () => {
  const f = fixture();
  const result = await f.manager.dispatch({type: 'add', value: 'https://www.example.com/x', mode: 'site'});
  assert.deepEqual(values(result), ['example.com']);
  const [rule] = await f.api.declarativeNetRequest.getDynamicRules();
  assert.deepEqual(rule.condition, {requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame']});
  assert.equal(ruleTarget(rule).value, 'example.com');
  assert.deepEqual(f.updates.map(t => t.id), [1, 3]);
  assert.deepEqual(values(await createManager(f.api).dispatch({type: 'list'})), ['example.com']);
});

test('concurrent updates do not lose sites or produce duplicate IDs', async () => {
  const f = fixture();
  await Promise.all(['a.example.com', 'b.example.com', 'c.example.com'].map(value => f.manager.dispatch({type: 'add', value})));
  assert.deepEqual(values(await f.manager.dispatch({type: 'list'})), ['a.example.com', 'b.example.com', 'c.example.com']);
});

test('duplicates are normalized and removal only deletes the selected rule', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com'});
  assert.equal((await f.manager.dispatch({type: 'add', value: 'www.example.com/again', mode: 'site'})).duplicate, true);
  await f.manager.dispatch({type: 'add', value: 'another.com'});
  assert.deepEqual(values(await remove(f, 'example.com')), ['another.com']);
  await f.manager.dispatch({type: 'add', value: 'third.com'});
  assert.equal((await f.api.declarativeNetRequest.getDynamicRules()).length, 2);
});

test('failed writes preserve the list and do not poison subsequent requests', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com'});
  f.failWrite(true);
  await assert.rejects(f.manager.dispatch({type: 'add', value: 'another.com'}), /Write failed/);
  await assert.rejects(remove(f, 'example.com'), /Write failed/);
  assert.deepEqual(values(await f.manager.dispatch({type: 'list'})), ['example.com']);
  f.failWrite(false);
  await f.manager.dispatch({type: 'add', value: 'another.com'});
  assert.deepEqual(values(await f.manager.dispatch({type: 'list'})), ['another.com', 'example.com']);
});

test('open-tab failure returns a warning without misreporting a successful saved rule', async () => {
  const f = fixture();
  f.failTabs(true);
  const result = await f.manager.dispatch({type: 'add', value: 'example.com'});
  assert.ok(result.warning);
  assert.deepEqual(values(await f.manager.dispatch({type: 'list'})), ['example.com']);
});

test('removing a child domain warns when its parent remains blocked', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com'});
  await f.manager.dispatch({type: 'add', value: 'sub.example.com'});
  assert.match((await remove(f, 'sub.example.com')).warning, /example.com/);
});

test('cached-page fallback rechecks actual tab URL and leaves unrelated navigations alone', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com'});
  f.updates.length = 0;
  f.tabs[0].url = 'https://unrelated.com';
  await f.manager.guardTab(1, 'https://example.com');
  assert.equal(f.updates.length, 0);
  f.tabs[0].url = 'https://sub.example.com';
  await f.manager.guardTab(1, f.tabs[0].url);
  assert.equal(f.updates.length, 1);
  await f.manager.guardTab(2, 'chrome://extensions');
  assert.equal(f.updates.length, 1);
});

test('adding a section redirects only its open tabs and preserves other paths', async () => {
  const f = fixture();
  f.tabs.splice(0, f.tabs.length,
    {id: 1, url: 'https://vk.ru/feed'}, {id: 2, url: 'https://vk.ru/music'}, {id: 3, url: 'https://vk.ru/feedback'});
  const result = await f.manager.dispatch({type: 'add', value: 'https://vk.ru/feed'});
  assert.equal(result.entries[0].mode, 'section');
  assert.deepEqual(f.updates.map(tab => tab.id), [1]);
  assert.equal(f.tabs[1].url, 'https://vk.ru/music');
  f.updates.length = 0;
  await f.manager.guardTab(2, 'https://vk.ru/feed');
  assert.equal(f.updates.length, 0, 'stale feed event must not overwrite music');
  f.tabs[1].url = 'https://vk.ru/feed?section=news';
  await f.manager.guardTab(2, f.tabs[1].url);
  assert.equal(f.updates.length, 1, 'same-tab navigation to the feed must be caught');
});

test('version 1 domain rules remain intact and warn when a narrower rule is added', async () => {
  const legacy = {id: 7, priority: 2, action: {type: 'redirect', redirect: {url: 'chrome-extension://testid/blocked.html#vk.ru'}},
    condition: {requestDomains: ['vk.ru'], resourceTypes: ['main_frame', 'sub_frame']}};
  const f = fixture([legacy]);
  const initial = await f.manager.dispatch({type: 'list'});
  assert.equal(initial.entries[0].mode, 'site');
  assert.equal(initial.entries[0].id, 7);
  const added = await f.manager.dispatch({type: 'add', value: 'vk.ru/feed'});
  assert.match(added.warning, /более широкое правило: vk.ru/);
  assert.equal(added.entries.length, 2);
  assert.deepEqual((await f.api.declarativeNetRequest.getDynamicRules()).find(r => r.id === 7), legacy);
  const removed = await remove(f, 'vk.ru');
  assert.deepEqual(values(removed), ['vk.ru/feed']);
  f.tabs[1].url = 'https://vk.ru/music';
  await f.manager.guardTab(2, f.tabs[1].url);
  assert.equal(f.updates.length, 0);
});

test('different scope rules coexist and deletion uses an ID without removing siblings', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com/feed', mode: 'section'});
  await f.manager.dispatch({type: 'add', value: 'example.com/feed', mode: 'page'});
  await f.manager.dispatch({type: 'add', value: 'example.com/music', mode: 'page'});
  assert.equal((await f.manager.dispatch({type: 'add', value: 'www.example.com/feed/'})).duplicate, true);
  const remaining = await remove(f, 'example.com/feed', 'page');
  assert.equal(remaining.entries.length, 2);
  assert.ok(remaining.entries.some(e => e.mode === 'section' && e.value === 'example.com/feed'));
  await assert.rejects(f.manager.dispatch({type: 'remove', id: '1'}));
});

test('Chrome regex rejection does not persist a rule or affect open tabs', async () => {
  const f = fixture();
  f.unsupportedRegex(true);
  await assert.rejects(f.manager.dispatch({type: 'add', value: 'example.com/feed'}), /Chrome не может/);
  assert.deepEqual(values(await f.manager.dispatch({type: 'list'})), []);
  assert.equal(f.updates.length, 0);
});

test('background guards History API, fragment and restored navigations only in the top frame', async () => {
  const f = fixture([createRule(normalizeTarget('example.com/#/feed'), 1, path => `chrome-extension://testid/${path}`)]);
  const events = {};
  const event = name => ({addListener: listener => { events[name] = listener; }});
  f.api.runtime.onMessage = event('message');
  f.api.tabs.onUpdated = event('updated');
  f.api.tabs.onActivated = event('activated');
  f.api.webNavigation = {
    onHistoryStateUpdated: event('history'), onReferenceFragmentUpdated: event('fragment'), onCommitted: event('committed')
  };
  const previous = globalThis.chrome;
  globalThis.chrome = f.api;
  try {
    await import('../background.js');
    f.tabs[0].url = 'https://example.com/#/feed';
    events.fragment({frameId: 1, tabId: 1, url: f.tabs[0].url});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.updates.length, 0);
    for (const name of ['history', 'fragment', 'committed']) {
      f.tabs[0].url = 'https://example.com/#/feed';
      events[name]({frameId: 0, tabId: 1, url: f.tabs[0].url});
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(f.updates.length, 3);
  } finally {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  }
});

test('manifest declares required redirects, resources and every referenced local asset exists', async () => {
  const base = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
  assert.ok(manifest.permissions.includes('webNavigation'));
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.ok(manifest.web_accessible_resources.some(r => r.resources.includes('blocked.html')));
  const files = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), 'blocked.html', 'blocked.css', 'blocked.js', 'popup.css', 'popup.js', 'assets/middle-finger.png'];
  await Promise.all(files.map(file => access(new URL(file, base))));
  const blocked = await readFile(new URL('blocked.html', base), 'utf8');
  assert.match(blocked, /🖕/);
  assert.match(blocked.replace(/<[^>]+>/g, ' '), /хватит заниматься\s+хуйней/);
});
