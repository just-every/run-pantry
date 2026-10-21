# Capture fixtures

All fixture artwork and document text are synthetic Pantry test evidence, created
for this repository. They do not represent real purchases or people.

- `synthetic-pantry-2.png`: original 128 × 160 RGB PNG, drawn with Python's standard
  library as receipt-like paper and ink. No external artwork or dependencies.
- `synthetic-pantry-2.heic`: actual HEIC encoded from that PNG with macOS `sips`.
  The capture journey uploads and downloads these exact encoded bytes, even when
  the browser cannot decode HEIC.
- `tests/app/capture-fixtures.mjs` draws a larger two-receipt PNG using the browser's
  software canvas and produces a valid three-page PDF with a cross-reference table.
  Both are generated only in tests, never in application code.

No third-party photographic samples are included.
