/* Random-turn 3x3 scrambles, replayable from the input cube's center frame. */
import { FACE_NAMES, CENTER_INDICES, applyAlg, stateKey } from './core.mjs';

export const SCRAMBLE_LENGTH = 20;
const FACES = ['R', 'L', 'U', 'D', 'F', 'B'];
const AXIS = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
const SUFFIXES = ['', "'", '2'];
const OUTER_MOVE = /^[URFDLB](?:2|')?$/;

export function inputCenters(input) {
  if (!input || (input.length !== 54 && input.length !== 6)) throw new RangeError('Нужна раскраска из 54 наклеек или шесть центров.');
  const result = input.length === 6 ? Array.from(input) : CENTER_INDICES.map(index => input[index]);
  if (result.some(color => !Number.isInteger(color) || color < 0 || color > 5) || new Set(result).size !== 6) {
    throw new RangeError('Для скрамбла нужны шесть разных цветов центров.');
  }
  return result;
}

export function solvedWithCenters(input) {
  const centerColors = inputCenters(input);
  return Uint8Array.from({ length: 54 }, (_, index) => centerColors[Math.floor(index / 9)]);
}

function randomInt(maximum, rng) {
  if (rng) {
    const value = rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Генератор случайных чисел должен возвращать значение от 0 до 1.');
    return Math.floor(value * maximum);
  }
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1), ceiling = Math.floor(4294967296 / maximum) * maximum;
    do { globalThis.crypto.getRandomValues(buffer); } while (buffer[0] >= ceiling);
    return buffer[0] % maximum;
  }
  return Math.floor(Math.random() * maximum);
}

function isSequence(moves) {
  return Array.isArray(moves) && moves.length === SCRAMBLE_LENGTH && moves.every((token, index) =>
    typeof token === 'string' && OUTER_MOVE.test(token) && (!index || AXIS[token[0]] !== AXIS[moves[index - 1][0]]));
}

// Matches the existing desktop generator: outer moves with no repeated axis.
// In the application RG2Tools.generateScramble is reused directly; this small
// pure fallback keeps the module usable in workers and dependency-free tests.
function fallbackGenerate(rng) {
  const moves = [];
  let previousAxis = -1;
  for (let index = 0; index < SCRAMBLE_LENGTH; index++) {
    const available = FACES.filter(face => AXIS[face] !== previousAxis);
    const face = available[randomInt(available.length, rng)];
    randomInt(1, rng); // Existing generator's width choice, fixed to one on 3x3.
    moves.push(face + SUFFIXES[randomInt(3, rng)]);
    previousAxis = AXIS[face];
  }
  return moves;
}

export function generateScrambleMoves({ previousMoves, rng, generator = globalThis.RG2Tools?.generateScramble } = {}) {
  const previous = Array.isArray(previousMoves) ? previousMoves.join(' ') : String(previousMoves || '');
  let moves;
  for (let attempt = 0; attempt < 8; attempt++) {
    const generated = generator ? generator(3, SCRAMBLE_LENGTH, rng) : fallbackGenerate(rng);
    moves = typeof generated === 'string' ? generated.trim().split(/\s+/) : Array.from(generated);
    if (!isSequence(moves)) throw new Error('Генератор вернул неверный скрамбл 3×3.');
    if (moves.join(' ') !== previous) return moves;
  }
  // A broken/constant RNG still cannot repeat the immediately preceding record.
  const last = moves[moves.length - 1], suffix = last.slice(1);
  moves[moves.length - 1] = last[0] + SUFFIXES[(SUFFIXES.indexOf(suffix) + 1) % SUFFIXES.length];
  return moves;
}

function recordFor(moves, centerColors, state) {
  const hash = stateKey(state);
  return {
    version: 1,
    moves: [...moves], centers: [...centerColors], state: Array.from(state),
    inputHash: hash, hash,
    orientation: Object.fromEntries(FACE_NAMES.map((face, index) => [face, centerColors[index]])),
  };
}

export function createScramble(input, options = {}) {
  const centerColors = inputCenters(input);
  const moves = generateScrambleMoves(options);
  const state = applyAlg(solvedWithCenters(centerColors), moves);
  return recordFor(moves, centerColors, state);
}

/** Restore provenance only when centers, hash, and every replayed sticker agree. */
export function restoreScramble(record, input) {
  try {
    if (!record || record.version !== 1 || !isSequence(record.moves) || !Array.isArray(record.centers) || record.centers.length !== 6 || !input || input.length !== 54) return null;
    const centerColors = inputCenters(input), savedCenters = inputCenters(record.centers);
    if (!centerColors.every((color, index) => color === savedCenters[index])) return null;
    const expectedHash = stateKey(input);
    if (record.inputHash !== expectedHash || (record.hash != null && record.hash !== expectedHash)) return null;
    const replay = applyAlg(solvedWithCenters(centerColors), record.moves);
    if (stateKey(replay) !== expectedHash) return null;
    if (record.state != null && (!Array.isArray(record.state) || record.state.length !== 54 || !record.state.every((color, index) => color === replay[index]))) return null;
    return recordFor(record.moves, centerColors, replay);
  } catch { return null; }
}
