# CenpAI

Pointers only. Read the target before acting.

- Requirements: `docs/PRD.md` (source docs: `docs/source/`)
- Current state and next step: `STATUS.md`
- Decisions and open questions: `docs/DECISIONS.md`
- Datasets: `docs/datasets.md`, `ml/datasets.yaml`
- Setup, commands, layout: `README.md`
- Model artifacts: `models/README.md`
- Reports: `docs/reports/`

Subagents (`.claude/agents/`): `dataset-auditor`, `ml-trainer`, `privacy-reviewer`, `eval-reporter`, `ui-critic`
Skills (`.claude/skills/`): `/test`, `/handoff`, `/dataset-add`, `/model-release`
Hooks: `.claude/settings.json` → `.claude/hooks/guard.py`
