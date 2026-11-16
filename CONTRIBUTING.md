# Contributing

1. Branch from `develop` (`feat/...`, `fix/...`, `chore/...`). `main` holds released builds; do not push to it.
2. Make small commits with conventional messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`. One logical change each.
3. Before opening a pull request, run the tests and the build:
   - Python: `pytest`
   - Web: `cd web && npm ci && npm run typecheck && npm test && npm run build`
4. Open the pull request into `develop`.
5. Merge needs one approval from someone other than the author, and CI must pass.

No analytics, no uploads of plate crops or transcripts. Report only numbers you measured.
