import { CENTER_INDICES, applyAlg, centers as readCenters, parseAlg, rotateToCross } from './core.mjs';

const IDENTITY = Object.freeze(Array.from({ length: 54 }, (_, index) => index));
const LABELS = Uint8Array.from(IDENTITY);

function colorNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[0-5]$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 6 ? number : null;
}

/** Persist a palette preference without confusing "auto" with color zero. */
export function normalizeCrossPreference(value) {
  return colorNumber(value) ?? 'auto';
}

/**
 * Auto keeps the already chosen comparison color; its initial preference is
 * white (0). Every valid custom center scheme contains all six palette colors.
 */
export function determineCrossColor(rawState, preference = 'auto', selected = 0) {
  const explicit = normalizeCrossPreference(preference);
  return explicit === 'auto' ? colorNumber(selected) ?? 0 : explicit;
}

function snapshot(rawState) {
  try { return rawState == null ? [] : Array.from(rawState); }
  catch (_) { return []; }
}

function centerError(state) {
  if (state.length !== 54) return { code: 'SIZE', message: 'Нужны 54 наклейки, чтобы определить ориентацию куба.' };
  const values = readCenters(state);
  if (values.some(value => !Number.isInteger(value) || value < 0 || value > 5)) {
    return { code: 'CENTERS', message: 'Укажите один из шести цветов для каждого центра.', indices: [...CENTER_INDICES] };
  }
  if (new Set(values).size !== 6) {
    return { code: 'CENTERS', message: 'Шесть центров должны иметь разные цвета.', indices: [...CENTER_INDICES] };
  }
  // Color schemes are relative to the user's centers. A custom permutation is
  // supported; it must not be mistaken for an impossible painted cube here.
  return null;
}

function mappingFromMoves(moves) {
  const displayToInput = Array.from(applyAlg(LABELS, moves));
  const inputToDisplay = new Array(54);
  displayToInput.forEach((inputIndex, displayIndex) => { inputToDisplay[inputIndex] = displayIndex; });
  return { displayToInput, inputToDisplay };
}

function fallbackMoves(fallback) {
  try {
    const value = fallback && !Array.isArray(fallback) && typeof fallback === 'object' ? fallback.moves : fallback;
    const tokens = typeof value === 'string' ? parseAlg(value) : Array.isArray(value) ? parseAlg(value.join(' ')) : [];
    return tokens.every(token => /^[xyz](?:2|')?$/.test(token)) ? tokens : [];
  } catch (_) { return []; }
}

function mapping(value) {
  const source = value?.displayToInput ?? value ?? IDENTITY;
  const result = snapshot(source);
  if (result.length !== 54 || new Set(result).size !== 54 || result.some(index => !Number.isInteger(index) || index < 0 || index >= 54)) {
    throw new RangeError('Ожидается взаимно однозначная таблица из 54 индексов наклеек.');
  }
  return result;
}

/** displayed[i] = raw[displayToInput[i]], without coercing unpainted stickers. */
export function displayFromInput(rawState, orientation = IDENTITY) {
  const raw = snapshot(rawState);
  if (raw.length !== 54) throw new RangeError('Ожидаются 54 исходные наклейки.');
  return mapping(orientation).map(index => raw[index]);
}

/** Reconstruct original input indices after editing the oriented display. */
export function inputFromDisplay(displayedState, orientation = IDENTITY) {
  const displayed = snapshot(displayedState);
  if (displayed.length !== 54) throw new RangeError('Ожидаются 54 отображаемые наклейки.');
  const result = new Array(54);
  mapping(orientation).forEach((inputIndex, displayIndex) => { result[inputIndex] = displayed[displayIndex]; });
  return result;
}

/**
 * Fix the chosen cross color on D using explicit whole-cube rotations. Raw
 * input/scramble data are never mutated. The state is an ordinary array so an
 * unknown -1/null/255 remains unknown instead of being converted to color 0.
 *
 * Invalid centers return an error and identity mapping. A previous orientation
 * (or xyz token list/string) can be supplied as fallback to retain its display
 * frame while the user fixes the input. It never makes invalid centers valid.
 */
export function orientForCross(rawState, colorId = 0, { fallback } = {}) {
  const raw = snapshot(rawState);
  const invalid = centerError(raw);
  const selected = colorId === 'auto' ? determineCrossColor(raw) : colorNumber(colorId);
  let error = invalid;
  let moves = [];
  if (!error && selected == null) error = { code: 'CROSS_COLOR', message: 'Выберите один из шести цветов креста.' };
  if (!error) {
    try { moves = [...rotateToCross(raw, selected).moves]; }
    catch (_) { error = { code: 'ORIENTATION', message: 'Не удалось поставить выбранный цвет креста на нижнюю грань.' }; }
  }
  if (error) moves = fallbackMoves(fallback);
  const maps = mappingFromMoves(moves);
  const state = raw.length === 54 ? maps.displayToInput.map(index => raw[index]) : [...raw];
  return {
    state, moves, ...maps, centers: state.length === 54 ? readCenters(state) : [],
    validCenters: !invalid, colorId: selected,
    ...(error ? { error, usedFallback: moves.length > 0 } : {}),
  };
}
