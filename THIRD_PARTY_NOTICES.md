# Third-party components

Original application code is distributed under GPL-3.0-only; see [LICENSING.md](LICENSING.md) and [LICENSE](LICENSE). Third-party notices below and the independent lesson/media rights remain intact.


## cubing.js

The virtual-puzzle solver uses the unmodified local JavaScript distribution of **cubing.js 0.66.1**, revision `8544249ff1e662557df912065a26b5f90f4df574`, under its **MPL-2.0** option. Copyright belongs to the cubing.js authors, including Lucas Garron and Tom Rokicki. Upstream includes contributions by Chen Shuang and others and separately licensed vendored components.

The complete distributed JavaScript files, upstream README, MPL/GPL texts, source revision, npm integrity and per-file hashes are retained in `data/puzzles/vendor/cubing/`. Upstream source: <https://github.com/cubing/cubing.js/tree/8544249ff1e662557df912065a26b5f90f4df574>. Component notices in the JavaScript distribution remain intact. The app uses the library locally; it does not use its Bluetooth services.

The stabilizer-group puzzle solver adapter and its own geometric/permutation conversion are separate TwistForge modules. Reused upstream group data remains covered by the original component's notices.

## Three.js

The original Three.js notice is retained in `data/solver/vendor/LICENSE.three.txt`. The virtual-puzzle renderer reuses the same local Three.js distribution as the existing color-entry solver.

## RCube constructive backend

The separately attributed **RCube** backend is a JavaScript adaptation of ShellPuppy/RCube revision `c0e6df125db141eaf0044bf5a39cb54c942cfab2`, distributed under **GPL-3.0-only**. The complete executable JavaScript source, original C++ snapshot, reproducible adaptation script, original copyright notices, license and change description are included in `data/puzzles/vendor/rcube/`. The source is shipped together with the application and retained in its public source repository and source archive. [Pinned upstream](https://github.com/ShellPuppy/RCube/tree/c0e6df125db141eaf0044bf5a39cb54c942cfab2).

This component's notice does not assign a new license to pre-existing lessons, diagrams or media. The reduction adapter and the constructive mode retain explicit method names and independently verify every emitted physical move.

## Library content

These component notices do not change the ownership or license of the pre-existing RG2 lessons, diagrams, algorithms or other data. The reference Magic Cube Puzzle 3D APKS was examined as an input to a separate research process; its executable code, artwork, models, audio and other assets are not part of this distribution.
