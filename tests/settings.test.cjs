'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Settings show current app version and local controls while original credits remain accessible as source material', async () => {
  const dom = new JSDOM(read('data/index.html'), { url: 'https://rg2.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  try {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.HTMLElement.prototype.scrollIntoView = function () {};
    window.fetch = async url => ({ ok: true, json: async () => JSON.parse(read('data/' + String(url).split('/').pop())) });
    window.eval(read('data/algorithms.js'));
    window.eval(read('data/app.js'));
    assert.equal(await window.RG2App.ready, true);
    window.RG2App.navigate({ type: 'settings' });
    const settings = window.document.querySelector('.settings-layout');
    assert.ok(settings.textContent.includes('RG2 · Desktop 1.4.0'));
    assert.ok(!/RG2F|RubicsGuide|автор/i.test(settings.textContent));
    assert.equal(settings.querySelectorAll('[data-open-item]').length, 0);
    assert.equal(settings.querySelectorAll('input[name="theme"]').length, 3);
    assert.ok(settings.textContent.includes('Горячие клавиши'));
    assert.ok(settings.textContent.includes('сохраняются на этом компьютере'));
    assert.match(read('RG2.Desktop.csproj'), /<Version>1\.4\.0<\/Version>/);
    assert.ok(window.RG2App.items.has('ABOUT-0'));
    window.RG2App.openItem('ABOUT-0');
    assert.ok(window.document.querySelector('#article-body').textContent.trim().length > 100);
    assert.ok(window.document.querySelector('.article-source').textContent.includes('RubicsGuide'));
  } finally { dom.window.close(); }
});

async function application({ theme = 'system', neon, neonRaw, imageSettings, imageRaw, mediaDark = false } = {}) {
  const dom = new JSDOM(read('data/index.html'), { url: 'https://rg2.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const mediaListeners = new Set(), nativeListeners = new Set();
  const media = { matches: mediaDark, addEventListener(type, listener) { if (type === 'change') mediaListeners.add(listener); }, removeEventListener(type, listener) { mediaListeners.delete(listener); } };
  window.matchMedia = query => query === '(prefers-color-scheme: dark)' ? media : { matches: false, addEventListener() {}, removeEventListener() {} };
  window.chrome = { webview: { postMessage() {}, addEventListener(type, listener) { if (type === 'message') nativeListeners.add(listener); } } };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.localStorage.setItem('rg2.theme', theme);
  if (neonRaw !== undefined) window.localStorage.setItem('rg2.model.neon', neonRaw);
  else if (neon !== undefined) window.localStorage.setItem('rg2.model.neon', JSON.stringify(neon));
  if (imageRaw !== undefined) window.localStorage.setItem('rg2.model.image.v1', imageRaw);
  else if (imageSettings !== undefined) window.localStorage.setItem('rg2.model.image.v1', JSON.stringify(imageSettings));
  window.fetch = async url => {
    const name = String(url).split('/').pop();
    assert.ok(['catalog.json', 'trainer-data.json'].includes(name));
    return { ok: true, json: async () => JSON.parse(read('data/' + name)) };
  };
  window.eval(read('data/algorithms.js'));
  window.eval(read('data/app.js'));
  assert.equal(await window.RG2App.ready, true);
  window.RG2App.navigate({ type: 'settings' });
  return { window, dom,
    nativeTheme(dark) { for (const listener of nativeListeners) listener({ data: { type: 'system-theme', dark } }); },
    mediaTheme(dark) { media.matches = dark; for (const listener of mediaListeners) listener({ matches: dark }); },
    row: () => window.document.querySelector('#model-neon-setting'),
    toggle: () => window.document.querySelector('#model-neon-toggle'),
  };
}

test('Neon is off by default and its switch appears only in resolved Graphite', async () => {
  const app = await application({ theme: 'graphite' });
  try {
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'off');
    assert.equal(app.window.RG2App.state.modelNeonPreference, false);
    assert.equal(app.toggle().checked, false);
    assert.equal(app.row().hidden, false);
    app.window.RG2App.setTheme('atelier');
    assert.equal(app.row().hidden, true);
    assert.equal(app.toggle().disabled, true);
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'off');
  } finally { app.dom.window.close(); }
});

test('Changing the neon checkbox persists a boolean and updates the renderer attribute immediately', async () => {
  const app = await application({ theme: 'graphite' });
  try {
    app.toggle().checked = true;
    app.toggle().dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(app.window.localStorage.getItem('rg2.model.neon'), 'true');
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'on');
    assert.equal(app.window.RG2App.state.modelNeonActive, true);
    app.window.RG2App.setTheme('atelier');
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'off');
    assert.equal(app.window.localStorage.getItem('rg2.model.neon'), 'true');
    app.window.RG2App.setTheme('graphite');
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'on');
    assert.equal(app.toggle().checked, true);
    app.toggle().checked = false;
    app.toggle().dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(app.window.localStorage.getItem('rg2.model.neon'), 'false');
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'off');
  } finally { app.dom.window.close(); }
});

test('A saved neon preference is applied during startup in System Dark', async () => {
  const app = await application({ theme: 'system', neon: true, mediaDark: true });
  try {
    assert.equal(app.window.document.documentElement.dataset.theme, 'graphite');
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'on');
    assert.equal(app.row().hidden, false);
    assert.equal(app.toggle().checked, true);
  } finally { app.dom.window.close(); }
});

test('Native and media theme updates gate neon without overriding an explicitly selected light theme', async () => {
  const app = await application({ theme: 'system', neon: true });
  try {
    const rootElement = app.window.document.documentElement;
    assert.equal(rootElement.dataset.theme, 'atelier');
    assert.equal(rootElement.dataset.modelNeon, 'off');
    app.nativeTheme(true);
    assert.equal(rootElement.dataset.theme, 'graphite');
    assert.equal(rootElement.dataset.modelNeon, 'on');
    assert.equal(app.row().hidden, false);
    app.nativeTheme(false);
    assert.equal(rootElement.dataset.modelNeon, 'off');
    app.window.RG2App.setTheme('atelier');
    app.nativeTheme(true);
    assert.equal(rootElement.dataset.theme, 'atelier');
    assert.equal(rootElement.dataset.modelNeon, 'off');
    assert.equal(app.row().hidden, true);
    app.window.RG2App.setTheme('graphite');
    app.nativeTheme(false);
    assert.equal(rootElement.dataset.modelNeon, 'on');
    app.window.RG2App.setTheme('system');
    assert.equal(rootElement.dataset.modelNeon, 'off');
    app.mediaTheme(true);
    assert.equal(rootElement.dataset.modelNeon, 'on');
    app.nativeTheme(false);
    assert.equal(rootElement.dataset.modelNeon, 'off');
  } finally { app.dom.window.close(); }
});

test('Stored strings or malformed values do not accidentally enable neon', async () => {
  for (const neonRaw of ['"true"', '{"enabled":true}', 'invalid']) {
    const app = await application({ theme: 'graphite', neonRaw });
    try {
      assert.equal(app.window.RG2App.state.modelNeonPreference, false);
      assert.equal(app.window.document.documentElement.dataset.modelNeon, 'off');
    } finally { app.dom.window.close(); }
  }
});

const imageDefaults = { contrast: 100, saturation: 100, brightness: 100, gamma: 1, sharpness: 0, glow: 40 };
const imageState = app => JSON.parse(JSON.stringify(app.window.RG2App.state.modelImageSettings));
const imageAttribute = app => JSON.parse(app.window.document.documentElement.dataset.modelImage);

test('Image settings start with palette-neutral values and accessible, immediately updating sliders', async () => {
  const app = await application();
  try {
    assert.deepEqual(imageState(app), imageDefaults);
    assert.deepEqual(imageAttribute(app), imageDefaults);
    assert.equal(app.window.document.querySelectorAll('[data-model-image-key]').length, 6);
    const desired = { contrast: 137, saturation: 55, brightness: 121, gamma: .82, sharpness: 67 };
    for (const [key, value] of Object.entries(desired)) {
      const control = app.window.document.querySelector('#model-image-' + key);
      assert.equal(control.dataset.modelImage, key);
      assert.ok(app.window.document.querySelector('label[for="' + control.id + '"]'));
      control.value = String(value);
      control.dispatchEvent(new app.window.Event('input', { bubbles: true }));
      assert.equal(imageAttribute(app)[key], value, key + ' should update during input, before change/blur');
    }
    const expected = { ...imageDefaults, ...desired };
    assert.deepEqual(imageState(app), expected);
    assert.deepEqual(JSON.parse(app.window.localStorage.getItem('rg2.model.image.v1')), expected);
    assert.equal(app.window.document.querySelector('#model-image-contrast-value').textContent, '137%');
    assert.equal(app.window.document.querySelector('#model-image-gamma-value').textContent, '0,82');
    assert.equal(app.window.document.querySelector('#model-image-gamma').getAttribute('aria-valuetext'), '0,82');
  } finally { app.dom.window.close(); }
});

test('Persisted/API image settings clamp finite numbers, reject malformed fields and match the renderer normalization', async () => {
  const { normalizeImageSettings } = await import('../data/solver/image-settings.mjs');
  const supplied = { contrast: 999, saturation: -12, brightness: true, gamma: '1.2', sharpness: 65.6, glow: 103, unknown: 500 };
  const app = await application({ imageSettings: supplied });
  try {
    assert.deepEqual(imageState(app), normalizeImageSettings(supplied));
    assert.deepEqual(JSON.parse(app.window.localStorage.getItem('rg2.model.image.v1')), imageState(app));
    let previous = imageState(app);
    for (const partial of [
      { contrast: 69, saturation: 181, brightness: 131, gamma: .69, sharpness: -1, glow: -5 },
      { contrast: 70.8, saturation: 179.1, brightness: 99.6, gamma: 1.116, sharpness: 101, glow: 65.4 },
      { contrast: Infinity, saturation: NaN, brightness: null, gamma: '1', sharpness: {}, glow: undefined },
    ]) {
      const result = app.window.RG2App.setModelImageSettings(partial);
      const expected = normalizeImageSettings(partial, previous);
      assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
      assert.deepEqual(imageState(app), expected);
      assert.deepEqual(imageAttribute(app), expected);
      previous = expected;
    }
    const returned = app.window.RG2App.state.modelImageSettings;
    returned.contrast = 999;
    assert.notEqual(imageState(app).contrast, 999, 'Public state must not expose the mutable internal preference object');
  } finally { app.dom.window.close(); }
  const malformed = await application({ imageRaw: 'invalid JSON' });
  try { assert.deepEqual(imageState(malformed), imageDefaults); }
  finally { malformed.dom.window.close(); }
});

test('Glow strength is visible only with active neon in resolved Graphite and retains its saved strength', async () => {
  const app = await application({ theme: 'graphite' });
  const row = () => app.window.document.querySelector('[data-model-image-row="glow"]');
  try {
    assert.equal(row().hidden, true);
    app.window.RG2App.setModelNeon(true);
    assert.equal(row().hidden, false);
    app.window.RG2App.setModelImageSettings({ glow: 81 });
    app.window.RG2App.setTheme('atelier');
    app.nativeTheme(true);
    assert.equal(row().hidden, true);
    assert.equal(imageState(app).glow, 81);
    app.window.RG2App.setTheme('system');
    assert.equal(row().hidden, false);
    assert.equal(app.window.document.querySelector('#model-image-glow').value, '81');
    app.window.RG2App.setModelNeon(false);
    assert.equal(row().hidden, true);
  } finally { app.dom.window.close(); }
});

test('Как в развёртке resets all image controls and turns neon off without resetting theme', async () => {
  const app = await application({ theme: 'graphite', neon: true,
    imageSettings: { contrast: 145, saturation: 170, brightness: 125, gamma: 1.25, sharpness: 90, glow: 80 } });
  try {
    app.window.document.querySelector('#model-image-reset').click();
    assert.deepEqual(imageState(app), imageDefaults);
    assert.deepEqual(imageAttribute(app), imageDefaults);
    assert.deepEqual(JSON.parse(app.window.localStorage.getItem('rg2.model.image.v1')), imageDefaults);
    assert.equal(app.window.localStorage.getItem('rg2.model.neon'), 'false');
    assert.equal(app.window.document.documentElement.dataset.modelNeon, 'off');
    assert.equal(app.window.document.documentElement.dataset.theme, 'graphite');
    assert.equal(app.toggle().checked, false);
    assert.equal(app.window.document.querySelector('[data-model-image-row="glow"]').hidden, true);
  } finally { app.dom.window.close(); }
});
