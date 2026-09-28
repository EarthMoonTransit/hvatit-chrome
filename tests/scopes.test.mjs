import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTarget, matchesTarget, matchesDomain, createRule, ruleTarget, coversTarget} from '../domains.js';

test('auto selects site, section or page from any address without site-specific logic', () => {
  for (const [value, mode, normalized] of [
    ['https://www.vk.ru/', 'site', 'vk.ru'],
    ['vk.ru/feed/', 'section', 'vk.ru/feed'],
    ['news.example.com/articles', 'section', 'news.example.com/articles'],
    ['youtube.com/watch?v=123', 'page', 'youtube.com/watch?v=123'],
    ['example.com/?page=2', 'page', 'example.com/?page=2'],
    ['example.com/#/feed', 'page', 'example.com/#/feed'],
  ]) {
    const target = normalizeTarget(value);
    assert.equal(target.mode, mode);
    assert.equal(target.value, normalized);
  }
});

test('explicit modes override inference and keep only their relevant URL parts', () => {
  assert.equal(normalizeTarget('example.com/feed?a=1#b', 'site').value, 'example.com');
  assert.equal(normalizeTarget('example.com/feed?a=1#b', 'section').value, 'example.com/feed');
  assert.equal(normalizeTarget('example.com/feed/', 'page').value, 'example.com/feed/');
  assert.throws(() => normalizeTarget('example.com', 'invalid'));
  assert.throws(() => normalizeTarget('example.com/' + 'a'.repeat(2048)));
  assert.throws(() => normalizeTarget('example.com/#' + 'я'.repeat(400)));
});

test('section blocks feed and its descendants while leaving music and lookalike paths alone', () => {
  const target = normalizeTarget('https://vk.ru/feed');
  for (const url of ['https://vk.ru/feed', 'https://vk.ru/feed/', 'https://vk.ru/feed?section=all',
    'https://vk.ru/feed/item/123', 'http://www.vk.ru:8080/feed#latest']) assert.ok(matchesTarget(url, target), url);
  for (const url of ['https://vk.ru/music', 'https://vk.ru/', 'https://vk.ru/feedback',
    'https://vk.ru/feed-old', 'https://vk.ru/Feed', 'https://vk.ru/other?next=/feed',
    'https://vk.ru.evil.test/feed', 'https://notvk.ru/feed']) assert.equal(matchesTarget(url, target), false, url);
});

test('exact page distinguishes children, trailing slash and query variants', () => {
  const target = normalizeTarget('example.com/article', 'page');
  assert.ok(matchesTarget('https://example.com/article?from=home#top', target));
  assert.equal(matchesTarget('https://example.com/article/', target), false);
  assert.equal(matchesTarget('https://example.com/article/next', target), false);
  const video = normalizeTarget('https://youtube.com/watch?v=123', 'page');
  assert.ok(matchesTarget('https://youtube.com/watch?v=123#top', video));
  for (const url of ['https://youtube.com/watch?v=456', 'https://youtube.com/watch?v=1234',
    'https://youtube.com/watch?v=123&t=3', 'https://youtube.com/watch']) assert.equal(matchesTarget(url, video), false);
});

test('hash routes are exact and do not network-block the app that hosts allowed routes', () => {
  const target = normalizeTarget('example.com/#/feed');
  assert.ok(matchesTarget('https://example.com/#/feed', target));
  assert.equal(matchesTarget('https://example.com/#/music', target), false);
  const rule = createRule(target, 1, path => 'chrome-extension://test/' + path);
  assert.equal(new RegExp(rule.condition.regexFilter).test('https://example.com/'), false);
});

test('normalization and persisted metadata round-trip for Unicode paths and literal regex characters', () => {
  for (const address of ['https://пример.рф/новости?я=1', 'example.com/feed(a+b).json',
    'example.com/path$^[]?x=1+2&y=%3F', 'example.com/#/feed']) {
    for (const mode of ['site', 'section', 'page']) {
      const target = normalizeTarget(address, mode);
      assert.deepEqual(ruleTarget(createRule(target, 1, path => 'chrome-extension://test/' + path)), target);
    }
  }
});

test('generated network filters and tab matching agree across domain/path/query boundaries', () => {
  const addresses = [
    ['vk.ru/feed', 'section'], ['example.com/', 'section'], ['example.com/feed/', 'page'],
    ['example.com/feed', 'page'], ['example.com/feed(a+b).json', 'section'],
    ['youtube.com/watch?v=123&mode=a+b', 'page'], ['пример.рф/новости', 'section']
  ];
  const urls = [
    'https://vk.ru/feed', 'https://vk.ru/feed/', 'https://vk.ru/feed?x=1', 'https://vk.ru/feedback',
    'https://vk.ru/music', 'http://www.vk.ru:8080/feed/a', 'https://vk.ru/Feed',
    'https://example.com/', 'https://example.com/feed', 'https://example.com/feed/',
    'https://example.com/feed/next', 'https://example.com/feed?x=1', 'https://example.com/?next=/feed',
    'https://example.com/feed(a+b).json/a', 'https://example.com/feedaabXjson',
    'https://youtube.com/watch?v=123&mode=a+b', 'https://youtube.com/watch?v=124&mode=a+b',
    'https://youtube.com/watch?v=123&mode=a+bb', 'https://пример.рф/новости/ещё',
    'https://notexample.com/feed', 'https://example.com.evil.test/feed', 'https://example.com:8443/feed'
  ];
  for (const [address, mode] of addresses) {
    const target = normalizeTarget(address, mode);
    const rule = createRule(target, 1, path => 'chrome-extension://test/' + path);
    assert.equal(rule.condition.isUrlFilterCaseSensitive, true);
    const regex = new RegExp(rule.condition.regexFilter);
    for (const raw of urls) {
      const url = new URL(raw).href;
      const networkMatch = matchesDomain(url, target.domain) && regex.test(url);
      assert.equal(networkMatch, matchesTarget(url, target), `${address} / ${url}`);
    }
  }
});

test('coverage distinguishes domains, sections and query-specific pages', () => {
  const target = (value, mode) => normalizeTarget(value, mode);
  assert.ok(coversTarget(target('example.com'), target('sub.example.com/feed')));
  assert.ok(coversTarget(target('example.com/feed'), target('example.com/feed/a', 'page')));
  assert.equal(coversTarget(target('example.com/feed'), target('example.com/feedback')), false);
  assert.equal(coversTarget(target('example.com/feed', 'page'), target('example.com/feed', 'section')), false);
  assert.ok(coversTarget(target('example.com/watch', 'page'), target('example.com/watch?v=1', 'page')));
  assert.equal(coversTarget(target('example.com/watch?v=1', 'page'), target('example.com/watch', 'page')), false);
});
