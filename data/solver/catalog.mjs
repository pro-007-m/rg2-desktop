/* Functional formula catalogue. All matching uses complete cube effects. */
import {
  SOLVED, parseAlg, invertAlg, applyAlg, analyze, centers, restoreFrameSequence,
  isCross, solvedSlots, isF2L, isOLL, isSolved, areEdgesOriented, areCornersSolved,
} from './core.mjs';

const AUFS = [[], ['U'], ['U2'], ["U'"]];
const YS = [[], ['y'], ['y2'], ["y'"]];
const SLOTS = ['FR', 'FL', 'BL', 'BR'];
const UNIQUE = Uint8Array.from({ length: 54 }, (_, i) => i);
let activeCatalog = null;

const arrayKey = value => Array.from(value).join(',');
const fullKey = value => Array.from(value).join('');
const cornerKey = cubies => arrayKey(cubies.cp.slice(0, 4)) + '/' + arrayKey(cubies.co.slice(0, 4));
const ollKey = cubies => arrayKey(cubies.co.slice(0, 4)) + '/' + arrayKey(cubies.eo.slice(0, 4));
const pllKey = cubies => arrayKey(cubies.cp.slice(0, 4)) + '/' + arrayKey(cubies.ep.slice(0, 4));
const edgeKey = cubies => arrayKey(cubies.eo.slice(0, 4));

function effect(state, permutation) {
  const result = new Uint8Array(54);
  for (let i = 0; i < 54; i++) result[i] = state[permutation[i]];
  return result;
}
function addIndex(index, key, record, auf = 0) {
  let bucket = index.get(key);
  if (!bucket) index.set(key, bucket = []);
  bucket.push({ record, auf });
}
function normalizedMoves(raw) {
  const parsed = parseAlg(raw);
  const end = applyAlg(SOLVED, parsed);
  return [...parsed, ...restoreFrameSequence(end, SOLVED)];
}
function sourceKey(source) {
  return [source.name, source.url, source.alternativeId, source.orientation, source.label].join('|');
}
function pairKey(cubies, slot) {
  const corner = cubies.cp.indexOf(slot + 4), edge = cubies.ep.indexOf(slot + 8);
  if (corner < 0 || edge < 0) return null;
  return `${slot}/${corner},${cubies.co[corner]}/${edge},${cubies.eo[edge]}`;
}
function metricProfile(profile) {
  if (typeof profile === 'string') return { metric: profile.toLowerCase() };
  return profile || {};
}
export function moveMetrics(algorithm, profile = {}) {
  const tokens = typeof algorithm === 'string' ? parseAlg(algorithm) : algorithm;
  const settings = metricProfile(profile);
  let htm = 0, qtm = 0, rotations = 0, slices = 0, wide = 0, score = 0;
  let previousBase = '';
  for (const token of tokens) {
    const base = token.replace(/[2']/g, ''), double = token.includes('2');
    const rotation = /^[xyz]$/.test(base), slice = /^[MES]$/.test(base), isWide = /w$/.test(base);
    if (rotation) rotations++;
    else { htm += slice ? 2 : 1; qtm += (slice ? 2 : 1) * (double ? 2 : 1); }
    if (slice) slices++;
    if (isWide) wide++;
    const face = base[0];
    let weight = rotation ? 1.65 : slice ? (face === 'M' ? 1.25 : 1.48) : /[BD]/.test(face) ? 1.28 : face === 'F' ? 1.12 : face === 'L' ? 1.07 : 1;
    if (isWide) weight *= 1.1;
    if (double) weight *= rotation ? 1.1 : 1.42;
    if (token.endsWith("'")) weight *= 1.025;
    // A transparent execution estimate, not a measurement in seconds. Profile
    // weights can be calibrated later without changing the imported formula.
    if (previousBase && base !== previousBase && /[BLD]/.test(face)) weight += 0.07;
    const custom = settings.weights && (settings.weights[base] ?? settings.weights[rotation ? 'rotation' : slice ? 'slice' : isWide ? 'wide' : 'outer']);
    score += custom == null ? weight : Number(custom) * (double ? 1.42 : 1);
    previousBase = base;
  }
  const metric = String(settings.metric || 'execution').toLowerCase();
  const selected = metric === 'htm' || metric === 'minimum-htm' ? htm : metric === 'qtm' ? qtm : score;
  return { htm, qtm, rotations, slices, wide, score: Math.round(selected * 10000) / 10000,
    metric, metricDefinition: 'HTM: outer/wide=1, slice=2, whole-cube rotations counted separately; QTM counts half turns twice.' };
}
export function costScore(algorithm, profile = {}) { return moveMetrics(algorithm, profile).score; }

export function compileCatalog(data, options = {}) {
  if (!data || !Array.isArray(data.records)) throw new TypeError('Algorithm catalogue must contain records.');
  const compiled = { version: data.version || 'unknown', importedOn: data.importedOn,
    records: [], rejected: [], sourceCoverage: data.coverage || {},
    indices: { OLL: new Map(), COLL: new Map(), PLL: new Map(), F2L: new Map() },
    continuationCache: new Map(), bestContinuationCache: new Map(), coverage: {} };
  const grouped = new Map();
  for (const raw of data.records) {
    try {
      if (!['F2L', 'OLL', 'COLL', 'PLL'].includes(raw.family)) throw new Error('Unsupported family');
      const moves = normalizedMoves(raw.rawAlg ?? raw.algorithm ?? raw.moves);
      if (!moves.length || moves.length > 150) throw new Error('Empty or excessive sequence');
      const inverseState = applyAlg(SOLVED, invertAlg(moves));
      const cubies = analyze(inverseState);
      const preservedSlots = solvedSlots(inverseState);
      if (raw.family === 'F2L') {
        if (!isCross(inverseState) || preservedSlots.length !== 3) throw new Error('F2L insertion must preserve cross and exactly three other slots');
      } else {
        if (!isF2L(inverseState)) throw new Error('Last-layer algorithm does not preserve F2L');
        if (raw.family === 'PLL' && !isOLL(inverseState)) throw new Error('PLL algorithm changes last-layer orientation');
        if (raw.family === 'COLL' && !areEdgesOriented(inverseState)) throw new Error('COLL algorithm changes edge orientation');
        if (raw.family === 'OLL' && isOLL(inverseState)) throw new Error('OLL source occurrence has no orientation case');
      }
      const key = raw.family + '|' + moves.join(' ');
      const previous = grouped.get(key);
      if (previous) {
        previous.sourceRecords.push({ id: raw.id, title: raw.title, caseId: raw.caseId, rawAlg: raw.rawAlg, source: raw.source });
        if (raw.source && !previous.sources.some(source => sourceKey(source) === sourceKey(raw.source))) previous.sources.push(raw.source);
        continue;
      }
      const targetSlot = raw.family === 'F2L' ? SLOTS.findIndex(slot => !preservedSlots.includes(slot)) : null;
      const record = { id: raw.id || `algorithm-${compiled.records.length}`, family: raw.family,
        caseId: raw.caseId, title: raw.title || `${raw.family} ${raw.caseId || ''}`, rawAlg: raw.rawAlg,
        source: raw.source || null, sources: raw.source ? [raw.source] : [],
        sourceRecords: [{ id: raw.id, title: raw.title, caseId: raw.caseId, rawAlg: raw.rawAlg, source: raw.source }],
        moves, inverseState, permutation: applyAlg(UNIQUE, moves), cubies,
        preservedSlots, targetSlot, signature: raw.family === 'OLL' ? ollKey(cubies) : raw.family === 'PLL' ? pllKey(cubies) : raw.family === 'COLL' ? cornerKey(cubies) : pairKey(cubies, targetSlot),
        verified: true, verification: { crossPreserved: true, f2lPreserved: raw.family !== 'F2L', edgesOriented: areEdgesOriented(inverseState), frameRestored: true } };
      grouped.set(key, record); compiled.records.push(record);
    } catch (error) {
      compiled.rejected.push({ id: raw.id, family: raw.family, title: raw.title, rawAlg: raw.rawAlg, source: raw.source, reason: error.message });
    }
  }
  for (const record of compiled.records) {
    if (record.family === 'OLL' || record.family === 'F2L') {
      addIndex(compiled.indices[record.family], record.signature, record);
    } else {
      for (let auf = 0; auf < 4; auf++) {
        const input = applyAlg(applyAlg(SOLVED, AUFS[auf]), invertAlg(record.moves));
        const cubies = analyze(input);
        addIndex(compiled.indices[record.family], record.family === 'PLL' ? pllKey(cubies) : cornerKey(cubies), record, auf);
      }
    }
  }
  for (const family of ['F2L', 'OLL', 'COLL', 'PLL']) {
    const records = compiled.records.filter(record => record.family === family);
    const sourceCases = new Set(records.flatMap(record => record.sourceRecords.filter(source => source.source?.name === 'SpeedCubeDB').map(source => source.caseId)));
    compiled.coverage[family] = { verifiedVariants: records.length, indexedSignatures: compiled.indices[family].size,
      sourceCaseCount: sourceCases.size, sourceCaseIds: [...sourceCases].sort(),
      rejectedOccurrences: compiled.rejected.filter(record => record.family === family).length };
  }
  // A finite, explicit EOLL preparation library. These are standard short edge-
  // orientation sequences, looked up in the imported records rather than passed
  // off as a complete catalogue of every possible preparation sequence.
  const prepStrings = ["F R U R' U' F'", "F U R U' R' F'", "Fw R U R' U' Fw'"];
  compiled.eollPreparations = [];
  for (const text of prepStrings) {
    const moves = parseAlg(text), key = moves.join(' ');
    const sourceRecord = compiled.records.find(record => record.family === 'OLL' && record.moves.join(' ') === key);
    if (sourceRecord) compiled.eollPreparations.push({ ...sourceRecord, id: 'eoll-' + sourceRecord.id, family: 'EOLL' });
  }
  if (options.setActive !== false) activeCatalog = compiled;
  return compiled;
}

export async function loadCatalog(url = new URL('./algorithm-data.json', import.meta.url), options = {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Cannot load local algorithm catalogue.');
  return compileCatalog(await response.json(), options);
}
function resolveCatalog(options) {
  const catalog = options.catalog || activeCatalog;
  if (!catalog || !catalog.indices) throw new Error('Call compileCatalog or loadCatalog before matching algorithms.');
  return catalog;
}
function compareCandidates(a, b, preferColl = false) {
  return (a.totalCost ?? a.cost) - (b.totalCost ?? b.cost) ||
    (preferColl ? Number(b.family === 'COLL') - Number(a.family === 'COLL') : 0) || a.htm - b.htm || a.rotations - b.rotations || a.id.localeCompare(b.id);
}
function resultCandidate(record, moves, state, options, suffix, extras = {}) {
  const metrics = moveMetrics(moves, options.profile);
  return { id: record.id + suffix, recordId: record.id, family: record.family, caseId: record.caseId,
    title: record.title, rawAlg: record.rawAlg, source: record.source, sources: [...record.sources],
    sourceRecords: record.sourceRecords, moves, state, cost: metrics.score, score: metrics.score,
    ...metrics, totalCost: metrics.score, recommendationScore: metrics.score, verified: true, ...extras };
}
function addUnique(map, candidate) {
  // Never deduplicate by an OLL mask or resulting EO/CO signature. Full move
  // sequences remain separate even when their edge permutations differ only at
  // the next stage. Exact duplicate sequences group all source attributions.
  const key = candidate.family + '|' + candidate.moves.join(' ');
  const previous = map.get(key);
  if (!previous) { map.set(key, candidate); return; }
  for (const source of candidate.sources || []) if (!(previous.sources || []).some(existing => sourceKey(existing) === sourceKey(source))) (previous.sources ||= []).push(source);
}
function alignedStates(state) {
  const result = [];
  for (let y = 0; y < 4; y++) {
    const rotated = applyAlg(state, YS[y]);
    for (let u = 0; u < 4; u++) {
      const prepared = applyAlg(rotated, AUFS[u]);
      result.push({ state: prepared, cubies: analyze(prepared), setup: [...YS[y], ...AUFS[u]], frameBack: invertAlg(YS[y]), y, u });
    }
  }
  return result;
}

export function matchPLL(state, options = {}) {
  const catalog = resolveCatalog(options), candidates = new Map();
  if (!isOLL(state)) return [];
  for (const aligned of alignedStates(state)) {
    for (const { record, auf } of catalog.indices.PLL.get(pllKey(aligned.cubies)) || []) {
      let end = effect(aligned.state, record.permutation);
      const finalAuf = invertAlg(AUFS[auf]);
      const tail = [...aligned.frameBack, ...finalAuf];
      end = applyAlg(end, tail);
      if (!isSolved(end)) continue;
      const moves = [...aligned.setup, ...record.moves, ...tail];
      addUnique(candidates, resultCandidate(record, moves, end, options, `@${aligned.y},${aligned.u},${auf}`, { setup: aligned.setup, auf: finalAuf, stage: 'PLL', epll: ['Ua', 'Ub', 'H', 'Z'].includes(record.caseId), frameRestoration: aligned.frameBack }));
    }
  }
  // Pure AUF and solved-cube skips are useful finite candidates as well.
  for (let auf = 0; auf < 4; auf++) {
    const end = applyAlg(state, AUFS[auf]);
    if (isSolved(end)) {
      const metrics = moveMetrics(AUFS[auf], options.profile);
      addUnique(candidates, { id: 'pll-skip-' + auf, family: 'SKIP', title: auf ? 'PLL skip · AUF' : 'PLL skip', moves: AUFS[auf], state: end, source: null, sources: [], ...metrics, cost: metrics.score, totalCost: metrics.score, recommendationScore: metrics.score, verified: true, skip: true, stage: 'PLL', auf: AUFS[auf], epll: true });
    }
  }
  return [...candidates.values()].sort((a, b) => compareCandidates(a, b));
}
function bestPLL(state, options) {
  const catalog = resolveCatalog(options);
  const key = fullKey(state) + '|' + JSON.stringify(options.profile || {});
  if (catalog.continuationCache.has(key)) return catalog.continuationCache.get(key);
  let best = null;
  const consider = candidate => { if (!best || compareCandidates(candidate, best) < 0) best = candidate; };
  if (isOLL(state)) {
    for (let auf = 0; auf < 4; auf++) {
      const end = applyAlg(state, AUFS[auf]);
      if (isSolved(end)) {
        const metrics = moveMetrics(AUFS[auf], options.profile);
        consider({ id: 'pll-skip-' + auf, family: 'SKIP', title: auf ? 'PLL skip · AUF' : 'PLL skip', moves: AUFS[auf], state: end, ...metrics, cost: metrics.score, source: null, sources: [], epll: true, skip: true });
      }
    }
    if (!best || best.cost > 0) for (const aligned of alignedStates(state)) {
      for (const { record, auf } of catalog.indices.PLL.get(pllKey(aligned.cubies)) || []) {
        const tail = [...aligned.frameBack, ...invertAlg(AUFS[auf])];
        const moves = [...aligned.setup, ...record.moves, ...tail];
        const metrics = moveMetrics(moves, options.profile);
        if (best && metrics.score > best.cost) continue;
        const end = applyAlg(effect(aligned.state, record.permutation), tail);
        if (!isSolved(end)) continue;
        consider({ id: record.id + `@${aligned.y},${aligned.u},${auf}`, family: record.family, title: record.title, caseId: record.caseId,
          moves, state: end, ...metrics, cost: metrics.score, source: record.source, sources: record.sources,
          epll: ['Ua', 'Ub', 'H', 'Z'].includes(record.caseId), skip: false });
      }
    }
  }
  const result = best ? { id: best.id, family: best.family, title: best.title, caseId: best.caseId, moves: best.moves, cost: best.cost, htm: best.htm, qtm: best.qtm, rotations: best.rotations, source: best.source, sources: best.sources, epll: best.epll, skip: best.skip || false } : null;
  catalog.continuationCache.set(key, result);
  if (catalog.continuationCache.size > 768) catalog.continuationCache.delete(catalog.continuationCache.keys().next().value);
  return result;
}
function withContinuation(candidate, options) {
  const continuation = bestPLL(candidate.state, options);
  if (!continuation) return null;
  return { ...candidate, expectedPll: continuation, totalCost: candidate.cost + continuation.cost,
    recommendationScore: candidate.cost + continuation.cost, totalHtm: candidate.htm + continuation.htm,
    totalQtm: candidate.qtm + continuation.qtm, totalRotations: candidate.rotations + continuation.rotations };
}

function matchOrientationStage(state, family, options) {
  const catalog = resolveCatalog(options), candidates = new Map();
  if (!isF2L(state) || (family === 'COLL' && !areEdgesOriented(state))) return [];
  for (const aligned of alignedStates(state)) {
    const key = family === 'OLL' ? ollKey(aligned.cubies) : cornerKey(aligned.cubies);
    for (const { record, auf } of catalog.indices[family].get(key) || []) {
      let end = effect(aligned.state, record.permutation);
      const finalAuf = family === 'COLL' ? invertAlg(AUFS[auf]) : [];
      const tail = [...aligned.frameBack, ...finalAuf];
      end = applyAlg(end, tail);
      if (!isF2L(end) || !isOLL(end) || (family === 'COLL' && (!areEdgesOriented(end) || !areCornersSolved(end)))) continue;
      const moves = [...aligned.setup, ...record.moves, ...tail];
      const own = resultCandidate(record, moves, end, options, `@${aligned.y},${aligned.u},${auf}`, { setup: aligned.setup, auf: finalAuf, stage: 'LAST_LAYER', frameRestoration: aligned.frameBack });
      const candidate = options._withoutContinuation ? own : withContinuation(own, options);
      if (candidate) addUnique(candidates, candidate);
    }
  }
  return [...candidates.values()];
}

function eollCandidates(state, options) {
  const catalog = resolveCatalog(options), result = new Map();
  if (areEdgesOriented(state)) return [];
  // One preparation solves line/elbow EO; the finite two-step expansion covers
  // dot cases too. The optional branch is identified as EOLL, never mislabeled
  // as a single COLL for an input with flipped edges.
  const firstSteps = [];
  for (const aligned of alignedStates(state)) {
    for (const prep of catalog.eollPreparations) {
      const moves = [...aligned.setup, ...prep.moves, ...aligned.frameBack];
      const end = applyAlg(effect(aligned.state, prep.permutation), aligned.frameBack);
      if (!isF2L(end)) continue;
      const candidate = resultCandidate(prep, moves, end, options, `@${aligned.y},${aligned.u}`, { stage: 'EOLL', setup: aligned.setup });
      if (areEdgesOriented(end)) addUnique(result, candidate);
      else firstSteps.push(candidate);
    }
  }
  if (!result.size) {
    for (const first of firstSteps) {
      for (const aligned of alignedStates(first.state)) for (const prep of catalog.eollPreparations) {
        const tail = [...aligned.setup, ...prep.moves, ...aligned.frameBack];
        const end = applyAlg(effect(aligned.state, prep.permutation), aligned.frameBack);
        if (!isF2L(end) || !areEdgesOriented(end)) continue;
        addUnique(result, resultCandidate(prep, [...first.moves, ...tail], end, options, '@two-' + first.id + '-' + aligned.y + aligned.u, { family: 'EOLL', title: 'EOLL → COLL · подготовка рёбер', stage: 'EOLL', sources: [...first.sources, ...prep.sources] }));
      }
    }
  }
  const withPlans = [];
  for (const prep of result.values()) {
    const next = bestContinuation(prep.state, { ...options, allowEollPrep: false, onlyColl: true });
    if (next) withPlans.push({ ...prep, nextColl: { id: next.id, title: next.title, moves: next.moves, cost: next.cost },
      expectedPll: next.expectedPll, totalCost: prep.cost + next.totalCost, recommendationScore: prep.cost + next.totalCost,
      route: next.family === 'SKIP' && !areCornersSolved(prep.state) ? 'EOLL → PLL' : 'EOLL → COLL → EPLL',
      preparationLibrary: 'Three imported standard short EOLL sequences, one/two-step finite preparation search' });
  }
  return withPlans;
}

export function matchLastLayer(state, options = {}) {
  resolveCatalog(options);
  if (!isF2L(state)) return [];
  const candidates = new Map();
  if (isOLL(state)) {
    const metrics = moveMetrics([], options.profile), continuation = bestPLL(state, options);
    if (continuation) addUnique(candidates, { id: 'oll-skip', family: 'SKIP', title: 'OLL skip', moves: [], state: Uint8Array.from(state), source: null, sources: [], ...metrics, cost: 0, totalCost: continuation.cost, recommendationScore: continuation.cost, expectedPll: continuation, verified: true, skip: true, stage: 'LAST_LAYER' });
  } else for (const candidate of matchOrientationStage(state, 'OLL', options)) addUnique(candidates, candidate);
  if (areEdgesOriented(state)) for (const candidate of matchOrientationStage(state, 'COLL', options)) addUnique(candidates, candidate);
  if (options.allowEollPrep && !areEdgesOriented(state)) for (const candidate of eollCandidates(state, options)) addUnique(candidates, candidate);
  return [...candidates.values()].sort((a, b) => compareCandidates(a, b, options.preferColl));
}

/** Best actual OLL/COLL + PLL/AUF path, without allocating every continuation.
 * The lower bound is the already-known nonnegative cost of the first segment.
 * This is useful for contextual ranking of hundreds of last-pair insertions.
 * Public getApplicable still returns the complete finite catalogue alternatives.
 */
export function bestContinuation(state, options = {}) {
  const catalog = resolveCatalog(options);
  if (!isF2L(state)) return null;
  const key = fullKey(state) + '|' + JSON.stringify(options.profile || {}) + '|' + Boolean(options.preferColl) + '|' + Boolean(options.onlyColl) + '|' + Boolean(options.allowEollPrep);
  if (catalog.bestContinuationCache.has(key)) return catalog.bestContinuationCache.get(key);
  let best = null;
  if (isOLL(state)) {
    const expectedPll = bestPLL(state, options);
    if (expectedPll) best = { id: 'oll-skip', family: 'SKIP', title: 'OLL skip', moves: [], state: Uint8Array.from(state), cost: 0, score: 0, htm: 0, qtm: 0, rotations: 0, source: null, sources: [], expectedPll, totalCost: expectedPll.cost, recommendationScore: expectedPll.cost, skip: true, verified: true };
  }
  const own = [];
  if (!isOLL(state) && !options.onlyColl) own.push(...matchOrientationStage(state, 'OLL', { ...options, _withoutContinuation: true }));
  if (areEdgesOriented(state)) own.push(...matchOrientationStage(state, 'COLL', { ...options, _withoutContinuation: true }));
  own.sort((a, b) => a.cost - b.cost || a.htm - b.htm);
  for (const candidate of own) {
    if (best && candidate.cost > best.totalCost) break;
    const full = withContinuation(candidate, options);
    if (full && (!best || compareCandidates(full, best, options.preferColl) < 0)) best = full;
  }
  if (options.allowEollPrep && !options.onlyColl && !areEdgesOriented(state)) {
    for (const candidate of eollCandidates(state, options)) {
      if (!best || compareCandidates(candidate, best, options.preferColl) < 0) best = candidate;
    }
  }
  catalog.bestContinuationCache.set(key, best);
  if (catalog.bestContinuationCache.size > 512) catalog.bestContinuationCache.delete(catalog.bestContinuationCache.keys().next().value);
  return best;
}

export function matchF2L(state, options = {}) {
  const catalog = resolveCatalog(options), candidates = new Map();
  if (!isCross(state) || isF2L(state)) return [];
  const already = solvedSlots(state), required = options.slot;
  for (const aligned of alignedStates(state)) {
    for (let slot = 0; slot < 4; slot++) {
      const key = pairKey(aligned.cubies, slot);
      for (const { record } of catalog.indices.F2L.get(key) || []) {
        const tail = aligned.frameBack;
        const end = applyAlg(effect(aligned.state, record.permutation), tail);
        const finished = solvedSlots(end), newlySolved = finished.filter(name => !already.includes(name));
        if (!isCross(end) || !already.every(name => finished.includes(name)) || !newlySolved.length || (required && !newlySolved.includes(required))) continue;
        const moves = [...aligned.setup, ...record.moves, ...tail];
        const own = resultCandidate(record, moves, end, options, `@${aligned.y},${aligned.u}`, { stage: 'F2L', slot: newlySolved[0], slots: newlySolved, solvedSlots: finished, setup: aligned.setup, frameRestoration: tail });
        if (isF2L(end) && options.lookahead !== false) {
          const lastLayer = bestContinuation(end, options);
          if (lastLayer) { own.lastLayerContinuation = { id: lastLayer.id, title: lastLayer.title, family: lastLayer.family, cost: lastLayer.totalCost, moves: lastLayer.moves, expectedPll: lastLayer.expectedPll }; own.totalCost += lastLayer.totalCost; own.recommendationScore = own.totalCost; }
        }
        addUnique(candidates, own);
      }
    }
  }
  return [...candidates.values()].sort((a, b) => compareCandidates(a, b));
}

export function getApplicable(state, options = {}) {
  const stage = String(options.stage || 'LAST_LAYER').toUpperCase();
  if (stage === 'PLL' || stage === 'EPLL') return matchPLL(state, options);
  if (stage === 'F2L') return matchF2L(state, options);
  if (stage === 'COLL') return matchOrientationStage(state, 'COLL', options).sort((a, b) => compareCandidates(a, b, true));
  return matchLastLayer(state, options);
}

export { ollKey, cornerKey, pllKey, edgeKey, pairKey };
