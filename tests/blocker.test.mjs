import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {normalizeDomain, matchesDomain, createRule} from '../domains.js';
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

function fixture() {
  let rules = [];
  let failWrite = false;
  let failTabs = false;
  const updates = [];
  const tabs = [{id: 1, url: 'https://www.example.com/x'}, {id: 2, url: 'https://unrelated.com'},
    {id: 3, url: 'https://other.test', pendingUrl: 'https://sub.example.com/x'}];
  const api = {
    runtime: {getURL: path => `chrome-extension://testid/${path}`},
    declarativeNetRequest: {
      getDynamicRules: async () => structuredClone(rules),
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
    failWrite: value => { failWrite = value; }, failTabs: value => { failTabs = value; }};
}

test('adds persistent redirect rules and immediately replaces matching open tabs', async () => {
  const f = fixture();
  const result = await f.manager.dispatch({type: 'add', value: 'https://www.example.com/x'});
  assert.deepEqual(result.domains, ['example.com']);
  const [rule] = await f.api.declarativeNetRequest.getDynamicRules();
  assert.deepEqual(rule.condition, {requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame']});
  assert.equal(rule.action.redirect.url, 'chrome-extension://testid/blocked.html#example.com');
  assert.deepEqual(f.updates.map(t => t.id), [1, 3]);
  assert.deepEqual(await createManager(f.api).dispatch({type: 'list'}), {domains: ['example.com']});
});

test('concurrent updates do not lose sites or produce duplicate IDs', async () => {
  const f = fixture();
  await Promise.all(['a.example.com', 'b.example.com', 'c.example.com'].map(value => f.manager.dispatch({type: 'add', value})));
  assert.deepEqual((await f.manager.dispatch({type: 'list'})).domains, ['a.example.com', 'b.example.com', 'c.example.com']);
});

test('duplicates are normalized and removal only deletes the selected rule', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com'});
  assert.equal((await f.manager.dispatch({type: 'add', value: 'www.example.com/again'})).duplicate, true);
  await f.manager.dispatch({type: 'add', value: 'another.com'});
  assert.deepEqual((await f.manager.dispatch({type: 'remove', value: 'example.com'})).domains, ['another.com']);
  await f.manager.dispatch({type: 'add', value: 'third.com'});
  assert.equal((await f.api.declarativeNetRequest.getDynamicRules()).length, 2);
});

test('failed writes preserve the list and do not poison subsequent requests', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com'});
  f.failWrite(true);
  await assert.rejects(f.manager.dispatch({type: 'add', value: 'another.com'}), /Write failed/);
  await assert.rejects(f.manager.dispatch({type: 'remove', value: 'example.com'}), /Write failed/);
  assert.deepEqual((await f.manager.dispatch({type: 'list'})).domains, ['example.com']);
  f.failWrite(false);
  await f.manager.dispatch({type: 'add', value: 'another.com'});
  assert.deepEqual((await f.manager.dispatch({type: 'list'})).domains, ['another.com', 'example.com']);
});

test('open-tab failure returns a warning without misreporting a successful saved rule', async () => {
  const f = fixture();
  f.failTabs(true);
  const result = await f.manager.dispatch({type: 'add', value: 'example.com'});
  assert.ok(result.warning);
  assert.deepEqual((await f.manager.dispatch({type: 'list'})).domains, ['example.com']);
});

test('removing a child domain warns when its parent remains blocked', async () => {
  const f = fixture();
  await f.manager.dispatch({type: 'add', value: 'example.com'});
  await f.manager.dispatch({type: 'add', value: 'sub.example.com'});
  assert.match((await f.manager.dispatch({type: 'remove', value: 'sub.example.com'})).warning, /example.com/);
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

test('manifest declares required redirects, resources and every referenced local asset exists', async () => {
  const base = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.ok(manifest.web_accessible_resources.some(r => r.resources.includes('blocked.html')));
  const files = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), 'blocked.html', 'blocked.css', 'blocked.js', 'popup.css', 'popup.js'];
  await Promise.all(files.map(file => access(new URL(file, base))));
  const blocked = await readFile(new URL('blocked.html', base), 'utf8');
  assert.match(blocked, /🖕/);
  assert.match(blocked.replace(/<[^>]+>/g, ' '), /хватит заниматься\s+хуйней/);
});
