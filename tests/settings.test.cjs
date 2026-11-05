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
    assert.ok(settings.textContent.includes('RG2 · Desktop 1.2.0'));
    assert.ok(!/RG2F|RubicsGuide|автор/i.test(settings.textContent));
    assert.equal(settings.querySelectorAll('[data-open-item]').length, 0);
    assert.equal(settings.querySelectorAll('input[name="theme"]').length, 3);
    assert.ok(settings.textContent.includes('Горячие клавиши'));
    assert.ok(settings.textContent.includes('сохраняются на этом компьютере'));
    assert.match(read('RG2.Desktop.csproj'), /<Version>1\.2\.0<\/Version>/);
    assert.ok(window.RG2App.items.has('ABOUT-0'));
    window.RG2App.openItem('ABOUT-0');
    assert.ok(window.document.querySelector('#article-body').textContent.trim().length > 100);
    assert.ok(window.document.querySelector('.article-source').textContent.includes('RubicsGuide'));
  } finally { dom.window.close(); }
});
