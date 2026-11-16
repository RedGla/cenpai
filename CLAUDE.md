# CenpAI

Pointers only. Read the target before acting.

- v3 plan (phones, live plates, speech bleep; read first): `docs/PLAN.md`
- Requirements: `docs/PRD.md` (source docs: `docs/source/`)
- Current state and next step: `STATUS.md`
- Decisions and open questions: `docs/DECISIONS.md`
- Datasets: `docs/datasets.md`, `ml/datasets.yaml`
- Setup, commands, layout: `README.md`
- Contribution rules: `CONTRIBUTING.md`
- Model artifacts: `models/README.md`
- Reports: `docs/reports/`

Subagents (`.claude/agents/`): `dataset-auditor`, `ml-trainer`, `privacy-reviewer`, `eval-reporter`, `ui-critic`
Skills (`.claude/skills/`): `/test`, `/handoff`, `/dataset-add`, `/model-release`
Hooks: `.claude/settings.json` → `.claude/hooks/guard.py`

## Web app (`web/`, Vite + React + TypeScript)

Run from `web/`: `npm ci`, then `npm run dev` (port 5173), `npm test`, `npm run typecheck`, `npm run build`, `npm run format`.
Tabs live in their own folders: `web/src/camera/`, `web/src/audio/`. Phases edit only their own folder.

## Branches

- `develop` is the integration branch. Branch from it, open pull requests into it.
- `main` holds released builds. Never push to `main`.

## Commits

- Conventional messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`), one logical change each.
- Repo-local git identity is the owner's. No `Co-Authored-By` trailer and no "Generated with Claude Code" line in commits or pull requests.
- Keep real timestamps: never set `GIT_AUTHOR_DATE` or `GIT_COMMITTER_DATE`.
- Do not change `cenpai/`, `ml/`, or `tests/` unless the phase says so.
- Scores: never write a number that was not measured.
