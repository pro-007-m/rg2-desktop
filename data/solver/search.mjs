import { SOLVED, applyAlg, analyze, isCross, isF2L, solvedSlots, stateKey } from './core.mjs';

// Search only stage goals. No full-cube solution is used as a hidden setup.
const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const TURNS = ['', "'", '2'];
const MOVES = FACES.flatMap(face => TURNS.map(turn => face + turn));
const AXIS = [0, 1, 2, 0, 1, 2];
const SLOTS = ['FR', 'FL', 'BL', 'BR'];
const CROSS_CAPACITY = 24 ** 4;
const UNKNOWN = 255;
let model;
let crossTable;
const pairTables = new Map();

function clock() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function limit(value, fallback, minimum = 0) {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

function effectFor(moves) {
  const effect = analyze(applyAlg(SOLVED, moves));
  const edge = new Uint8Array(24);
  const corner = new Uint8Array(24);
  for (let destination = 0; destination < 12; destination++) {
    const source = effect.ep[destination];
    for (let orientation = 0; orientation < 2; orientation++) {
      edge[source * 2 + orientation] = destination * 2 + (orientation ^ effect.eo[destination]);
    }
  }
  for (let destination = 0; destination < 8; destination++) {
    const source = effect.cp[destination];
    for (let orientation = 0; orientation < 3; orientation++) {
      corner[source * 3 + orientation] = destination * 3 + (orientation + effect.co[destination]) % 3;
    }
  }
  const pair = new Uint16Array(576);
  for (let c = 0; c < 24; c++) for (let e = 0; e < 24; e++) pair[c * 24 + e] = corner[c] * 24 + edge[e];
  return { edge, corner, pair };
}

function getModel() {
  if (model) return model;
  const moves = MOVES.map(token => ({ token, ...effectFor([token]) }));
  const actions = ['U', "U'", 'U2'].map(token => ({
    id: token, moves: [token], cost: 1, slot: -1, ...effectFor([token]),
  }));
  // Every trigger touches exactly one F2L slot, while restoring the D cross.
  const openings = [['R', "F'"], ["L'", 'F'], ['L', "B'"], ["R'", 'B']];
  for (let slot = 0; slot < 4; slot++) {
    for (const opening of openings[slot]) {
      const closing = opening.endsWith("'") ? opening.slice(0, -1) : opening + "'";
      for (const upper of ['U', "U'", 'U2']) {
        const tokens = [opening, upper, closing];
        const result = applyAlg(SOLVED, tokens);
        const untouched = solvedSlots(result);
        if (!isCross(result) || SLOTS.some((name, index) => index !== slot && !untouched.includes(name))) {
          throw new Error('Invalid F2L trigger boundary: ' + tokens.join(' '));
        }
        actions.push({ id: tokens.join(' '), moves: tokens, cost: 3, slot, ...effectFor(tokens) });
      }
    }
  }
  model = { moves, actions };
  return model;
}

function crossCodes(state) {
  const cube = analyze(state);
  const codes = new Uint8Array(4);
  for (let position = 0; position < 12; position++) {
    const piece = cube.ep[position];
    if (piece >= 4 && piece <= 7) codes[piece - 4] = position * 2 + cube.eo[position];
  }
  return codes;
}
function crossIndex(a, b, c, d) { return a + 24 * b + 576 * c + 13824 * d; }

/** Exact HTM distances for the four D-cross edges. Built once per worker. */
export function buildCrossTable() {
  if (crossTable) return crossTable;
  const started = clock();
  const transitions = getModel().moves.map(move => move.edge);
  const distances = new Uint8Array(CROSS_CAPACITY);
  distances.fill(UNKNOWN);
  const queue = new Uint32Array(190080);
  const goal = crossIndex(8, 10, 12, 14);
  distances[goal] = 0;
  queue[0] = goal;
  let head = 0, tail = 1, maximum = 0;
  while (head < tail) {
    let value = queue[head++];
    const original = value;
    const a = value % 24; value = (value / 24) | 0;
    const b = value % 24; value = (value / 24) | 0;
    const c = value % 24, d = (value / 24) | 0;
    const nextDistance = distances[original] + 1;
    for (const transition of transitions) {
      const next = crossIndex(transition[a], transition[b], transition[c], transition[d]);
      if (distances[next] !== UNKNOWN) continue;
      distances[next] = nextDistance;
      maximum = Math.max(maximum, nextDistance);
      if (tail >= queue.length) throw new Error('Cross coordinate inventory overflow');
      queue[tail++] = next;
    }
  }
  if (tail !== 190080 || maximum !== 8) throw new Error(`Cross PDB invariant failed: ${tail} states, maximum ${maximum}`);
  crossTable = {
    distances, reachable: tail, count: tail, capacity: CROSS_CAPACITY,
    maxDepth: maximum, maxDistance: maximum, buildMillis: clock() - started,
    metric: 'HTM', crossFace: 'D',
    coverage: { reachableStates: tail, coordinateCapacity: CROSS_CAPACITY, maximumDistance: maximum, exhaustive: true, metric: 'HTM' },
    distance(state) {
      const [a, b, c, d] = crossCodes(state);
      return distances[crossIndex(a, b, c, d)];
    },
  };
  return crossTable;
}

function makeBudget(options, defaults) {
  const started = clock();
  const maxNodes = limit(options.maxNodes ?? options.budget?.maxNodes, defaults.nodes, 1);
  const maxMillis = limit(options.maxMillis ?? options.budget?.maxMillis, defaults.millis, 1);
  let nodes = 0, stopReason = '';
  return {
    started, maxNodes, maxMillis,
    visit() {
      nodes++;
      if (nodes > maxNodes) { stopReason = 'node-budget'; return false; }
      if ((nodes & 255) === 1 && !this.active()) return false;
      return true;
    },
    active() {
      if (stopReason) return false;
      if (options.signal?.aborted || options.isCancelled?.()) { stopReason = 'cancelled'; return false; }
      if (clock() - started >= maxMillis) { stopReason = 'time-budget'; return false; }
      return true;
    },
    stop(reason) { if (!stopReason) stopReason = reason; },
    get nodes() { return nodes; },
    get reason() { return stopReason; },
    elapsed() { return clock() - started; },
  };
}

/** Enumerate short D-cross solutions, with an exact shortest-distance proof. */
export function searchCross(state, options = {}) {
  const table = buildCrossTable();
  const budget = makeBudget(options, { nodes: 300000, millis: 2200 });
  const maxCandidates = limit(options.maxCandidates ?? options.candidateLimit ?? options.budget?.candidatePageSize, 24, 1);
  const extraDepth = limit(options.extraDepth ?? options.nearDepth, 1);
  const minimum = table.distance(state);
  if (minimum === UNKNOWN) throw new Error('Invalid four-edge cross coordinate');
  const maxDepth = Math.min(12, limit(options.maxDepth ?? options.budget?.maxDepth, minimum + extraDepth));
  const baseStateHash = stateKey(state);
  const candidates = [], path = [], seen = new Set();
  const moveModels = getModel().moves;
  let completedDepth = minimum - 1;
  function addCandidate() {
    const tokens = path.map(index => MOVES[index]);
    const key = tokens.join(' ');
    if (seen.has(key)) return;
    const result = applyAlg(state, tokens);
    if (!isCross(result)) throw new Error('Cross candidate verification failed');
    seen.add(key);
    candidates.push({
      id: 'cross:' + (key || 'skip'), family: 'CROSS', origin: tokens.length ? 'search' : 'skip',
      moves: tokens, state: Array.from(result), htm: tokens.length,
      claim: tokens.length === minimum ? 'optimal-cross-htm' : 'best-found',
      lowerBound: minimum, optimalHTM: minimum, baseStateHash, verified: true,
      xCrossSlots: solvedSlots(result),
    });
  }
  function dfs(a, b, c, d, remaining, lastFace) {
    if (!budget.visit()) return false;
    const distance = table.distances[crossIndex(a, b, c, d)];
    if (distance > remaining) return true;
    if (remaining === 0) {
      if (distance === 0) addCandidate();
      if (candidates.length >= maxCandidates) { budget.stop('candidate-limit'); return false; }
      return true;
    }
    for (let index = 0; index < 18; index++) {
      const face = (index / 3) | 0;
      if (face === lastFace) continue;
      // Opposite-face moves commute; keep one ordering of those sequences.
      if (lastFace >= 0 && AXIS[face] === AXIS[lastFace] && face < lastFace) continue;
      const transition = moveModels[index].edge;
      path.push(index);
      if (!dfs(transition[a], transition[b], transition[c], transition[d], remaining - 1, face)) { path.pop(); return false; }
      path.pop();
    }
    return true;
  }
  if (minimum === 0) {
    addCandidate(); completedDepth = 0;
  } else {
    const [a, b, c, d] = crossCodes(state);
    for (let depth = minimum; depth <= maxDepth && budget.active(); depth++) {
      if (!dfs(a, b, c, d, depth, -1)) break;
      completedDepth = depth;
    }
  }
  candidates.sort((a, b) => a.htm - b.htm || b.xCrossSlots.length - a.xCrossSlots.length || a.id.localeCompare(b.id));
  return {
    candidates,
    coverage: {
      visitedNodes: budget.nodes, completedDepth,
      exhaustedDeclaredDomain: minimum === 0 || (!budget.reason && completedDepth >= maxDepth),
      minimumHTM: minimum, lowerBound: minimum, requestedMaxDepth: maxDepth,
      stopReason: budget.reason || (maxDepth < minimum ? 'depth-bound' : 'complete'),
      elapsedMillis: budget.elapsed(), metric: 'HTM',
      domain: 'Outer-face reduced sequences; one ordering of commuting opposite faces.',
      pdbStates: table.reachable, pdbMaximum: table.maxDepth,
    },
  };
}

function slotMask(names) { return names.reduce((mask, name) => mask | (1 << SLOTS.indexOf(name)), 0) & 15; }
function pairCoordinate(cube, slot) {
  const corner = cube.cp.indexOf(slot + 4), edge = cube.ep.indexOf(slot + 8);
  if (corner < 0 || edge < 0) throw new Error('Missing F2L pair');
  return (corner * 3 + cube.co[corner]) * 24 + edge * 2 + cube.eo[edge];
}

function pairTable(slot, protectedMask) {
  const key = `${slot}:${protectedMask}`;
  if (pairTables.has(key)) return pairTables.get(key);
  const actions = getModel().actions.filter(action => action.slot < 0 || !(protectedMask & (1 << action.slot)));
  const goal = (slot + 4) * 3 * 24 + (slot + 8) * 2;
  const distances = new Uint8Array(576); distances.fill(UNKNOWN); distances[goal] = 0;
  const buckets = [[goal]];
  let remaining = 1, reached = 1, maximum = 0;
  for (let distance = 0; remaining; distance++) {
    const bucket = buckets[distance];
    if (!bucket) continue;
    while (bucket.length) {
      const coordinate = bucket.pop(); remaining--;
      if (distances[coordinate] !== distance) continue;
      maximum = Math.max(maximum, distance);
      for (const action of actions) {
        const next = action.pair[coordinate], nextDistance = distance + action.cost;
        if (nextDistance >= distances[next]) continue;
        if (distances[next] === UNKNOWN) reached++;
        distances[next] = nextDistance;
        (buckets[nextDistance] ||= []).push(next); remaining++;
      }
    }
  }
  const table = { goal, distances, actions, reached, maximum, slot, protectedMask };
  pairTables.set(key, table);
  return table;
}

function canonicalPairPath(table, coordinate) {
  if (table.distances[coordinate] === UNKNOWN) return null;
  const path = [];
  while (coordinate !== table.goal) {
    const action = table.actions.find(action => table.distances[action.pair[coordinate]] + action.cost === table.distances[coordinate]);
    if (!action) throw new Error('F2L pattern reconstruction failed');
    path.push(...action.moves); coordinate = action.pair[coordinate];
  }
  return path;
}

function reduceMoves(tokens) {
  const result = [];
  const amount = token => token.endsWith('2') ? 2 : token.endsWith("'") ? 3 : 1;
  for (const token of tokens) {
    if (result.length && result[result.length - 1][0] === token[0]) {
      const previous = result.pop();
      const value = (amount(previous) + amount(token)) % 4;
      if (value) result.push(token[0] + (value === 2 ? '2' : value === 3 ? "'" : ''));
    } else result.push(token);
  }
  return result;
}

function pairBoundary(state, previous, target) {
  const after = solvedSlots(state);
  return isCross(state) && after.includes(target) && previous.every(slot => after.includes(slot));
}

// Compare remaining slot orders using one shortest macro path per insertion.
// This is a bounded continuation estimate, not a global F2L optimality proof.
function continuation(state, budget, memo = new Map()) {
  const before = solvedSlots(state);
  if (before.length === 4) return { moves: [], htm: 0 };
  if (!budget.active()) return null;
  const key = stateKey(state);
  if (memo.has(key)) return memo.get(key);
  const cube = analyze(state), protectedMask = slotMask(before);
  let best = null;
  for (let slot = 0; slot < 4; slot++) {
    if (protectedMask & (1 << slot)) continue;
    if (!budget.visit()) break;
    const table = pairTable(slot, protectedMask);
    const moves = canonicalPairPath(table, pairCoordinate(cube, slot));
    if (!moves) continue;
    const result = applyAlg(state, moves);
    if (!pairBoundary(result, before, SLOTS[slot])) throw new Error('F2L continuation boundary failed');
    const rest = continuation(result, budget, memo);
    if (!rest) continue;
    const full = reduceMoves([...moves, ...rest.moves]);
    if (!best || full.length < best.htm) best = { moves: full, htm: full.length };
  }
  memo.set(key, best);
  return best;
}

/**
 * Return verified next-pair F2L segments. U turns and slot-specific triggers
 * restore the cross and protected slots at macro/segment boundaries. The
 * corner-edge pattern table makes buried pieces solvable without a full-cube
 * solver or a finite hand-picked case library.
 */
export function searchF2L(state, options = {}) {
  if (!isCross(state)) return {
    candidates: [], coverage: { visitedNodes: 0, completedDepth: 0, exhaustedDeclaredDomain: false, stopReason: 'cross-required', domain: 'F2L with completed D cross' },
  };
  const budget = makeBudget(options, { nodes: 40000, millis: 2400 });
  const maxCandidates = limit(options.maxCandidates ?? options.candidateLimit ?? options.budget?.candidatePageSize, 20, 1);
  const maxDepth = limit(options.maxDepth ?? options.budget?.maxDepth, 18);
  const extraDepth = Math.min(6, limit(options.extraDepth ?? options.nearDepth, 2));
  const before = solvedSlots(state), protectedMask = slotMask(before);
  const baseStateHash = stateKey(state);
  if (isF2L(state)) return {
    candidates: [{ id: 'f2l:skip', moves: [], state: Array.from(state), htm: 0, family: 'F2L', origin: 'skip', claim: 'best-found', baseStateHash, verified: true, solvedBefore: before, solvedAfter: before, continuationHTM: 0 }],
    coverage: { visitedNodes: 0, completedDepth: 0, exhaustedDeclaredDomain: true, stopReason: 'already-solved', domain: 'F2L pair insertion macros' },
  };
  const cube = analyze(state);
  const selectedSlot = options.targetSlot ?? options.slot;
  const targetNames = options.targetSlots || (selectedSlot ? [selectedSlot] : SLOTS);
  const targets = SLOTS.map((name, slot) => ({ name, slot })).filter(({ name, slot }) => targetNames.includes(name) && !(protectedMask & (1 << slot)));
  const candidates = [], seen = new Set(), tableCoverage = [];
  function addCandidate(slot, tokens, table, macroCost) {
    const moves = reduceMoves(tokens);
    const key = `${SLOTS[slot]}:${moves.join(' ')}`;
    if (seen.has(key) || moves.length > maxDepth) return;
    const result = applyAlg(state, moves);
    if (!pairBoundary(result, before, SLOTS[slot])) throw new Error('F2L candidate verification failed');
    seen.add(key);
    const after = solvedSlots(result);
    candidates.push({
      id: 'f2l:' + key, moves, state: Array.from(result), htm: moves.length,
      family: 'F2L', origin: 'search', claim: 'best-found', verified: true, baseStateHash,
      targetSlot: SLOTS[slot], solvedBefore: before, solvedAfter: after,
      newSlots: after.filter(name => !before.includes(name)),
      macroCost, macroMinimum: table.distances[pairCoordinate(cube, slot)],
      searchDomain: 'U turns and slot triggers, preserving previously solved slots at boundaries',
    });
  }
  // First produce a valid canonical segment for every available target, before
  // spending the remainder of the budget on alternatives/continuations.
  for (const { slot, name } of targets) {
    if (!budget.active()) break;
    const table = pairTable(slot, protectedMask);
    const coordinate = pairCoordinate(cube, slot);
    const moves = canonicalPairPath(table, coordinate);
    tableCoverage.push({ slot: name, reachablePairCoordinates: table.reached, minimumMacroCost: table.distances[coordinate], declaredMacroCostBound: Math.min(maxDepth + 6, table.distances[coordinate] + extraDepth) });
    if (!moves) continue;
    addCandidate(slot, moves, table, table.distances[coordinate]);
    if (candidates.length >= maxCandidates) break;
  }

  const perSlotLimit = Math.max(1, Math.ceil(maxCandidates / Math.max(1, targets.length)));
  let completedDepth = 0, allAlternativesComplete = true;
  const completedBounds = [];
  for (const { slot, name } of targets) {
    if (!budget.active() || candidates.length >= maxCandidates) { allAlternativesComplete = false; break; }
    const table = pairTable(slot, protectedMask), start = pairCoordinate(cube, slot);
    const minimum = table.distances[start];
    if (minimum === UNKNOWN) continue;
    const bound = Math.min(maxDepth + 6, minimum + extraDepth);
    const path = [], onPath = new Set([start]);
    let slotFound = candidates.filter(candidate => candidate.targetSlot === name).length;
    function dfs(coordinate, spent, lastAction) {
      if (!budget.visit()) return false;
      if (spent + table.distances[coordinate] > bound) return true;
      if (coordinate === table.goal) {
        const oldLength = candidates.length;
        addCandidate(slot, path.flatMap(action => action.moves), table, spent);
        slotFound += candidates.length - oldLength;
        return slotFound < perSlotLimit && candidates.length < maxCandidates;
      }
      for (const action of table.actions) {
        if (lastAction && action.slot < 0 && lastAction.slot < 0) continue;
        const next = action.pair[coordinate];
        if (onPath.has(next) || spent + action.cost + table.distances[next] > bound) continue;
        path.push(action); onPath.add(next);
        const keepGoing = dfs(next, spent + action.cost, action);
        path.pop(); onPath.delete(next);
        if (!keepGoing) return false;
      }
      return true;
    }
    const complete = dfs(start, 0, null);
    allAlternativesComplete &&= complete;
    if (complete) completedBounds.push(bound);
  }

  if (options.lookahead !== false && budget.active()) {
    const memo = new Map();
    for (const candidate of candidates) {
      const rest = continuation(candidate.state, budget, memo);
      if (rest) {
        candidate.continuationHTM = rest.htm;
        candidate.estimatedTotalHTM = candidate.htm + rest.htm;
        candidate.continuationMoves = rest.moves;
      }
      if (!budget.active()) break;
    }
  }
  candidates.sort((a, b) =>
    (a.estimatedTotalHTM ?? a.htm + 100) - (b.estimatedTotalHTM ?? b.htm + 100)
    || b.newSlots.length - a.newSlots.length || a.htm - b.htm || a.id.localeCompare(b.id));
  // A finished target does not imply the same depth was completed for every
  // other target. Only report a shared completed bound after all targets end.
  completedDepth = allAlternativesComplete && completedBounds.length === targets.length && completedBounds.length
    ? Math.min(...completedBounds) : 0;
  return {
    candidates,
    coverage: {
      visitedNodes: budget.nodes, completedDepth, exhaustedDeclaredDomain: allAlternativesComplete && !budget.reason,
      requestedMaxDepth: maxDepth, extraMacroDepth: extraDepth,
      stopReason: budget.reason || (allAlternativesComplete ? 'complete' : 'candidate-limit'),
      elapsedMillis: budget.elapsed(), domain: 'Simple target-pair coordinate paths in U/slot-trigger macro graph; canonical continuation over remaining slot orders.',
      claim: 'best-found', protectedSlots: before, targetTables: tableCoverage,
    },
  };
}
