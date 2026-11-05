'use strict';

// DOM-only regression checks; no browser, WebView2, clipboard or UI is opened.
// Install the repository's test dependencies with npm ci, then run:
// node --test tests/algorithms.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const { JSDOM } = require('jsdom');

const dataPath = path.join(__dirname, '..', 'data');
const read = name => fs.readFileSync(path.join(dataPath, name), 'utf8');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const catalogSource = read('catalog.json');
const trainerSource = read('trainer-data.json');
const catalog = JSON.parse(catalogSource);
const trainer = JSON.parse(trainerSource);
const records = catalog.phases.flatMap(phase => phase.items)
  .concat(catalog.extraPages || []).filter(item => typeof item.html === 'string' && item.html);
const algorithmSource = read('algorithms.js');
const appSource = read('app.js');
const indexSource = read('index.html');
const parser = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
parser.window.eval(algorithmSource);
const algorithms = parser.window.RG2Algorithms;
after(() => parser.window.close());

const normalized = value => String(value).replace(/\s+/gu, ' ').trim();
const algorithmTexts = segments => Array.from(segments)
  .filter(segment => segment.type === 'algorithm').map(segment => segment.text);
const blocks = container => Array.from(container.querySelectorAll('.algorithm-block'));
const formulas = container => blocks(container).map(block => block.querySelector('.algorithm-code').textContent);

function article(html, document = parser.window.document) {
  const container = document.createElement('article');
  container.innerHTML = html;
  return container;
}

function sourceText(container) {
  const copy = container.cloneNode(true);
  // Catalog text contains no buttons. Generated controls must not become part of
  // the source-corpus comparison or the formula copied to the clipboard.
  copy.querySelectorAll('button').forEach(button => button.remove());
  return normalized(copy.textContent);
}

function checkControls(container, context) {
  const entries = blocks(container);
  assert.equal(container.querySelectorAll('.algorithm-block .algorithm-block').length, 0,
    `${context}: nested algorithm block`);
  assert.equal(container.querySelectorAll('.copy-algorithm').length, entries.length,
    `${context}: a formula has no independent copy button`);
  assert.equal(container.querySelectorAll('.focus-algorithm').length, entries.length,
    `${context}: a formula has no focus button`);
  const indexes = [];
  for (const block of entries) {
    const code = block.querySelector('.algorithm-code');
    const copy = block.querySelector('button.copy-algorithm');
    const focus = block.querySelector('button.focus-algorithm');
    assert.ok(code && code.tagName === 'CODE', `${context}: missing dedicated code text`);
    assert.ok(code.textContent.trim(), `${context}: empty formula`);
    assert.equal(copy.dataset.copyAlgorithm, code.textContent, `${context}: copy differs from displayed formula`);
    assert.equal(focus.getAttribute('aria-pressed'), 'false', `${context}: prepared focus is already pressed`);
    assert.ok(focus.getAttribute('aria-label') || focus.title, `${context}: unnamed focus control`);
    assert.ok(copy.getAttribute('aria-label') || copy.title, `${context}: unnamed copy control`);
    assert.equal(copy.type, 'button', `${context}: copy could submit an enclosing form`);
    assert.equal(focus.type, 'button', `${context}: focus could submit an enclosing form`);
    indexes.push(focus.dataset.focusAlgorithm);
  }
  assert.ok(indexes.every(value => /^\d+$/.test(value)), `${context}: unstable focus index`);
  assert.equal(new Set(indexes).size, entries.length, `${context}: duplicate focus index`);
}

function assertSplit(input, expected, options) {
  const segments = algorithms.splitAlgorithms(input, options);
  assert.equal(Array.from(segments, segment => segment.text).join(''), input,
    'Splitting must reconstruct the exact source, including punctuation and whitespace');
  assert.ok(Array.from(segments).every(segment => segment.type === 'text' || segment.type === 'algorithm'));
  assert.deepEqual(algorithmTexts(segments), expected);
}

test('extraction API preserves source slices and separates Russian labels from moves', () => {
  assert.equal(typeof algorithms.prepare, 'function');
  assert.equal(typeof algorithms.splitAlgorithms, 'function');
  assertSplit("Алгоритм: R U R' U' — повторите дважды.", ["R U R' U'"]);
  assertSplit("Сначала (R U R' U'), затем F R U R' U' F'.", ["(R U R' U')", "F R U R' U' F'"]);
  assertSplit("\tR U R' U'\n", ["R U R' U'"]);
});

test('prime forms, wide moves, rotations and commutator punctuation are copied literally', () => {
  for (const formula of [
    "M'2 U M2' U' Rw'",
    "3Rw2 Uw Rw' U2 x y' z2",
    "r U r' U' f R f'",
    "R’ U R′ U’ R²",
    "[R U R', D]",
    "[R: U R' U']",
    "4(M' U) 4(M' U')",
  ]) assertSplit(formula, [formula]);
});

test('Square-1 slash notation remains a separate formula, including one-pair algorithms', () => {
  for (const formula of [
    '(1,0)/(3,0)/(-1,0)',
    '/(3,3)/(1,0)/(-2,0)/',
    '/(-1,0)/(1,0)/',
    '/(3,3)/',
    '/(−1,+2)/(0,−3)/',
  ]) assertSplit(`Алгоритм: ${formula} и пояснение.`, [formula]);
});

test('prose, timestamps, counts, references and isolated notation are not formulas', () => {
  for (const text of [
    'Алгоритм можно повторять два раза. Спасибо за идею.',
    'OLL (Orientation of the Last Layer), ориентация последнего слоя.',
    'Фингертрикс: на видео 2:40. Всего 57 алгоритмов.',
    'Кубик 3x3, пять по часовой, два против часовой.',
    'Поворот R показан на схеме, а U означает верхнюю грань.',
    'https://example.test/R/U/R',
    '',
  ]) assertSplit(text, []);
  assertSplit('R U', []);
  assertSplit('R U', ['R U'], { minMoves: 2 });
  assertSplit('Ребро FL и угол URF находятся спереди.', [], { minMoves: 2 });
});

test('inline emphasis is joined without losing adjacent explanations or source images', () => {
  const container = article('<p>Алгоритм: <b>R U</b> <i>R\' U\'</i> — оставить текст.</p><p><img src="cube.png" alt="Схема"></p>');
  const before = sourceText(container);
  algorithms.prepare(container, { icon: () => '<svg aria-hidden="true"></svg>' });
  assert.deepEqual(formulas(container), ["R U R' U'"]);
  assert.equal(sourceText(container), before);
  assert.equal(container.querySelector('img').getAttribute('src'), 'cube.png');
  assert.equal(container.querySelector('img').getAttribute('alt'), 'Схема');
  checkControls(container, 'inline emphasis');
  const first = container.innerHTML;
  algorithms.prepare(container);
  assert.equal(container.innerHTML, first, 'Preparing the same article twice must be idempotent');
});

test('formulas adjacent to Russian text and inside video links remain copyable', () => {
  const container = article('<p><b>(U\' F\' U2 F) (F R\' F\' R)</b>или</p>' +
    '<p>Например: <a href="rg2://ytplay?time=7:36&link=6GMCv19sIS4"><b>R U R’ U’</b></a>, затем ' +
    '<a href="rg2://ytplay?time=8:21&link=6GMCv19sIS4"><b>R u R’ u’</b></a></p>' +
    '<p>Можно собрать <a href="rg2://ytplay?time=9:00&link=6GMCv19sIS4">комбинацией (L\' U L)</a> ' +
    'или <a href="rg2://ytplay?time=10:00&link=6GMCv19sIS4">английским пиф-пафом (R\' F R F\').</a></p>');
  const before = sourceText(container);
  const links = Array.from(container.querySelectorAll('a'), link => link.getAttribute('href'));
  algorithms.prepare(container);
  assert.deepEqual(formulas(container), ["(U' F' U2 F) (F R' F' R)", 'R U R’ U’', 'R u R’ u’', "(L' U L)", "(R' F R F')"]);
  assert.equal(sourceText(container), before);
  assert.deepEqual(Array.from(container.querySelectorAll('a'), link => link.getAttribute('href')), links);
  checkControls(container, 'linked formulas');
});

test('OLL-0 creates all five independently copyable formulas with no label in the clipboard text', () => {
  const snowflake = records.find(item => item.id === 'OLL-0');
  assert.ok(snowflake);
  const container = article(snowflake.html);
  const before = sourceText(container);
  algorithms.prepare(container);
  assert.deepEqual(formulas(container), [
    "S (R' U') (R U R U R) U' R' S'",
    "(M' U' M' U' M' U' M' U') (M U' M U' M U' M U')",
    "M U (R U R' U') M2' (U R U' Rw')",
    "Rw' R U (R U R' U') Rw2 R2' (U R U' Rw')",
    "(Rw U R' U') M'2 U (R U' R' U') M'",
  ]);
  assert.equal(sourceText(container), before);
  checkControls(container, snowflake.id);
});

test('the source Square Star page exposes all three listed numeric algorithms', () => {
  const star = records.find(item => item.id === 'SQ_STAR-4');
  assert.ok(star);
  const container = article(star.html);
  algorithms.prepare(container);
  const found = formulas(container);
  for (const formula of ['/(-1,0)/(1,0)/', '/(3,0)/(3,0)/(3,0)', '/(3,3)/']) {
    assert.ok(found.includes(formula), `${star.id}: missing ${formula}`);
  }
  checkControls(container, star.id);
});

test('catalog-wide preparation preserves all 507 article texts, images and prior copyable sequences', t => {
  assert.equal(records.length, 507, 'Unexpected article corpus: review source migration before changing this count');
  const oldCandidate = text => {
    const value = text.trim();
    return value.length >= 7 && value.length <= 500 &&
      /^[RLUDFBMESXYZrludfbmesxyzuw2'’′²()\[\]:,.\s/+\-0-9]+$/.test(value) &&
      (value.match(/[RLUDFBMESXYZrludfbmesxyz]/g) || []).length >= 3;
  };
  let formulaCount = 0, pagesWithFormulas = 0, priorSequences = 0, squareSequences = 0, linkedSequences = 0;
  for (const item of records) {
    const container = article(item.html);
    const beforeText = sourceText(container);
    const beforeImages = Array.from(container.querySelectorAll('img'), image => image.getAttribute('src'));
    const beforeLinks = Array.from(container.querySelectorAll('a'), link => link.getAttribute('href'));
    const linked = Array.from(container.querySelectorAll('a')).flatMap(link =>
      algorithmTexts(algorithms.splitAlgorithms(link.textContent)));
    const emphasized = Array.from(container.querySelectorAll('b,strong,code'), element => element.textContent.trim());
    const prior = emphasized.filter(oldCandidate);
    const squares = emphasized.filter(value => value.includes('/') && /^[\d\s(),/+\-−]+$/u.test(value));
    algorithms.prepare(container);
    const found = formulas(container);
    formulaCount += found.length;
    pagesWithFormulas += found.length > 0;
    assert.equal(sourceText(container), beforeText, `${item.id}: article text or a move was changed`);
    assert.deepEqual(Array.from(container.querySelectorAll('img'), image => image.getAttribute('src')), beforeImages,
      `${item.id}: an image was changed or lost`);
    assert.deepEqual(Array.from(container.querySelectorAll('a'), link => link.getAttribute('href')), beforeLinks,
      `${item.id}: a source link was changed or lost`);
    checkControls(container, item.id);
    const allCopyText = normalized(found.join(' '));
    for (const previous of prior) {
      const moveText = normalized(previous).replace(/^[-–—]\s+/, '');
      assert.ok(allCopyText.includes(moveText), `${item.id}: previously copyable formula lost: ${previous}`);
      priorSequences++;
    }
    for (const square of squares) {
      assert.ok(allCopyText.includes(normalized(square)), `${item.id}: numeric Square-1 formula lost: ${square}`);
      squareSequences++;
    }
    for (const formula of linked) {
      assert.ok(allCopyText.includes(normalized(formula)), `${item.id}: linked formula lost: ${formula}`);
      linkedSequences++;
    }
    const once = container.innerHTML;
    algorithms.prepare(container);
    assert.equal(container.innerHTML, once, `${item.id}: preparation is not idempotent`);
  }
  assert.ok(priorSequences >= 600, `Legacy copy coverage unexpectedly shrank: ${priorSequences}`);
  assert.ok(squareSequences >= 10, `Numeric notation coverage unexpectedly shrank: ${squareSequences}`);
  assert.ok(formulaCount >= 1000, `New extraction missed the labeled/plain formulas: only ${formulaCount}`);
  assert.ok(pagesWithFormulas >= 250, `Too few article pages expose formulas: ${pagesWithFormulas}`);
  assert.equal(digest(read('catalog.json')), digest(catalogSource), 'Tests or preparation modified the source catalog');
  assert.equal(digest(read('trainer-data.json')), digest(trainerSource), 'Tests or preparation modified trainer source data');
  t.diagnostic(`${records.length} articles; ${pagesWithFormulas} pages with formulas; ${formulaCount} copy blocks; ${priorSequences} legacy, ${squareSequences} numeric and ${linkedSequences} linked sequences retained.`);
});

async function application(storage = {}) {
  const dom = new JSDOM(indexSource, {
    url: 'https://rg2.test/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text); } } });
  window.fetch = async url => {
    const name = String(url).split('/').pop();
    assert.ok(name === 'catalog.json' || name === 'trainer-data.json', `Unexpected network request: ${url}`);
    return { ok: true, json: async () => JSON.parse(name === 'catalog.json' ? catalogSource : trainerSource) };
  };
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  window.eval(algorithmSource);
  window.eval(appSource);
  const ready = await window.RG2App.ready;
  assert.equal(ready, true, window.RG2App.state.bootError || 'App failed to initialize');
  return { dom, window, copied };
}

test('real article integration copies exact selected formula and supplies focus controls', async () => {
  const { dom, window, copied } = await application();
  try {
    window.RG2App.openItem('OLL-0');
    const container = window.document.querySelector('#article-body');
    assert.equal(blocks(container).length, 5);
    const expected = formulas(container)[2];
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    const copy = container.querySelectorAll('.copy-algorithm')[2];
    copy.dispatchEvent(click);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(copied, [expected]);
    assert.ok(click.defaultPrevented || !copy.closest('a'), 'Copy must not navigate an enclosing video link');
    assert.equal(container.querySelectorAll('.focus-algorithm').length, 5);
    window.RG2App.openItem('PENTACLE-0');
    const linked = window.document.querySelector('#article-body .copy-algorithm');
    assert.ok(linked, 'A formula from inside a video link must still have its copy action');
    const linkedClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    linked.dispatchEvent(linkedClick);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(copied.at(-1), 'R U R’ U’');
    assert.ok(linkedClick.defaultPrevented || !linked.closest('a'), 'Copy opened the formula video instead of staying on the article');
  } finally { dom.window.close(); }
});

function assertFocused(container, index) {
  const entries = blocks(container);
  assert.equal(container.classList.contains('has-focused-algorithm'), index !== null);
  assert.equal(container.querySelectorAll('.algorithm-block.is-focused').length, index === null ? 0 : 1);
  assert.equal(container.querySelectorAll('.focus-algorithm[aria-pressed="true"]').length, index === null ? 0 : 1);
  entries.forEach((block, position) => {
    assert.equal(block.classList.contains('is-focused'), position === index, `Wrong focused formula at ${position}`);
    assert.equal(block.querySelector('.focus-algorithm').getAttribute('aria-pressed'), String(position === index));
    assert.equal(block.hidden, false, 'Other algorithms must remain on the page');
    assert.ok(block.querySelector('.algorithm-code').textContent.trim(), 'Focusing erased a formula');
  });
}

test('focus selects exactly one formula, switches and clears while all other formulas stay on the page', async () => {
  const { dom, window, copied } = await application();
  try {
    window.RG2App.openItem('OLL-0');
    const container = window.document.querySelector('#article-body');
    const originalFormulas = formulas(container);
    const originalText = sourceText(container);
    assertFocused(container, null);
    container.querySelectorAll('.focus-algorithm')[1].click();
    assertFocused(container, 1);
    assert.deepEqual(formulas(container), originalFormulas, 'Focus changed or reordered the original moves');
    assert.equal(sourceText(container), originalText, 'Focus changed the teaching text');
    container.querySelectorAll('.copy-algorithm')[3].click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(copied, [originalFormulas[3]], 'A smaller formula could not be copied independently');
    assertFocused(container, 1);
    container.querySelectorAll('.focus-algorithm')[4].click();
    assertFocused(container, 4);
    container.querySelectorAll('.focus-algorithm')[4].click();
    assertFocused(container, null);
    const stored = JSON.parse(window.localStorage.getItem('rg2.focusedAlgorithms'));
    assert.equal(stored['item:OLL-0'], undefined, 'Toggling off must remove the saved focus');
  } finally { dom.window.close(); }
});

test('the first formula focus persists per article, survives reader size changes and an app reload', async () => {
  const first = await application();
  let storage;
  const expected = "S (R' U') (R U R U R) U' R' S'";
  try {
    const { window } = first;
    window.RG2App.openItem('OLL-0');
    let container = window.document.querySelector('#article-body');
    container.querySelector('.focus-algorithm').click(); // The stable index is the string "0".
    assertFocused(container, 0);
    const stored = JSON.parse(window.localStorage.getItem('rg2.focusedAlgorithms'));
    assert.equal(stored['item:OLL-0'].id, '0');
    assert.equal(stored['item:OLL-0'].formula, expected);
    window.document.querySelector('[data-reader="large"]').click();
    assert.ok(container.classList.contains('reader-large'));
    assertFocused(container, 0);
    window.RG2App.navigate({ type: 'phase', id: 'OLL' });
    window.RG2App.openItem('OLL-1');
    assertFocused(window.document.querySelector('#article-body'), null);
    window.RG2App.openItem('OLL-0');
    container = window.document.querySelector('#article-body');
    assertFocused(container, 0);
    assert.equal(container.querySelector('.is-focused .algorithm-code').textContent, expected);
    storage = Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      return [key, window.localStorage.getItem(key)];
    }));
  } finally { first.dom.window.close(); }
  const reloaded = await application(storage);
  try {
    reloaded.window.RG2App.openItem('OLL-0');
    const container = reloaded.window.document.querySelector('#article-body');
    assertFocused(container, 0);
    assert.equal(container.querySelector('.is-focused .algorithm-code').textContent, expected);
    assert.ok(container.classList.contains('reader-large'));
  } finally { reloaded.dom.window.close(); }
});

test('saved focus follows an exact formula when its index changes and ignores stale move text', async () => {
  const expected = "(Rw U R' U') M'2 U (R U' R' U') M'";
  const moved = await application({
    'rg2.focusedAlgorithms': JSON.stringify({ 'item:OLL-0': { id: '99', formula: expected } }),
  });
  try {
    moved.window.RG2App.openItem('OLL-0');
    assertFocused(moved.window.document.querySelector('#article-body'), 4);
  } finally { moved.dom.window.close(); }
  const stale = await application({
    'rg2.focusedAlgorithms': JSON.stringify({ 'item:OLL-0': { id: '0', formula: 'R U changed source' } }),
  });
  try {
    stale.window.RG2App.openItem('OLL-0');
    assertFocused(stale.window.document.querySelector('#article-body'), null);
  } finally { stale.dom.window.close(); }
});
