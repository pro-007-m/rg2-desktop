# Rebuilding the pyramid solver tables

These scripts are corresponding source for RG2's own generated tables in
`data/puzzles/solver-poly-pyramid-data.mjs`. They use the repository's physical
geometry and legal permutations, with no APK, move history, network or external
package. Run them from the repository root with Node.js 24 or later.

```sh
# Recompute all orders 4–20 and check exact runtime bytes without changing them:
node tools/puzzles/build-pyramid-tables.mjs --verify

# Also retain a separate generated file for its hash or a diff:
node tools/puzzles/build-pyramid-tables.mjs --verify --output /absolute/qa/pyramid-tables.mjs

# Intentionally replace the runtime table with freshly computed tables:
node tools/puzzles/build-pyramid-tables.mjs
```

Full regeneration takes several minutes on a desktop. It builds from scratch;
the existing generated file is read only for the optional final comparison.
`pyramid-seeds.mjs` discovers isolated 3-cycle commutators and checks their complete
unique-labelled facelet action. `pyramid-quotient.mjs` constructs the remaining
coupled quotient and an exact Schreier–Sims stabilizer chain. The entry point
serializes the deterministic commutators and transversal words for every order.

The runtime asset's original `large-poly/build-pyramid-tables.mjs` header is kept
for byte-for-byte reproducibility of release 1.6.0. Its packaged public generator
is this directory's `build-pyramid-tables.mjs`. Relative imports work in both
the Desktop and Android repositories because both have a root `data/puzzles` tree.

The scripts are licensed under GPL-3.0-only, like RG2; see the repository's
`LICENSE` and `LICENSING.md`. The standard small-puzzle SGS bridge retains its
separate third-party notices in `data/puzzles/vendor/cubing`.
