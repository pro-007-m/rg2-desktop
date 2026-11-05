/* Exact facelet geometry and cubie validation for the local 3x3 CFOP solver. */
export const FACE_NAMES = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);
export const SOLVED = Uint8Array.from({ length: 54 }, (_, i) => Math.floor(i / 9));
export const CENTER_INDICES = Object.freeze([4, 13, 22, 31, 40, 49]);
export const CORNER_FACELETS = Object.freeze([
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
]);
export const EDGE_FACELETS = Object.freeze([
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
]);
const CORNER_COLORS = CORNER_FACELETS.map(indices => indices.map(i => Math.floor(i / 9)));
const EDGE_COLORS = EDGE_FACELETS.map(indices => indices.map(i => Math.floor(i / 9)));
export const SLOT_NAMES = Object.freeze(['FR', 'FL', 'BL', 'BR']);

function geometry(face, row, column) {
  const r = row, c = column;
  return [
    { position: [c - 1, 1, r - 1], normal: [0, 1, 0] },
    { position: [1, 1 - r, 1 - c], normal: [1, 0, 0] },
    { position: [c - 1, 1 - r, 1], normal: [0, 0, 1] },
    { position: [c - 1, -1, 1 - r], normal: [0, -1, 0] },
    { position: [-1, 1 - r, c - 1], normal: [-1, 0, 0] },
    { position: [1 - c, 1 - r, -1], normal: [0, 0, -1] },
  ][face];
}
export const FACELETS = Object.freeze(Array.from({ length: 54 }, (_, index) => {
  const face = Math.floor(index / 9);
  return Object.freeze({ ...geometry(face, Math.floor((index % 9) / 3), index % 3), face: FACE_NAMES[face], index });
}));
const geometryKey = (position, normal) => position.join(',') + '/' + normal.join(',');
const geometryIndex = new Map(FACELETS.map(item => [geometryKey(item.position, item.normal), item.index]));

function canonical(base, exponent) {
  const power = ((exponent % 4) + 4) % 4;
  return power === 0 ? [] : [base + (power === 2 ? '2' : power === 3 ? "'" : '')];
}
const INNER = { R: ['M', -1], L: ['M', 1], U: ['E', -1], D: ['E', 1], F: ['S', 1], B: ['S', -1] };
const WHOLE = { R: ['x', 1], L: ['x', -1], U: ['y', 1], D: ['y', -1], F: ['z', 1], B: ['z', -1] };

export function parseAlg(raw) {
  if (Array.isArray(raw)) return raw.flatMap(token => parseAlg(token));
  if (typeof raw !== 'string') throw new TypeError('Алгоритм должен быть строкой.');
  const text = raw.replace(/[’‘′`´ʼ]/g, "'").replace(/″/g, '2').replace(/²/g, '2')
    .replace(/\/\/[^\r\n]*/g, '').replace(/\u00a0/g, ' ');
  let cursor = 0;
  const fail = message => { throw new SyntaxError(`${message} (позиция ${cursor + 1})`); };
  const skip = () => { while (/\s|[·.]/.test(text[cursor] || '\0')) cursor++; };
  function suffix(tokens, repeated) {
    skip();
    let count = 1;
    if (repeated && /[0-9]/.test(text[cursor] || '')) {
      const start = cursor;
      while (/[0-9]/.test(text[cursor] || '')) cursor++;
      count = Number(text.slice(start, cursor));
      if (!Number.isInteger(count) || count > 1000) fail('Слишком большое повторение');
    }
    skip();
    if (text[cursor] === "'") { tokens = invertAlg(tokens); cursor++; }
    if (tokens.length * count > 10000) fail('Алгоритм слишком длинный');
    return Array.from({ length: count }, () => tokens).flat();
  }
  function sequence(stops = '', depth = 0) {
    if (depth > 24) fail('Слишком глубокая вложенность');
    const out = [];
    while (true) {
      skip();
      const char = text[cursor];
      if (!char || stops.includes(char)) return out;
      if (char === '(') {
        cursor++;
        const group = sequence(')', depth + 1);
        if (text[cursor] !== ')') fail('Не закрыта скобка');
        cursor++; out.push(...suffix(group, true));
      } else if (char === '[') {
        cursor++;
        const left = sequence(',:]', depth + 1);
        const separator = text[cursor++];
        if (separator === ']') { out.push(...suffix(left, true)); continue; }
        if (separator !== ',' && separator !== ':') fail('В коммутаторе ожидается , или :');
        const right = sequence(']', depth + 1);
        if (text[cursor] !== ']' || !left.length || !right.length) fail('Неверный коммутатор');
        cursor++;
        const group = separator === ',' ? [...left, ...right, ...invertAlg(left), ...invertAlg(right)] : [...left, ...right, ...invertAlg(left)];
        out.push(...suffix(group, true));
      } else {
        const start = cursor;
        let prefix = '';
        while (/[0-9]/.test(text[cursor] || '')) prefix += text[cursor++];
        const letter = text[cursor++];
        if (!letter || !/[URFDLBurfdlbMESmesxyzXYZ]/.test(letter)) { cursor = start; fail('Неизвестный ход'); }
        let wide = text[cursor] === 'w' || text[cursor] === 'W';
        if (wide) cursor++;
        const lowerWide = /[urfdlb]/.test(letter);
        let base = /[xyzXYZ]/.test(letter) ? letter.toLowerCase() : letter.toUpperCase();
        wide ||= lowerWide;
        let factor = 1;
        if (wide) {
          if (!/[URFDLB]/.test(base)) fail('Неверный широкий ход');
          if (prefix === '3') [base, factor] = WHOLE[base];
          else if (!prefix || prefix === '2') base += 'w';
          else fail('Ширина хода не подходит для 3×3');
        } else if (prefix && prefix !== '1') {
          if (prefix !== '2' || !INNER[base]) fail('Слой не подходит для 3×3');
          [base, factor] = INNER[base];
        }
        let power = 1, hadPower = false, prime = false;
        while (/[0-9']/.test(text[cursor] || '\0')) {
          if (text[cursor] === "'") {
            if (prime) fail('Повторный штрих');
            prime = true; cursor++;
          } else {
            if (hadPower) fail('Повторная степень хода');
            const startPower = cursor;
            while (/[0-9]/.test(text[cursor] || '\0')) cursor++;
            power = Number(text.slice(startPower, cursor)); hadPower = true;
            if (!Number.isSafeInteger(power)) fail('Слишком большая степень хода');
          }
        }
        out.push(...canonical(base, factor * power * (prime ? -1 : 1)));
      }
      if (out.length > 10000) fail('Алгоритм слишком длинный');
    }
  }
  const tokens = sequence();
  skip();
  if (cursor !== text.length) fail('Лишняя закрывающая скобка');
  return tokens;
}

export function invertAlg(algorithm) {
  const tokens = typeof algorithm === 'string' ? parseAlg(algorithm) : [...algorithm];
  return tokens.reverse().map(token => token.endsWith('2') ? token : token.endsWith("'") ? token.slice(0, -1) : token + "'");
}

const BASE_INFO = {
  R: ['x', [1], -1], L: ['x', [-1], 1], U: ['y', [1], -1], D: ['y', [-1], 1], F: ['z', [1], -1], B: ['z', [-1], 1],
  Rw: ['x', [0, 1], -1], Lw: ['x', [-1, 0], 1], Uw: ['y', [0, 1], -1], Dw: ['y', [-1, 0], 1], Fw: ['z', [0, 1], -1], Bw: ['z', [-1, 0], 1],
  M: ['x', [0], 1], E: ['y', [0], 1], S: ['z', [0], -1], x: ['x', [-1, 0, 1], -1], y: ['y', [-1, 0, 1], -1], z: ['z', [-1, 0, 1], -1],
};
export function moveInfo(token) {
  const tokens = parseAlg(token);
  if (tokens.length !== 1) throw new SyntaxError('Ожидается один ход.');
  token = tokens[0];
  const base = token.replace(/[2']/g, '');
  const [axis, layers, sign] = BASE_INFO[base];
  return { token, axis, layers: [...layers], quarterTurns: sign * (token.endsWith('2') ? 2 : token.endsWith("'") ? -1 : 1) };
}
function rotate(vector, axis, turns) {
  let [x, y, z] = vector;
  const count = ((turns % 4) + 4) % 4;
  for (let i = 0; i < count; i++) {
    if (axis === 'x') [x, y, z] = [x, -z, y];
    else if (axis === 'y') [x, y, z] = [z, y, -x];
    else [x, y, z] = [-y, x, z];
  }
  return [x || 0, y || 0, z || 0];
}
export const MOVE_PERMUTATIONS = Object.create(null);
function permutation(token) {
  if (MOVE_PERMUTATIONS[token]) return MOVE_PERMUTATIONS[token];
  const info = moveInfo(token), axisIndex = { x: 0, y: 1, z: 2 }[info.axis];
  const result = new Uint8Array(54);
  for (const sticker of FACELETS) {
    const moved = info.layers.includes(sticker.position[axisIndex]);
    const position = moved ? rotate(sticker.position, info.axis, info.quarterTurns) : sticker.position;
    const normal = moved ? rotate(sticker.normal, info.axis, info.quarterTurns) : sticker.normal;
    result[geometryIndex.get(geometryKey(position, normal))] = sticker.index;
  }
  MOVE_PERMUTATIONS[info.token] = result;
  return result;
}
export function applyMove(state, token) {
  if (!state || state.length !== 54) throw new RangeError('Ожидаются 54 наклейки.');
  const move = permutation(token);
  return Uint8Array.from(move, index => state[index]);
}
export function applyAlg(state, algorithm) {
  if (!state || state.length !== 54) throw new RangeError('Ожидаются 54 наклейки.');
  let result = Uint8Array.from(state);
  for (const token of typeof algorithm === 'string' ? parseAlg(algorithm) : algorithm) result = applyMove(result, token);
  return result;
}
export function stateKey(state) { return Array.from(state, value => String.fromCharCode(65 + value)).join(''); }
export function centers(state) { return CENTER_INDICES.map(index => state[index]); }

export function analyze(state) {
  if (!state || state.length !== 54) throw new RangeError('Ожидаются 54 наклейки.');
  const centerColors = centers(state);
  if (new Set(centerColors).size !== 6) throw new RangeError('Центры должны иметь разные цвета.');
  const colorFace = new Map(centerColors.map((value, index) => [value, index]));
  const normalized = Array.from(state, value => colorFace.get(value));
  const cp = new Int8Array(8).fill(-1), co = new Int8Array(8).fill(-1);
  const ep = new Int8Array(12).fill(-1), eo = new Int8Array(12).fill(-1);
  for (let position = 0; position < 8; position++) {
    const facelets = CORNER_FACELETS[position];
    const orientation = facelets.findIndex(index => normalized[index] === 0 || normalized[index] === 3);
    if (orientation < 0) continue;
    const c0 = normalized[facelets[orientation]];
    const c1 = normalized[facelets[(orientation + 1) % 3]], c2 = normalized[facelets[(orientation + 2) % 3]];
    const cubie = CORNER_COLORS.findIndex(colors => colors[0] === c0 && colors[1] === c1 && colors[2] === c2);
    if (cubie >= 0) { cp[position] = cubie; co[position] = orientation; }
  }
  for (let position = 0; position < 12; position++) {
    const a = normalized[EDGE_FACELETS[position][0]], b = normalized[EDGE_FACELETS[position][1]];
    for (let cubie = 0; cubie < 12; cubie++) {
      if (a === EDGE_COLORS[cubie][0] && b === EDGE_COLORS[cubie][1]) { ep[position] = cubie; eo[position] = 0; break; }
      if (b === EDGE_COLORS[cubie][0] && a === EDGE_COLORS[cubie][1]) { ep[position] = cubie; eo[position] = 1; break; }
    }
  }
  return { cp, co, ep, eo };
}
function parity(permutation) {
  let value = 0;
  for (let i = 0; i < permutation.length; i++) for (let j = i + 1; j < permutation.length; j++) value ^= Number(permutation[i] > permutation[j]);
  return value;
}
export function validate(input) {
  const errors = [];
  const error = (code, message, indices) => errors.push({ code, message, ...(indices ? { indices } : {}) });
  if (!input || input.length !== 54) return { valid: false, errors: [{ code: 'SIZE', message: 'Нужно заполнить 54 наклейки.' }] };
  const invalid = Array.from(input, (value, index) => Number.isInteger(value) && value >= 0 && value < 6 ? -1 : index).filter(index => index >= 0);
  if (invalid.length) error('UNFILLED', 'Заполните все наклейки одним из шести цветов.', invalid);
  const counts = Array.from({ length: 6 }, (_, color) => Array.from(input).filter(value => value === color).length);
  if (counts.some(count => count !== 9)) error('COLOR_COUNT', 'Каждого цвета должно быть ровно девять наклеек.');
  if (new Set(centers(input)).size !== 6) error('CENTERS', 'Шесть центров должны иметь разные цвета.', CENTER_INDICES);
  if (errors.length) return { valid: false, errors };
  const state = Uint8Array.from(input), cubies = analyze(state);
  const unknownCorners = Array.from(cubies.cp, (value, index) => value < 0 ? index : -1).filter(index => index >= 0);
  const unknownEdges = Array.from(cubies.ep, (value, index) => value < 0 ? index : -1).filter(index => index >= 0);
  if (unknownCorners.length) error('CORNER_COLORS', 'Некоторые углы имеют невозможное сочетание или порядок цветов.', unknownCorners.flatMap(index => CORNER_FACELETS[index]));
  if (unknownEdges.length) error('EDGE_COLORS', 'Некоторые рёбра имеют невозможное сочетание цветов.', unknownEdges.flatMap(index => EDGE_FACELETS[index]));
  if (!unknownCorners.length && new Set(cubies.cp).size !== 8) error('DUPLICATE_CORNER', 'Каждый из восьми углов должен встречаться один раз.');
  if (!unknownEdges.length && new Set(cubies.ep).size !== 12) error('DUPLICATE_EDGE', 'Каждое из двенадцати рёбер должно встречаться один раз.');
  if (!errors.length) {
    if (Array.from(cubies.eo).reduce((a, b) => a + b, 0) % 2) error('EDGE_FLIP', 'Одно ребро перевёрнуто: такую раскраску нельзя получить поворотами куба.');
    if (Array.from(cubies.co).reduce((a, b) => a + b, 0) % 3) error('CORNER_TWIST', 'Нарушена сумма разворотов углов: проверьте ориентацию угловых наклеек.');
    if (parity(cubies.cp) !== parity(cubies.ep)) error('PARITY', 'Чётности перестановок рёбер и углов различаются. Проверьте раскраску; единственную неверную наклейку определить нельзя.');
  }
  return errors.length ? { valid: false, errors } : { valid: true, state, errors: [] };
}

function positionSolved(state, indices) { return indices.every(index => state[index] === state[Math.floor(index / 9) * 9 + 4]); }
export function isCross(state) { return EDGE_FACELETS.slice(4, 8).every(indices => positionSolved(state, indices)); }
export function solvedSlots(state) { return SLOT_NAMES.filter((_, slot) => positionSolved(state, CORNER_FACELETS[slot + 4]) && positionSolved(state, EDGE_FACELETS[slot + 8])); }
export function isF2L(state) { return isCross(state) && solvedSlots(state).length === 4; }
export function isOLL(state) { return isF2L(state) && Array.from(state.slice(0, 9)).every(color => color === state[4]); }
export function isSolved(state) { return FACE_NAMES.every((_, face) => positionSolved(state, Array.from({ length: 9 }, (_, index) => face * 9 + index))); }
export function areEdgesOriented(state) { return Array.from(analyze(state).eo).every(value => value === 0); }
export function areCornersSolved(state) { const { cp, co } = analyze(state); return Array.from(cp).every((value, index) => value === index && co[index] === 0); }

const ROTATIONS = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
export function restoreFrameSequence(state, targetCenters) {
  const target = targetCenters.length === 54 ? centers(targetCenters) : Array.from(targetCenters);
  if (target.length !== 6 || new Set(target).size !== 6) throw new RangeError('Ожидаются шесть разных цветов центров.');
  const targetKey = target.join(','), queue = [{ state: Uint8Array.from(state), moves: [] }], seen = new Set();
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head], key = centers(node.state).join(',');
    if (key === targetKey) return node.moves;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const token of ROTATIONS) {
      const next = applyMove(node.state, token);
      if (!seen.has(centers(next).join(','))) queue.push({ state: next, moves: [...node.moves, token] });
    }
  }
  throw new RangeError('Нельзя восстановить эту систему центров вращением целого куба.');
}
export function rotateToCross(state, colorId = 0) {
  const queue = [{ state: Uint8Array.from(state), moves: [] }], seen = new Set();
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head], key = centers(node.state).join(',');
    if (node.state[31] === colorId) return node;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const token of ROTATIONS) {
      const next = applyMove(node.state, token);
      if (!seen.has(centers(next).join(','))) queue.push({ state: next, moves: [...node.moves, token] });
    }
  }
  throw new RangeError('Выбранного цвета нет среди центров.');
}

export const MOVE_TOKENS = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B'].flatMap(face => [face, face + "'", face + '2']));
for (const base of Object.keys(BASE_INFO)) for (const suffix of ['', "'", '2']) permutation(base + suffix);
