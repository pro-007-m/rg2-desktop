import { applyAlg, parseAlg, solvedSlots, centers } from './core.mjs';

const SLOT_NAMES = ['FR', 'FL', 'BL', 'BR'];
const WHOLE_ROTATION = /^[xyz](?:2|')?$/;
const U_TURN = /^U(?:2|')?$/;
const clone = value => Array.isArray(value) ? value.map(clone)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const endsWith = (moves, suffix) => suffix.length <= moves.length && same(moves.slice(moves.length - suffix.length), suffix);
const tokens = value => value == null ? [] : parseAlg(value);

export function createTrace() { return { segments: [], activeId: null }; }

function stateSnapshot(value, name) {
  const result = value == null ? [] : Array.from(value);
  if (result.length !== 54) throw new RangeError(`${name}: ожидаются 54 наклейки.`);
  return result;
}

function displayFamily(family, stage) {
  if (family === 'SKIP') return stage === 'LAST_LAYER' ? 'OLL' : stage;
  if (family === 'PLL' && stage === 'EPLL') return 'EPLL';
  return family;
}

function segmentLabel(family, visibleFamily, newly, before, after, lost, skip, caseId) {
  if (family === 'CROSS') return skip ? 'CROSS · Крест: готов' : 'CROSS · Крест';
  if (family === 'F2L') {
    if (skip) return after.length === 4 ? 'F2L: готово' : 'F2L: пропуск';
    if (!newly.length) return `F2L ${after.length}/4 · без новой пары`;
    const range = lost.length ? String(after.length) : newly.length === 1 ? String(after.length) : `${before.length + 1}–${after.length}`;
    return `F2L ${range}/4 · ${newly.join(', ')}`;
  }
  if (skip) return `${visibleFamily}: пропуск`;
  return `${visibleFamily}${caseId == null || caseId === '' ? '' : ' · ' + caseId}`;
}

function actualParts(candidate, moves, visibleFamily, startMove, label, warnings) {
  let frame = [], finalAuf = [];
  const claimedFrame = tokens(candidate.frameRestoreMoves);
  if (claimedFrame.length) {
    const beforeFrame = moves.slice(0, moves.length - claimedFrame.length);
    const originalMatches = candidate.algorithmMoves == null || same(tokens(candidate.algorithmMoves), beforeFrame);
    if (claimedFrame.every(token => WHOLE_ROTATION.test(token)) && endsWith(moves, claimedFrame) && originalMatches) frame = claimedFrame;
    else warnings.push('Frame-return metadata does not match an explicit whole-rotation suffix; kept inside the algorithm.');
  }
  const sourceEnd = moves.length - frame.length;
  const claimedAuf = tokens(candidate.auf);
  if (['PLL', 'EPLL', 'AUF'].includes(visibleFamily) && claimedAuf.length) {
    if (claimedAuf.every(token => U_TURN.test(token)) && endsWith(moves.slice(0, sourceEnd), claimedAuf)) finalAuf = claimedAuf;
    else warnings.push('Final AUF metadata does not match its explicit suffix; kept inside the algorithm.');
  }
  const algorithmEnd = sourceEnd - finalAuf.length;
  const part = (role, from, to, text) => ({ role, from, to, startMove: startMove + from, endMove: startMove + to, label: text });
  const result = [part('algorithm', 0, algorithmEnd, label)];
  if (finalAuf.length) result.push(part('finalAuf', algorithmEnd, sourceEnd, 'AUF'));
  if (frame.length) result.push(part('returnFrame', sourceEnd, moves.length, 'Возврат ориентации'));
  return result;
}

function pairMarkers(id, family, before, after, newly, endMove) {
  const completed = family === 'CROSS' ? after : family === 'F2L' ? newly : [];
  const shared = family === 'F2L' && newly.length > 1;
  const range = shared ? [before.length + 1, after.length] : null;
  return completed.map((slot, index) => {
    const number = family === 'CROSS' ? index + 1 : after.length;
    const countText = range ? `${range[0]}–${range[1]}` : String(number);
    return {
      id: `${id}:pair:${slot}`, role: 'pair', slot, completed: true,
      atMove: endMove, from: endMove, to: endMove,
      number: shared ? null : number, numberRange: range ? [...range] : [number, number],
      sharedAlgorithm: shared, source: family === 'CROSS' ? 'cross' : 'insertion',
      label: `F2L ${countText}/4 · ${slot}: ${family === 'CROSS' ? 'готова после креста' : shared ? 'готова общей вставкой' : 'готова'}`,
    };
  });
}

/** Record one actually selected segment, never a predicted continuation. */
export function createSegment(candidate, { id, stage, startMove = 0, beforeState, afterState } = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Сегменту нужен уникальный непустой id, в том числе при пропуске.');
  if (!Number.isInteger(startMove) || startMove < 0) throw new RangeError('startMove должен быть неотрицательным индексом хода.');
  const moves = tokens(candidate.moves);
  const before = stateSnapshot(beforeState ?? candidate.baseState, 'beforeState');
  const replayed = Array.from(applyAlg(before, moves));
  const after = stateSnapshot(afterState ?? candidate.state ?? replayed, 'afterState');
  if (!same(after, replayed)) throw new Error('Состояние сегмента не совпадает с его выбранными ходами.');
  const requestStage = String(stage ?? candidate.stage ?? candidate.family ?? 'UNKNOWN').toUpperCase();
  const family = String(candidate.family ?? requestStage).toUpperCase();
  const visibleFamily = displayFamily(family, requestStage);
  const slotsBefore = solvedSlots(before), slotsAfter = solvedSlots(after);
  const newlySlots = slotsAfter.filter(slot => !slotsBefore.includes(slot));
  const lostSlots = slotsBefore.filter(slot => !slotsAfter.includes(slot));
  const skip = Boolean(candidate.skip || family === 'SKIP' || !moves.length);
  const caseId = candidate.caseId ?? null;
  const label = segmentLabel(family, visibleFamily, newlySlots, slotsBefore, slotsAfter, lostSlots, skip, caseId);
  const endMove = startMove + moves.length, warnings = [];
  const route = candidate.route ?? null;
  const branchAfter = candidate.branchAfter ?? (family === 'EOLL' ? route === 'EOLL → PLL' ? 'PLL' : 'COLL' : family === 'COLL' ? 'EPLL' : null);
  return {
    id, stage: requestStage, requestStage, family, displayFamily: visibleFamily,
    candidateId: candidate.id ?? null, caseId, label, startMove, endMove, moves,
    slotsBefore: [...slotsBefore], slotsAfter: [...slotsAfter], newlySlots, lostSlots,
    pairMarkers: pairMarkers(id, family, slotsBefore, slotsAfter, newlySlots, endMove),
    parts: actualParts(candidate, moves, visibleFamily, startMove, label, warnings),
    skip, frameColor: centers(after)[3], branchAfter, route,
    epll: Boolean(candidate.epll || requestStage === 'EPLL'),
    beforeState: before, afterState: after, metadataWarnings: warnings,
  };
}

/** Append only after a selected prefix. A rechoice restores its prefix first. */
export function appendSegment(trace, segment) {
  const segments = trace?.segments ?? [];
  if (segments.some(existing => existing.id === segment.id)) throw new Error('Повторяющийся id сегмента: ' + segment.id);
  const expected = segments.length ? segments[segments.length - 1].endMove : 0;
  if (segment.startMove !== expected || segment.endMove !== segment.startMove + segment.moves.length) {
    throw new RangeError('Сегмент должен продолжать выбранный префикс без пропусков и перекрытий.');
  }
  return { segments: [...segments.map(clone), clone(segment)], activeId: segment.id };
}

export function traceMoves(trace) { return (trace?.segments ?? []).flatMap(segment => [...segment.moves]); }

/**
 * moveIndex is the global index of the move to execute again after Back. Keep
 * its entire selected segment; later decisions (including zero-move skips)
 * disappear. Returning to a boundary never mixes queues from two stages.
 */
export function rewindTrace(trace, moveIndex) {
  const segments = trace?.segments ?? [];
  const total = segments.length ? segments[segments.length - 1].endMove : 0;
  if (!Number.isInteger(moveIndex) || moveIndex < 0 || moveIndex > total) throw new RangeError('Неверный индекс возврата в истории ходов.');
  let index = segments.findIndex(segment => segment.moves.length && segment.startMove <= moveIndex && moveIndex < segment.endMove);
  if (index < 0 && moveIndex === total) {
    for (let at = segments.length - 1; at >= 0; at--) if (segments[at].moves.length) { index = at; break; }
  }
  if (index < 0) return { trace: createTrace(), segment: null, offset: 0, queue: [] };
  const kept = segments.slice(0, index + 1).map(clone);
  const segment = kept[kept.length - 1], offset = moveIndex - segment.startMove;
  return { trace: { segments: kept, activeId: segment.id }, segment, offset, queue: segment.moves.slice(offset) };
}

/** Human-readable copy. Plain notation remains setupMoves + traceMoves(trace). */
export function stageCopy(trace, { setupMoves = [] } = {}) {
  const lines = [], setup = tokens(setupMoves);
  if (setup.length) lines.push(`[Ориентация: ${setup.join(' ')}]`);
  for (const segment of trace?.segments ?? []) {
    const blocks = [];
    for (const part of segment.parts) {
      const text = segment.moves.slice(part.from, part.to).join(' ');
      if (part.role === 'algorithm') blocks.push(text ? `[${segment.label}${segment.skip ? '; ' : ': '}${text}]` : `[${segment.label}]`);
      else if (text) blocks.push(`[${part.label}: ${text}]`);
    }
    lines.push(blocks.join(' '));
    if (segment.family === 'CROSS') for (const marker of segment.pairMarkers) lines.push(`[${marker.label}]`);
  }
  return lines.join('\n');
}

export { SLOT_NAMES as TRACE_SLOT_NAMES };
