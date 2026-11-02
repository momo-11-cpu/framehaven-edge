# Third-party notices

Original Framehaven source retains the MIT terms recorded in LICENSES/Framehaven-MIT.txt except files with their own SPDX headers. Combined browser bundles contain GPL- and LGPL-derived code and are distributed under GPL-3.0-or-later with complete editable corresponding project sources. This does not replace the original licenses of individual MIT, LGPL or Apache components. See the included GPL-3.0 and LGPL texts, LICENSE, source/ and the file-level notices.

## AMD FidelityFX CAS — MIT

Copyright (c) 2017–2019 Advanced Micro Devices, Inc.
Source: https://github.com/GPUOpen-Effects/FidelityFX-CAS
The WGSL sharpen-only adaptation follows the full-precision green-channel-weight path without diagonal enhancement or CAS upscaling. Original source and license are retained in vendor/ and release licenses/.

## Anime4K v4.0.1 — MIT

Copyright (c) 2019–2021 bloc97.
Source: https://github.com/bloc97/Anime4K/tree/v4.0.1
Restore CNN S and Upscale CNN x2 S coefficients are converted by scripts/convert-anime.mjs. Changes: WGSL, clamped sampling, RGBA16Float intermediates, optional restore mixing and forced 2× execution. This is not a bit-identical mpv configuration claim. Original GLSL, license and SHA-256 records are retained.

## FSRCNNX 1.1 small model — LGPL-3.0-or-later

Copyright (C) 2017–2021 igv.
Source: https://github.com/igv/FSRCNN-TensorFlow/releases/download/1.1/FSRCNNX_x2_8-0-4-1.glsl
The 14-pass 8-0-4-1 CNN and numeric coefficients are converted by scripts/convert-fsrcnnx.mjs into src/generated/fsrcnnx.ts. Changes: explicit WGSL binding slots, clamped pixel sampling, RGBA16Float intermediates, unconditional 2× execution, BT.709 RGB-to-luma extraction and luma replacement retaining bilinearly sampled RGB chroma. The last layer predicts absolute luma, not an image residual. Source matrix conventions and browser color conversion still need Edge verification. Original shader, LGPL-3.0 and GPL-3.0 texts, hashes, editable converter and generated source accompany the release.

## FFmpeg weak deblock and libplacebo deband — LGPL-2.1-or-later

src/engine/filters.ts derives from FFmpeg n7.1 libavfilter/vf_deblock.c, copyright (c) 2018 Paul B Mahol, and libplacebo src/shaders/sampling.c pl_shader_deband.
Sources: https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavfilter/vf_deblock.c and https://github.com/haasn/libplacebo/blob/master/src/shaders/sampling.c
Deblock changes: normalized RGB float equations, fixed 8-pixel grid, two GPU directions and strength-scaled thresholds; no codec QP/block metadata. Deband changes: two fixed iterations, stable pixel-seeded PRNG, nearest samples, strength-scaled threshold and no added grain. Neither adaptation claims integer or PRNG bit-equivalence. The original files and LGPL texts are retained.

## FFmpeg recursive bilateral — MIT

Copyright (c) 2017 Ming Yang; (c) 2019 Paul B Mahol.
Source: https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavfilter/vf_bilateral.c
src/engine/bilateral.ts adapts the forward/backward horizontal and vertical recurrences, carrying unnormalized color and normalization factors until the final vertical result. Changes: independent normalized RGB planes, continuous exponential weights instead of integer lookup tables, FP32 scratch buffers, RGBA16Float output and a strength-to-sigma mapping different from the upstream defaults. Row/column scans are GPU compute passes. The original full MIT notice remains in vendor/ffmpeg-bilateral.c and the corresponding source package.

## FFmpeg libpostproc dering — GPL-2.0-or-later

Copyright (C) 2001–2002 Michael Niedermayer.
Source: https://github.com/FFmpeg/FFmpeg/blob/n7.1/libpostproc/postprocess_template.c
src/engine/dering.ts derives from the C fallback's 8×8 block extrema, same-side 3×3 mask, binomial smoothing and QP-limited correction. The threshold 20 is defined in libpostproc/postprocess.c. Changes: normalized independent RGB planes, immutable input instead of in-place updates, workgroup tiles/reduction, clamped boundaries and strength-controlled correction rather than actual codec QP. Integer rounding and sequential in-place behavior are not reproduced; the implementation is explicitly a GPU adaptation. GPL-3.0-or-later is selected for the combined bundle distribution, as permitted by GPL-2.0-or-later. Full editable source and build scripts are included.

## Build and test tooling

TypeScript, Vite, esbuild, Vitest, fflate and wgsl_reflect are development dependencies, pinned by the lockfile. Their upstream licenses apply. No ONNX Runtime, old RIFE/GMFSS models, native Dawn binaries or Python environments are part of the active browser package. Historical local experiments are omitted from this public source snapshot.

## Framegen v7s — MIT code; noncommercial pretrained weights

Copyright (c) 2026 Monzik Allen. Source: https://github.com/MONZikWasTaken/Framegen/tree/964180848e072163c2098b618a74ae037d5a82d2
Unmodified custom WebGPU runtime: vendor/framegen/rt.js. Released v7s binary and layout: models/export/framegen. SHA-256 provenance accompanies both. The 48×27 difference shader and duplicate/cut thresholds in src/engine/framegen.ts are adapted from upstream extension/content.js. The adapter adds edge padding/cropping, local asset integrity checks, shared-device spatial integration and existing Framehaven presentation/audio scheduling.

The runtime is MIT, but bundled pretrained weights are separately restricted to personal and noncommercial research use. See vendor/framegen/LICENSE and vendor/framegen/WEIGHTS_LICENSE.md (also included under release licenses/framegen). Code licensing does not override the weights restriction. The bundled pretrained weights permit personal and noncommercial research use; the old RIFE/GMFSS/ORT runtime assets are not shipped in the active package.
