This module contains a JavaScript adaptation of **ShellPuppy/RCube**.

Upstream: https://github.com/ShellPuppy/RCube

Pinned revision: `c0e6df125db141eaf0044bf5a39cb54c942cfab2`.

The RCube source is distributed under GNU GPL version3; the complete license is in `LICENSE.txt`. The original source/build files used for this adaptation are retained under `upstream/`. Original authorship and the upstream license are preserved. The optional Tiny PNG Output files in that reference snapshot retain their own embedded notices; the JavaScript backend does not use the image exporter.

Changes made for RG2:

- Adapted the constructive center, corner and edge algorithms to JavaScript.
- Replaced the source face storage and virtual face rotations with an adapter to RG2's independently implemented URFDLB facelet mathematics.
- Replaced the source's direct optimized center-color writes with complete legal commutator sequences, including the final destination-face undo. Every state change therefore has a corresponding physical move in the returned solution.
- Removed file persistence, CLI interaction, PNG export and wall-clock accumulation from runtime operation.
- Added cancellation/time/move budgets, sparse permutation reuse, progress reporting and state-only input/output.
- Added opt-in reduction targets for odd cubes: wing pairing can target the current true middle-edge colours while excluding the true middle slice. The default full constructive algorithm retains its original canonical targets.

`rcube.mjs` is the full executable source of this JavaScript adaptation. `build-port.py` reproduces it from the pinned C++ reference with Python3; no C++ compiler, downloaded program or native binary is needed by the application. From this directory run `python build-port.py`.

This notice identifies the license of this backend component. Other application components and imported lesson/media data have their own provenance and notices; this document does not assign a new license to that material.
