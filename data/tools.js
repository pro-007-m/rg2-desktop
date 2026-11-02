/* RG2 desktop tools. Local data, original RG2 trainer geometry, no dependencies. */
(function (host) {
  'use strict';
  const TIMER_KEY = 'rg2.desktop.timer.v1';
  const ALPHABET_KEY = 'rg2.desktop.alphabet.v1';
  const LENGTHS = { 2: 11, 3: 20, 4: 40, 5: 60, 6: 80, 7: 100 };
  const COLOR_NAMES = ['синий', 'оранжевый', 'белый', 'красный', 'жёлтый', 'зелёный'];

  function randomInt(max, rng) {
    if (rng) return Math.min(max - 1, Math.floor(rng() * max));
    if (host.crypto && host.crypto.getRandomValues) {
      const value = new Uint32Array(1);
      const ceiling = Math.floor(4294967296 / max) * max;
      do { host.crypto.getRandomValues(value); } while (value[0] >= ceiling);
      return value[0] % max;
    }
    return Math.floor(Math.random() * max);
  }
  function shuffled(values) {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i--) {
      const j = randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function generateScramble(size = 3, length = LENGTHS[size], rng) {
    size = Number(size);
    if (!(size >= 2 && size <= 7 && Number.isInteger(size))) throw new RangeError('Размер: от 2 до 7.');
    length = Number(length);
    if (!Number.isInteger(length) || length < 1 || length > 250) throw new RangeError('Длина: от 1 до 250.');
    const faces = size === 2 ? ['R', 'U', 'F'] : ['R', 'L', 'U', 'D', 'F', 'B'];
    const axis = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
    const suffixes = ['', "'", '2'];
    let previousAxis = -1;
    const moves = [];
    for (let i = 0; i < length; i++) {
      const available = faces.filter(face => axis[face] !== previousAxis);
      const face = available[randomInt(available.length, rng)];
      const width = 1 + randomInt(Math.floor(size / 2), rng);
      const prefix = width === 1 ? face : width === 2 ? face + 'w' : width + face + 'w';
      moves.push(prefix + suffixes[randomInt(3, rng)]);
      previousAxis = axis[face];
    }
    return moves.join(' ');
  }
  function resultValue(result) {
    if (!result || result.penalty === 'DNF') return Infinity;
    const ms = Number(result.ms);
    if (!Number.isFinite(ms) || ms < 0) return Infinity;
    return ms + (result.penalty === '+2' ? 2000 : 0);
  }
  function clockText(ms) {
    const centiseconds = Math.floor(Math.max(0, ms) / 10);
    const hundredths = String(centiseconds % 100).padStart(2, '0');
    const totalSeconds = Math.floor(centiseconds / 100);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${hundredths}`;
    if (minutes) return `${minutes}:${String(seconds).padStart(2, '0')}.${hundredths}`;
    return `${seconds}.${hundredths}`;
  }
  function formatTime(ms, penalty = '') {
    if (penalty === 'DNF') return 'DNF';
    return clockText(Number(ms) + (penalty === '+2' ? 2000 : 0)) + (penalty === '+2' ? '+' : '');
  }
  function averageOf(results, count) {
    if (!Array.isArray(results) || results.length < count || count < 3) return null;
    const values = results.slice(-count).map(resultValue).sort((a, b) => a - b).slice(1, -1);
    if (values.some(value => !Number.isFinite(value))) return Infinity;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  function applyMoves(cube, sequence, permutations) {
    let current = [...cube];
    for (const token of String(sequence).replace(/[()]/g, ' ').split(/\s+/).filter(Boolean)) {
      let key = token.replace(/'/g, 'b');
      let permutation = permutations[key] || permutations[token];
      if (!permutation && /2$/.test(key)) {
        key = key.slice(0, -1);
        permutation = permutations[key];
        if (!permutation) throw new Error('Неизвестный ход: ' + token);
        current = permutation.map(index => current[index]);
      }
      if (!permutation) throw new Error('Неизвестный ход: ' + token);
      current = permutation.map(index => current[index]);
    }
    return current;
  }
  function readStore(key, fallback) {
    try { const value = JSON.parse(host.localStorage.getItem(key)); return value || fallback; }
    catch (_) { return fallback; }
  }
  function writeStore(key, data) {
    try { host.localStorage.setItem(key, JSON.stringify(data)); return true; }
    catch (_) { return false; }
  }
  function uid() { return Date.now().toString(36) + '-' + randomInt(1e9).toString(36); }
  function el(tag, attributes, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes || {})) {
      if (key === 'class') element.className = value;
      else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
      else if (value === true) element.setAttribute(key, '');
      else if (value !== false && value != null) element.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) if (child != null) element.append(child.nodeType ? child : document.createTextNode(String(child)));
    return element;
  }
  function button(text, action, className = '', attrs = {}) {
    return el('button', { type: 'button', class: 'rg2t-button ' + className, onclick: action, ...attrs }, text);
  }
  function select(items, value, change, attrs = {}) {
    const control = el('select', { class: 'rg2t-select', onchange: event => change(event.target.value), ...attrs });
    for (const item of items) control.append(el('option', { value: item.value }, item.label));
    control.value = String(value);
    return control;
  }
  function field(label, control) { return el('label', { class: 'rg2t-field' }, el('span', {}, label), control); }
  function assetUrl(path, options) {
    return (options.assetRoot ? String(options.assetRoot).replace(/\/$/, '') + '/' : '') + String(path).replace(/^\//, '');
  }
  async function copyText(text, feedback) {
    try {
      if (!host.navigator.clipboard) throw new Error('clipboard');
      await host.navigator.clipboard.writeText(text);
      feedback('Скопировано');
    } catch (_) {
      const area = el('textarea', { 'aria-label': 'Текст для копирования', style: 'position:fixed;left:-10000px' }, text);
      document.body.append(area); area.select();
      const copied = document.execCommand('copy'); area.remove();
      feedback(copied ? 'Скопировано' : 'Выделите скрамбл и нажмите Ctrl+C');
    }
  }
  function addSourceHelp(root, data, key, options = {}) {
    if (options.hideSourceHelp) return;
    const html = data && data.help && data.help[key] && data.help[key].html;
    if (!html) return;
    const body = el('div', { class: 'rg2t-source-help' });
    const template = document.createElement('template'); template.innerHTML = html;
    template.content.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      for (const attribute of [...node.attributes]) {
        if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(attribute.name)) node.removeAttribute(attribute.name);
      }
      if (node.hasAttribute('href') && !/^(https?:|rg2:|#)/i.test(node.getAttribute('href'))) node.removeAttribute('href');
      if (node.hasAttribute('src')) {
        const source = node.getAttribute('src');
        if (/^(javascript:|data:text\/html|file:)/i.test(source)) node.removeAttribute('src');
        else if (!/^(https?:|data:image\/)/i.test(source)) node.setAttribute('src', assetUrl(source, options));
      }
      if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    });
    body.append(template.content);
    root.append(el('details', { class: 'rg2t-help' }, el('summary', {}, 'Справка из RG2'), body));
  }
  function addStyles() {
    if (document.getElementById('rg2-tools-style')) return;
    const style = el('style', { id: 'rg2-tools-style' });
    style.textContent = `
      .rg2-tools{color:var(--ink);font:inherit;min-width:0}.rg2-tools *{box-sizing:border-box}
      .rg2-tools .rg2t-heading{margin:0 0 8px;font-family:var(--heading-font,inherit);font-size:clamp(27px,3vw,42px);font-weight:600;letter-spacing:-.035em}
      .rg2-tools .rg2t-intro{color:var(--muted);margin:0 0 26px;line-height:1.6;max-width:780px}
      .rg2-tools .rg2t-bar{display:flex;align-items:end;gap:14px;flex-wrap:wrap;margin:18px 0}
      .rg2-tools .rg2t-field{display:grid;gap:7px;min-width:115px;color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.02em}
      .rg2-tools .rg2t-select,.rg2-tools .rg2t-input{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;min-height:41px;padding:9px 12px;max-width:100%}
      .rg2-tools .rg2t-input{width:95px}.rg2-tools .rg2t-select{min-width:130px}
      .rg2-tools .rg2t-check{display:flex;gap:9px;align-items:center;font-size:13px;min-height:41px;color:var(--muted)}
      .rg2-tools input[type=checkbox]{accent-color:var(--accent);width:16px;height:16px}
      .rg2-tools .rg2t-button{font:inherit;font-size:13px;font-weight:600;line-height:1.3;padding:11px 15px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);cursor:pointer;min-height:41px;transition:background .15s,transform .15s}
      .rg2-tools .rg2t-button:hover:not(:disabled){background:var(--soft,var(--bg));transform:translateY(-1px)}
      .rg2-tools .rg2t-button:disabled{cursor:default;opacity:.5}.rg2-tools .rg2t-button:focus-visible,.rg2-tools select:focus-visible,.rg2-tools input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
      .rg2-tools .rg2t-primary{background:var(--accent);color:var(--accent-contrast,#fff);border-color:var(--accent)}
      .rg2-tools .rg2t-primary:hover:not(:disabled){background:var(--accent);filter:brightness(1.08)}
      .rg2-tools .rg2t-small{font-size:11px;padding:5px 8px;min-height:29px;border-radius:7px}
      .rg2-tools .rg2t-selected{border-color:var(--accent);color:var(--accent);background:var(--soft,var(--bg))}
      .rg2-tools .rg2t-card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px;min-width:0}
      .rg2-tools .rg2t-scramble{font-family:Consolas,'Cascadia Code',monospace;line-height:1.9;letter-spacing:.035em;font-size:clamp(17px,1.8vw,23px);overflow-wrap:anywhere;user-select:text;margin:0;white-space:normal}
      .rg2-tools .rg2t-note{font-size:12px;line-height:1.6;color:var(--muted);margin:12px 0 0}
      .rg2-tools .rg2t-status{min-height:24px;color:var(--accent);font-size:13px;margin-top:12px;line-height:1.6}
      .rg2-tools .rg2t-timer-layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(270px,1fr);gap:22px;align-items:start}
      .rg2-tools .rg2t-clock{border:0;background:transparent;color:var(--ink);display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%;min-height:250px;margin:18px 0 0;border-radius:15px;cursor:pointer;touch-action:none;user-select:none}
      .rg2-tools .rg2t-clock:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
      .rg2-tools .rg2t-clock-number{font-variant-numeric:tabular-nums;letter-spacing:-.055em;font-size:clamp(65px,8vw,120px);font-weight:400;line-height:1.15;font-family:'Segoe UI',sans-serif}
      .rg2-tools .rg2t-clock-hint{margin-top:18px;line-height:1.7;font-size:13px;color:var(--muted);max-width:450px;text-align:center}
      .rg2-tools .rg2t-clock[data-state=holding] .rg2t-clock-number{color:#c88c25}.rg2-tools .rg2t-clock[data-state=ready] .rg2t-clock-number{color:#259d6e}
      .rg2-tools .rg2t-clock[data-state=inspection] .rg2t-clock-number{color:var(--accent)}
      .rg2-tools .rg2t-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding-top:20px;border-top:1px solid var(--line);margin-top:18px}
      .rg2-tools .rg2t-stat{display:grid;gap:7px}.rg2-tools .rg2t-stat span:first-child{color:var(--muted);font-size:11px;letter-spacing:.05em}.rg2-tools .rg2t-stat strong{font-variant-numeric:tabular-nums;font-size:22px;font-weight:500}
      .rg2-tools .rg2t-history-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 15px;font-size:16px;font-weight:600}
      .rg2-tools .rg2t-results{max-height:590px;overflow:auto;scrollbar-width:thin;display:grid;gap:1px}
      .rg2-tools .rg2t-result{padding:12px 0;border-bottom:1px solid var(--line)}
      .rg2-tools .rg2t-result-top{display:flex;align-items:center;gap:9px}.rg2-tools .rg2t-result-index{font-size:11px;color:var(--muted);width:25px}.rg2-tools .rg2t-result-time{font-size:20px;font-variant-numeric:tabular-nums;flex:1}
      .rg2-tools .rg2t-result-actions{display:flex;gap:5px}.rg2-tools .rg2t-result details{margin:7px 0 0 34px;font-size:11px;color:var(--muted)}
      .rg2-tools .rg2t-result details p{font-family:Consolas,monospace;line-height:1.8;overflow-wrap:anywhere}
      .rg2-tools .rg2t-empty{color:var(--muted);font-size:13px;line-height:1.8;padding:18px 0}
      .rg2-tools .rg2t-new-session{display:flex;gap:7px;margin-bottom:15px}.rg2-tools .rg2t-new-session .rg2t-input{width:100%;min-width:0}
      .rg2-tools .rg2t-help{border-top:1px solid var(--line);margin-top:30px;padding-top:18px;color:var(--muted);font-size:13px;line-height:1.8}
      .rg2-tools .rg2t-help summary{cursor:pointer;color:var(--ink);font-weight:600}.rg2-tools .rg2t-source-help{max-width:900px;margin-top:16px}.rg2-tools .rg2t-source-help a{color:var(--accent)}
      .rg2-tools .rg2t-quiz-layout{display:grid;grid-template-columns:minmax(280px,.95fr) minmax(0,1.3fr);gap:24px;align-items:stretch}
      .rg2-tools .rg2t-figure{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:340px;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px;min-width:0}
      .rg2-tools .rg2t-pll-image{width:240px;max-width:100%;height:240px;object-fit:contain;background:#fff;border-radius:14px;padding:16px}
      .rg2-tools .rg2t-quiz-panel{display:flex;flex-direction:column;justify-content:center;min-width:0}
      .rg2-tools .rg2t-question{font-family:var(--heading-font,inherit);font-size:27px;font-weight:500;letter-spacing:-.025em;margin:0 0 20px}
      .rg2-tools .rg2t-choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .rg2-tools .rg2t-choice{min-height:78px;text-align:left;padding:16px 18px;font-size:24px;font-weight:500;display:flex;flex-direction:column;gap:7px;justify-content:center}
      .rg2-tools .rg2t-choice small{font-size:11px;font-weight:400;line-height:1.4;color:var(--muted)}
      .rg2-tools .rg2t-choice.rg2t-right{border-color:#2b9f72;background:color-mix(in srgb,#2b9f72 12%,var(--surface));opacity:1}
      .rg2-tools .rg2t-choice.rg2t-wrong{border-color:#d2605a;background:color-mix(in srgb,#d2605a 12%,var(--surface));opacity:1}
      .rg2-tools .rg2t-feedback{min-height:56px;margin-top:18px;font-size:14px;line-height:1.7;color:var(--muted)}
      .rg2-tools .rg2t-score{display:flex;gap:25px;flex-wrap:wrap;margin:0 0 24px;color:var(--muted);font-size:12px}.rg2-tools .rg2t-score strong{font-weight:500;color:var(--ink);font-size:20px;margin-right:6px;font-variant-numeric:tabular-nums}
      .rg2-tools .rg2t-next{align-self:start}.rg2-tools .rg2t-alpha-canvas{width:340px;max-width:100%;height:auto;background:#fafafa;border-radius:15px}
      .rg2-tools .rg2t-letter-choices{grid-template-columns:repeat(6,minmax(0,1fr));gap:9px}.rg2-tools .rg2t-letter-choices .rg2t-choice{font-size:21px;min-height:48px;padding:10px;align-items:center}
      .rg2-tools .rg2t-progress{height:4px;background:var(--line);border-radius:4px;overflow:hidden;margin-bottom:18px}.rg2-tools .rg2t-progress>span{height:100%;display:block;background:var(--accent);transition:width .1s linear}
      .rg2-tools .rg2t-alpha-editor{margin:18px 0;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:16px}
      .rg2-tools .rg2t-alpha-faces{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr));gap:18px;max-width:640px}.rg2-tools .rg2t-alpha-face{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.rg2-tools .rg2t-alpha-face-title{grid-column:1/-1;color:var(--muted);font-size:12px;margin-bottom:5px}.rg2-tools .rg2t-alpha-face input{width:100%;text-align:center;min-width:0;border:1px solid var(--line);border-radius:6px;padding:8px 2px;color:var(--ink);background:var(--bg);font:inherit}
      @media(max-width:1150px){.rg2-tools .rg2t-timer-layout{grid-template-columns:minmax(0,1fr)}.rg2-tools .rg2t-results{max-height:340px}.rg2-tools .rg2t-clock{min-height:220px}}
      @media(max-width:760px){.rg2-tools .rg2t-quiz-layout{grid-template-columns:1fr}.rg2-tools .rg2t-figure{min-height:270px}.rg2-tools .rg2t-pll-image{width:210px;height:210px}.rg2-tools .rg2t-card{padding:18px}.rg2-tools .rg2t-alpha-faces{grid-template-columns:repeat(2,minmax(120px,1fr))}.rg2-tools .rg2t-letter-choices{grid-template-columns:repeat(5,minmax(0,1fr))}}
    `;
    document.head.append(style);
  }

  function timerTool(root, options) {
    const saved = readStore(TIMER_KEY, {});
    const sessions = Array.isArray(saved.sessions) ? saved.sessions.filter(session => session && Array.isArray(session.results) && typeof session.id === 'string').map(session => ({ ...session, name: String(session.name || 'Сессия').slice(0, 60), results: session.results.filter(result => Number.isFinite(result.ms) && result.ms >= 0 && typeof result.id === 'string') })) : [];
    if (!sessions.length) sessions.push({ id: uid(), name: 'Сессия 1', results: [], createdAt: Date.now() });
    let activeId = sessions.some(session => session.id === saved.activeId) ? saved.activeId : sessions[0].id;
    let size = Number(saved.size) >= 2 && Number(saved.size) <= 7 ? Number(saved.size) : 3;
    let inspectionEnabled = Boolean(saved.inspection);
    let scramble = generateScramble(size);
    let state = 'idle', holdAt = 0, inspectionAt = 0, startAt = 0, inspectionActive = false, runningPenalty = '', keyHeld = false, ignoreClickUntil = 0, raf = 0, disposed = false;
    let lastDisplay = '0.00';
    const persist = () => writeStore(TIMER_KEY, { sessions, activeId, size, inspection: inspectionEnabled });
    const activeSession = () => sessions.find(session => session.id === activeId);
    const status = el('div', { class: 'rg2t-status', role: 'status', 'aria-live': 'polite' });
    const feedback = text => { status.textContent = text; };
    const scrambleText = el('p', { class: 'rg2t-scramble', 'data-scramble': 'timer' }, scramble);
    const clockNumber = el('span', { class: 'rg2t-clock-number', 'data-clock': '', 'aria-live': 'off' }, lastDisplay);
    const hint = el('span', { class: 'rg2t-clock-hint' }, 'Удерживайте пробел 0,5 секунды. Отпустите для старта, нажмите снова для остановки.');
    const clock = el('button', { class: 'rg2t-clock', type: 'button', 'aria-label': 'Таймер: удерживайте для готовности, отпустите для старта', 'data-state': state }, clockNumber, hint);
    const sessionSelect = select([], activeId, value => { activeId = value; lastDisplay = '0.00'; persist(); renderResults(); refreshClock(); }, { 'aria-label': 'Сессия' });
    const sizeSelect = select([2, 3, 4, 5, 6, 7].map(value => ({ value, label: value + ' × ' + value })), size, value => { size = Number(value); newScramble(); persist(); }, { 'aria-label': 'Размер кубика' });
    const inspectionCheck = el('input', { type: 'checkbox', onchange: event => { inspectionEnabled = event.target.checked; inspectionActive = false; persist(); refreshClock(); } }); inspectionCheck.checked = inspectionEnabled;
    const refreshButton = button('Новый скрамбл', () => newScramble(), '', { 'data-action': 'new-scramble' });
    const stats = el('div', { class: 'rg2t-stats' });
    const results = el('div', { class: 'rg2t-results', 'data-results': '' });
    const sessionName = el('input', { class: 'rg2t-input', type: 'text', maxlength: '60', placeholder: 'Название сессии', 'aria-label': 'Название новой сессии' });
    const newSessionButton = button('Создать', () => {
      const name = sessionName.value.trim() || `Сессия ${sessions.length + 1}`;
      const session = { id: uid(), name, results: [], createdAt: Date.now() };
      sessions.push(session); activeId = session.id; sessionName.value = ''; lastDisplay = '0.00'; persist(); renderResults(); refreshClock();
    }, 'rg2t-small', { 'data-action': 'create-session' });
    root.append(el('h1', { class: 'rg2t-heading' }, 'Таймер'), el('p', { class: 'rg2t-intro' }, 'Скрамбл, сборка и личная статистика. Пробел работает, пока открыт этот экран.'));
    root.append(el('div', { class: 'rg2t-bar' }, field('КУБИК', sizeSelect), field('СЕССИЯ', sessionSelect), el('label', { class: 'rg2t-check' }, inspectionCheck, 'Предосмотр 15 секунд')));
    const mainCard = el('div', { class: 'rg2t-card' }, scrambleText, el('div', { class: 'rg2t-bar' }, refreshButton, button('Копировать', () => copyText(scramble, feedback))), clock, stats, status);
    const history = el('div', { class: 'rg2t-card' }, el('h2', { class: 'rg2t-history-heading' }, 'История сборок'), el('div', { class: 'rg2t-new-session' }, sessionName, newSessionButton), results);
    root.append(el('div', { class: 'rg2t-timer-layout' }, mainCard, history));
    root.append(el('p', { class: 'rg2t-note' }, 'ao5 / ao12: среднее последних 5 / 12 сборок без лучшей и худшей. Один DNF исключается как худший результат; два дают DNF.'));
    addSourceHelp(root, options.trainerData, 'timer', options);

    function renderResults() {
      sessionSelect.replaceChildren(...sessions.map(session => el('option', { value: session.id }, session.name)));
      sessionSelect.value = activeId;
      const values = activeSession().results;
      const valid = values.map(resultValue).filter(Number.isFinite);
      const avgText = count => { const value = averageOf(values, count); return value == null ? '—' : Number.isFinite(value) ? clockText(value) : 'DNF'; };
      stats.replaceChildren(...[['СБОРОК', String(values.length)], ['ЛУЧШЕЕ', valid.length ? clockText(Math.min(...valid)) : '—'], ['ao5', avgText(5)], ['ao12', avgText(12)]].map(([label, text]) => el('div', { class: 'rg2t-stat' }, el('span', {}, label), el('strong', {}, text))));
      if (!values.length) { results.replaceChildren(el('div', { class: 'rg2t-empty' }, 'Первые результаты появятся после сборки. Сессии сохраняются на этом компьютере.')); return; }
      results.replaceChildren(...values.map((result, index) => ({ result, index })).reverse().map(({ result, index }) => {
        const updatePenalty = penalty => {
          if (state !== 'idle') return;
          result.penalty = result.penalty === penalty ? '' : penalty;
          if (index === values.length - 1) lastDisplay = formatTime(result.ms, result.penalty);
          persist(); renderResults(); refreshClock();
        };
        return el('div', { class: 'rg2t-result', 'data-result-id': result.id },
          el('div', { class: 'rg2t-result-top' }, el('span', { class: 'rg2t-result-index' }, index + 1), el('span', { class: 'rg2t-result-time' }, formatTime(result.ms, result.penalty)),
            el('div', { class: 'rg2t-result-actions' }, button('+2', () => updatePenalty('+2'), 'rg2t-small ' + (result.penalty === '+2' ? 'rg2t-selected' : ''), { 'aria-label': 'Штраф +2 для сборки ' + (index + 1), 'aria-pressed': result.penalty === '+2' }), button('DNF', () => updatePenalty('DNF'), 'rg2t-small ' + (result.penalty === 'DNF' ? 'rg2t-selected' : ''), { 'aria-label': 'DNF для сборки ' + (index + 1), 'aria-pressed': result.penalty === 'DNF' }), button('×', () => {
              if (state !== 'idle') return;
              values.splice(index, 1); persist(); renderResults(); feedback('Результат удалён');
            }, 'rg2t-small', { 'aria-label': 'Удалить сборку ' + (index + 1) }))),
          el('details', {}, el('summary', {}, `${result.puzzle || 3} × ${result.puzzle || 3} · ${new Date(result.at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`), el('p', {}, result.scramble || '')));
      }));
    }
    function refreshClock() {
      clock.dataset.state = state;
      const busy = state !== 'idle';
      [sessionSelect, sizeSelect, inspectionCheck, refreshButton, newSessionButton, sessionName].forEach(control => { control.disabled = busy; });
      if (state === 'idle') { clockNumber.textContent = lastDisplay; hint.textContent = inspectionEnabled ? 'Удерживайте пробел 0,5 секунды и отпустите для предосмотра. Затем повторите для старта сборки.' : 'Удерживайте пробел 0,5 секунды. Отпустите для старта, нажмите снова для остановки.'; }
      if (state === 'holding') hint.textContent = 'Удерживайте…';
      if (state === 'ready') hint.textContent = 'Готово. Отпустите для ' + (inspectionEnabled && !inspectionActive ? 'предосмотра.' : 'старта.');
      if (state === 'inspection') hint.textContent = 'Предосмотр. Удерживайте пробел и отпустите для старта сборки.';
      if (state === 'running') hint.textContent = 'Нажмите пробел или щёлкните по времени для остановки.';
    }
    function newScramble() { state = 'idle'; inspectionActive = false; scramble = generateScramble(size); scrambleText.textContent = scramble; refreshClock(); }
    function beginPress() {
      if (state === 'running') { stop(); return; }
      if (state === 'idle' || state === 'inspection') { holdAt = performance.now(); state = 'holding'; refreshClock(); }
    }
    function endPress() {
      if (state === 'ready') {
        if (inspectionEnabled && !inspectionActive) { inspectionActive = true; inspectionAt = performance.now(); state = 'inspection'; }
        else {
          const elapsedInspection = inspectionActive ? performance.now() - inspectionAt : 0;
          runningPenalty = elapsedInspection > 17000 ? 'DNF' : elapsedInspection > 15000 ? '+2' : '';
          inspectionActive = false; startAt = performance.now(); state = 'running';
        }
      } else if (state === 'holding') state = inspectionActive ? 'inspection' : 'idle';
      refreshClock();
    }
    function cancelPress() { if (state === 'holding' || state === 'ready') { state = inspectionActive ? 'inspection' : 'idle'; refreshClock(); } keyHeld = false; }
    function stop() {
      if (state !== 'running') return;
      const ms = Math.max(0, performance.now() - startAt);
      activeSession().results.push({ id: uid(), ms, penalty: runningPenalty, at: Date.now(), scramble, puzzle: size });
      state = 'idle'; lastDisplay = formatTime(ms, runningPenalty); persist(); renderResults();
      scramble = generateScramble(size); scrambleText.textContent = scramble;
      feedback('Сборка сохранена' + (runningPenalty ? ' · ' + runningPenalty : '')); refreshClock();
    }
    function tick() {
      if (disposed) return;
      const now = performance.now();
      if (state === 'holding' && now - holdAt >= 500) { state = 'ready'; refreshClock(); }
      if (state === 'running') clockNumber.textContent = clockText(now - startAt);
      else if (inspectionActive) {
        const elapsed = now - inspectionAt;
        clockNumber.textContent = elapsed > 17000 ? 'DNF' : elapsed > 15000 ? '+2' : String(Math.max(0, Math.ceil(15 - elapsed / 1000)));
      } else if (state === 'holding' || state === 'ready') clockNumber.textContent = '0.00';
      raf = requestAnimationFrame(tick);
    }
    function editableTarget(target) { return target && (target.closest('input,select,textarea,[contenteditable=true]') || target.closest('summary,a')); }
    function keydown(event) {
      if (event.code !== 'Space' || editableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      if (event.repeat || keyHeld) return;
      keyHeld = true; beginPress();
    }
    function keyup(event) {
      if (event.code !== 'Space' || !keyHeld) return;
      event.preventDefault(); keyHeld = false; endPress();
    }
    clock.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); ignoreClickUntil = performance.now() + 1000; clock.setPointerCapture(event.pointerId); beginPress(); });
    clock.addEventListener('pointerup', event => { event.preventDefault(); ignoreClickUntil = performance.now() + 500; endPress(); });
    clock.addEventListener('pointercancel', cancelPress);
    clock.addEventListener('click', () => {
      if (performance.now() < ignoreClickUntil) return;
      if (state === 'running') stop();
      else { beginPress(); state = 'ready'; endPress(); }
    });
    document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup); host.addEventListener('blur', cancelPress);
    renderResults(); refreshClock(); persist(); raf = requestAnimationFrame(tick);
    return () => { disposed = true; cancelAnimationFrame(raf); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); host.removeEventListener('blur', cancelPress); };
  }

  function scrambleTool(root, options) {
    const suppliedScramble = options.initialScramble || options.scramble;
    let size = 3, length = LENGTHS[size], current = suppliedScramble ? String(suppliedScramble).replace(/_/g, ' ') : generateScramble(size, length);
    const status = el('div', { class: 'rg2t-status', role: 'status', 'aria-live': 'polite' });
    const text = el('p', { class: 'rg2t-scramble', 'data-scramble': 'generator' }, current);
    const lengthInput = el('input', { class: 'rg2t-input', type: 'number', min: '1', max: '250', value: length, 'aria-label': 'Количество ходов' });
    const generate = () => {
      const candidate = Number(lengthInput.value);
      if (!Number.isInteger(candidate) || candidate < 1 || candidate > 250) { status.textContent = 'Укажите целое число от 1 до 250.'; lengthInput.focus(); return; }
      length = candidate; current = generateScramble(size, length); text.textContent = current; status.textContent = 'Новый скрамбл · ' + length + ' ходов';
    };
    const sizeSelect = select([2, 3, 4, 5, 6, 7].map(value => ({ value, label: value + ' × ' + value })), size, value => { size = Number(value); length = LENGTHS[size]; lengthInput.value = length; generate(); }, { 'aria-label': 'Размер кубика' });
    root.append(el('h1', { class: 'rg2t-heading' }, 'Генератор скрамблов'), el('p', { class: 'rg2t-intro' }, 'Новая последовательность ходов для каждой тренировки. От 2 × 2 до 7 × 7.'));
    root.append(el('div', { class: 'rg2t-bar' }, field('КУБИК', sizeSelect), field('ХОДОВ', lengthInput), button('Сгенерировать', generate, 'rg2t-primary', { 'data-action': 'generate' })));
    root.append(el('div', { class: 'rg2t-card' }, text, el('div', { class: 'rg2t-bar' }, button('Копировать скрамбл', () => copyText(current, value => { status.textContent = value; }))), status));
    root.append(el('p', { class: 'rg2t-note' }, 'Случайные ходы без соседних поворотов одной оси. Для больших кубиков используются широкие ходы Rw и 3Rw. Это генератор последовательностей ходов, не соревновательный random-state.'));
    addSourceHelp(root, options.trainerData, 'scramble', options);
    return () => {};
  }

  function pllTool(root, options) {
    const cases = options.trainerData && options.trainerData.pll;
    if (!Array.isArray(cases) || cases.length !== 21) { root.append(el('p', { class: 'rg2t-empty' }, 'Не удалось загрузить исходные случаи PLL.')); return () => {}; }
    let naming = 'international', rotate = true, deck = [], current = null, answered = false, right = 0, total = 0, streak = 0, startedAt = 0, rotation = 0, disposed = false;
    const image = el('img', { class: 'rg2t-pll-image', alt: 'Ситуация PLL для распознавания', draggable: 'false' });
    const choices = el('div', { class: 'rg2t-choices' });
    const feedback = el('div', { class: 'rg2t-feedback', role: 'status', 'aria-live': 'polite' });
    const score = el('div', { class: 'rg2t-score' });
    const next = button('Следующий случай →', () => nextCase(), 'rg2t-primary rg2t-next', { 'data-action': 'next-case' });
    const rotateCheck = el('input', { type: 'checkbox', checked: true, onchange: event => { rotate = event.target.checked; image.style.transform = `rotate(${rotate ? rotation : 0}deg)`; } });
    const label = item => naming === 'russian' ? item.russianName : item.name;
    root.append(el('h1', { class: 'rg2t-heading' }, 'Тренажёр PLL'), el('p', { class: 'rg2t-intro' }, 'Узнавайте все 21 случай по исходным схемам RG2. Выберите название показанной ситуации.'));
    root.append(el('div', { class: 'rg2t-bar' }, field('НАЗВАНИЯ', select([{ value: 'international', label: 'Международные' }, { value: 'russian', label: 'Максима Чечнева' }], naming, value => { naming = value; renderChoices(); })), el('label', { class: 'rg2t-check' }, rotateCheck, 'Случайный поворот схемы'), button('Новая сессия', () => { right = total = streak = 0; deck = []; nextCase(); })));
    root.append(score, el('div', { class: 'rg2t-quiz-layout' }, el('div', { class: 'rg2t-figure' }, image), el('div', { class: 'rg2t-quiz-panel' }, el('h2', { class: 'rg2t-question' }, 'Какой это PLL?'), choices, feedback, next)));
    addSourceHelp(root, options.trainerData, 'pll', options);
    let choiceItems = [];
    function updateScore() { score.replaceChildren(...[[right, 'верно'], [total, 'ответов'], [streak, 'подряд']].map(([value, text]) => el('span', {}, el('strong', {}, value), text))); }
    function renderChoices() {
      choices.replaceChildren(...choiceItems.map((item, index) => {
        const control = button('', () => answer(item), 'rg2t-choice', { 'data-answer': item.name, 'aria-label': label(item) });
        control.append(el('span', {}, label(item)), el('small', {}, naming === 'russian' ? item.name : item.russianName));
        if (answered) { control.disabled = true; if (item.name === current.name) control.classList.add('rg2t-right'); }
        return control;
      }));
    }
    function nextCase() {
      if (disposed) return;
      if (!deck.length) { deck = shuffled(cases); if (current && deck[deck.length - 1].name === current.name) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]]; }
      current = deck.pop(); answered = false; startedAt = performance.now(); rotation = randomInt(4) * 90;
      choiceItems = shuffled([current, ...shuffled(cases.filter(item => item.name !== current.name)).slice(0, 3)]);
      image.src = assetUrl(current.image, options); image.style.transform = `rotate(${rotate ? rotation : 0}deg)`;
      feedback.textContent = 'Клавиши 1–4 выбирают ответ.'; next.hidden = true; renderChoices(); updateScore();
    }
    function answer(item) {
      if (answered) return;
      answered = true; total++; const isRight = item.name === current.name;
      if (isRight) { right++; streak++; } else streak = 0;
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(2);
      feedback.textContent = isRight ? `Верно · ${current.name} — ${current.russianName} · ${seconds} с` : `Правильный ответ: ${current.name} — ${current.russianName}`;
      renderChoices(); if (!isRight) choices.querySelector(`[data-answer="${item.name}"]`).classList.add('rg2t-wrong');
      next.hidden = false; updateScore();
    }
    function keydown(event) {
      if (event.target.closest('input,select,textarea,[contenteditable=true]') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (!answered && /^[1-4]$/.test(event.key)) { event.preventDefault(); answer(choiceItems[Number(event.key) - 1]); }
      else if (answered && event.key === 'Enter') { event.preventDefault(); nextCase(); }
    }
    document.addEventListener('keydown', keydown); nextCase();
    return () => { disposed = true; document.removeEventListener('keydown', keydown); };
  }

  function alphabetTool(root, options) {
    const data = options.trainerData && options.trainerData.azbuka;
    if (!data || !data.alphabets || !data.movePermutations || !data.slotElementNumbers) { root.append(el('p', { class: 'rg2t-empty' }, 'Не удалось загрузить исходную азбуку.')); return () => {}; }
    const saved = readStore(ALPHABET_KEY, {});
    let scheme = ['maxim', 'anton', 'custom'].includes(saved.scheme) ? saved.scheme : 'maxim';
    let custom = Array.isArray(saved.custom) && saved.custom.length === 54 ? saved.custom.map(String) : [...data.alphabets.maxim];
    let type = ['both', 'edges', 'corners'].includes(saved.type) ? saved.type : 'both';
    let limit = [0, 5, 10, 15, 30].includes(Number(saved.limit)) ? Number(saved.limit) : 0;
    let current = null, answered = false, right = 0, total = 0, streak = 0, disposed = false, deadline = 0, interval = 0, images = null, generation = 0;
    const persist = () => writeStore(ALPHABET_KEY, { scheme, custom, type, limit });
    const alphabet = () => scheme === 'custom' ? custom : data.alphabets[scheme];
    const canvas = el('canvas', { class: 'rg2t-alpha-canvas', width: '600', height: '600', role: 'img', 'aria-label': 'Куб с выделенным элементом' });
    const figureCaption = el('p', { class: 'rg2t-note', 'data-alpha-colors': '' });
    const choices = el('div', { class: 'rg2t-choices rg2t-letter-choices' });
    const feedback = el('div', { class: 'rg2t-feedback', role: 'status', 'aria-live': 'polite' });
    const score = el('div', { class: 'rg2t-score' });
    const progressFill = el('span', { style: 'width:100%' });
    const progress = el('div', { class: 'rg2t-progress', role: 'progressbar', 'aria-label': 'Оставшееся время', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '100' }, progressFill);
    const next = button('Следующий элемент →', () => nextQuestion(), 'rg2t-primary rg2t-next', { 'data-action': 'next-case' });
    const editor = el('div', { class: 'rg2t-alpha-editor', hidden: true });
    const schemeSelect = select([{ value: 'maxim', label: 'Максима Чечнева' }, { value: 'anton', label: 'Азбука Антона (RG2)' }, { value: 'custom', label: 'Моя азбука' }], scheme, value => { scheme = value; persist(); nextQuestion(); }, { 'aria-label': 'Азбука' });
    root.append(el('h1', { class: 'rg2t-heading' }, 'Тренажёр азбуки'), el('p', { class: 'rg2t-intro' }, 'Определите букву выделенного стикера по цветам элемента. Азбуки, повороты и схема куба сохранены из RG2.'));
    root.append(el('div', { class: 'rg2t-bar' }, field('АЗБУКА', schemeSelect), field('ЭЛЕМЕНТЫ', select([{ value: 'both', label: 'Рёбра и углы' }, { value: 'edges', label: 'Только рёбра' }, { value: 'corners', label: 'Только углы' }], type, value => { type = value; persist(); nextQuestion(); })), field('ВРЕМЯ НА ОТВЕТ', select([0, 5, 10, 15, 30].map(value => ({ value, label: value ? value + ' секунд' : 'Без ограничения' })), limit, value => { limit = Number(value); persist(); nextQuestion(); })), button('Моя азбука', () => { editor.hidden = !editor.hidden; if (!editor.hidden) renderEditor(); })));
    root.append(editor, score, el('div', { class: 'rg2t-quiz-layout' }, el('div', { class: 'rg2t-figure' }, canvas, figureCaption), el('div', { class: 'rg2t-quiz-panel' }, el('h2', { class: 'rg2t-question' }, 'Какой букве соответствует стикер?'), progress, choices, feedback, next)));
    addSourceHelp(root, options.trainerData, 'azbuka', options);

    function updateScore() { score.replaceChildren(...[[right, 'верно'], [total, 'ответов'], [streak, 'подряд']].map(([value, text]) => el('span', {}, el('strong', {}, value), text))); }
    function renderEditor() {
      const faces = el('div', { class: 'rg2t-alpha-faces' });
      for (let face = 0; face < 6; face++) {
        const faceGrid = el('div', { class: 'rg2t-alpha-face' }, el('span', { class: 'rg2t-alpha-face-title' }, COLOR_NAMES[face]));
        for (let sticker = 0; sticker < 9; sticker++) {
          const index = face * 9 + sticker;
          const input = el('input', { type: 'text', value: custom[index], maxlength: '2', disabled: sticker === 4, 'aria-label': COLOR_NAMES[face] + ', стикер ' + (sticker + 1), 'data-sticker': index });
          faceGrid.append(input);
        }
        faces.append(faceGrid);
      }
      editor.replaceChildren(el('p', { class: 'rg2t-note' }, 'Буквы расположены по той же нумерации граней, что и в исходной азбуке RG2. Центры не участвуют.'), faces,
        el('div', { class: 'rg2t-bar' }, button('Сохранить и использовать', () => {
          const values = [...editor.querySelectorAll('[data-sticker]')].map(input => input.disabled ? '-' : input.value.trim().toUpperCase());
          if (values.some((value, index) => index % 9 !== 4 && !value)) { feedback.textContent = 'Укажите букву для каждого стикера.'; return; }
          custom = values; scheme = 'custom'; schemeSelect.value = scheme; persist(); editor.hidden = true; nextQuestion();
        }, 'rg2t-primary'), button('Взять азбуку Чечнева', () => { custom = [...data.alphabets.maxim]; renderEditor(); }), button('Закрыть', () => { editor.hidden = true; })));
    }
    function allLetters(isCorner) {
      const indexes = Object.values(isCorner ? data.mainCorner : data.mainEdge);
      return [...new Set(indexes.map(index => alphabet()[index]).filter(value => value && value !== '-'))].sort((a, b) => a.localeCompare(b, 'ru'));
    }
    function renderChoices() {
      if (!current) return;
      choices.replaceChildren(...allLetters(current.slot < 3).map(letter => {
        const control = button(letter, () => answer(letter), 'rg2t-choice', { 'data-answer': letter, 'aria-label': 'Буква ' + letter });
        if (answered) { control.disabled = true; if (letter === current.letter) control.classList.add('rg2t-right'); }
        return control;
      }));
    }
    async function loadImages() {
      images = await Promise.all(data.layerPaths.map(path => new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Не удалось загрузить схему куба.')); image.src = assetUrl(path, options);
      })));
    }
    function drawCube(cube, slot) {
      if (!images || disposed) return;
      const rotated = applyMoves(cube, 'Y Y', data.movePermutations);
      rotated[27] = 6;
      const context = canvas.getContext('2d');
      const layer = document.createElement('canvas'); layer.width = layer.height = 600;
      const layerContext = layer.getContext('2d');
      context.clearRect(0, 0, 600, 600);
      context.fillStyle = '#fafafa'; context.fillRect(0, 0, 600, 600);
      for (let i = 0; i < 28; i++) {
        layerContext.clearRect(0, 0, 600, 600); layerContext.globalCompositeOperation = 'source-over';
        layerContext.drawImage(images[i], 0, 0, 600, 600);
        layerContext.globalCompositeOperation = 'source-in'; layerContext.fillStyle = data.colors[rotated[27 - i]]; layerContext.fillRect(0, 0, 600, 600);
        context.drawImage(layer, 0, 0);
      }
      const point = data.slotLightingCoordinate[String(slot)];
      if (point) {
        const [x, y, radius] = Array.isArray(point) ? point : [point.first, point.second, point.third];
        layerContext.globalCompositeOperation = 'source-over'; layerContext.clearRect(0, 0, 600, 600);
        layerContext.fillStyle = 'rgba(0,0,0,.34)'; layerContext.fillRect(0, 0, 600, 600);
        layerContext.globalCompositeOperation = 'destination-out'; layerContext.beginPath(); layerContext.arc(x * 600, y * 600, radius * 600, 0, Math.PI * 2); layerContext.fill();
        context.drawImage(layer, 0, 0);
        context.beginPath(); context.arc(x * 600, y * 600, radius * 600, 0, Math.PI * 2); context.strokeStyle = '#fff'; context.lineWidth = 2; context.stroke();
      }
    }
    async function nextQuestion() {
      if (disposed) return;
      const token = ++generation;
      answered = false; clearInterval(interval); next.hidden = true; feedback.textContent = 'Загрузка схемы…';
      try { if (!images) await loadImages(); } catch (error) { if (!disposed) feedback.textContent = error.message; return; }
      if (disposed || token !== generation) return;
      const slots = type === 'edges' ? [3, 4, 5, 6] : type === 'corners' ? [0, 1, 2] : [0, 1, 2, 3, 4, 5, 6];
      const slot = slots[randomInt(slots.length)];
      const cube = applyMoves(data.solvedCube, generateScramble(3, 19), data.movePermutations);
      const pair = data.slotElementNumbers[String(slot)];
      const [first, second] = Array.isArray(pair) ? pair : [pair.first, pair.second];
      const identity = (cube[first] + 1) * 10 + cube[second] + 1;
      const index = (slot < 3 ? data.mainCorner : data.mainEdge)[String(identity)];
      if (index == null) { feedback.textContent = 'Не удалось определить элемент кубика.'; return; }
      current = { slot, cube, index, letter: alphabet()[index] };
      drawCube(cube, slot);
      const colors = `${COLOR_NAMES[cube[first]]} → ${COLOR_NAMES[cube[second]]} · ${slot < 3 ? 'угол' : 'ребро'}`;
      figureCaption.textContent = colors; canvas.setAttribute('aria-label', 'Выделенный стикер: ' + colors + '. Определите букву.');
      feedback.textContent = 'Выберите букву или нажмите её на клавиатуре.'; renderChoices(); updateScore();
      progress.hidden = !limit; progressFill.style.width = '100%'; progress.setAttribute('aria-valuenow', '100');
      deadline = performance.now() + limit * 1000;
      if (limit) interval = setInterval(() => {
        const fraction = Math.max(0, (deadline - performance.now()) / (limit * 1000));
        progressFill.style.width = fraction * 100 + '%'; progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
        if (fraction <= 0) answer(null);
      }, 100);
    }
    function answer(letter) {
      if (answered || !current) return;
      answered = true; clearInterval(interval); total++;
      const isRight = letter === current.letter;
      if (isRight) { right++; streak++; } else streak = 0;
      feedback.textContent = isRight ? 'Верно · ' + current.letter : (letter == null ? 'Время вышло. ' : '') + 'Правильная буква: ' + current.letter;
      renderChoices();
      if (letter && !isRight) [...choices.children].find(node => node.dataset.answer === letter)?.classList.add('rg2t-wrong');
      next.hidden = false; updateScore();
    }
    function keydown(event) {
      if (event.target.closest('input,select,textarea,[contenteditable=true]') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (answered && event.key === 'Enter') { event.preventDefault(); nextQuestion(); return; }
      if (!answered && current) {
        const letter = event.key.toUpperCase();
        if (allLetters(current.slot < 3).includes(letter)) { event.preventDefault(); answer(letter); }
      }
    }
    document.addEventListener('keydown', keydown); nextQuestion();
    return () => { disposed = true; generation++; clearInterval(interval); document.removeEventListener('keydown', keydown); };
  }

  function mount(container, toolId, options = {}) {
    addStyles();
    const root = el('section', { class: 'rg2-tools', 'data-tool': toolId }); container.replaceChildren(root);
    const aliases = { scrambler: 'scramble', scrmbl: 'scramble', plltest: 'pll', azbuka: 'alphabet', azbuka_trainer: 'alphabet', pll_trainer: 'pll' };
    toolId = aliases[toolId] || toolId;
    const factory = { timer: timerTool, scramble: scrambleTool, pll: pllTool, alphabet: alphabetTool }[toolId];
    if (!factory) { root.append(el('p', {}, 'Инструмент не найден.')); return () => root.remove(); }
    const dispose = factory(root, options) || (() => {});
    return () => { dispose(); root.remove(); };
  }
  const api = { mount, generateScramble, formatTime, averageOf, resultValue, applyMoves, version: '1.0.0' };
  host.RG2Tools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
