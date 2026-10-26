---
name: handoff
description: Close a work stage on CenpAI by updating STATUS.md and docs/DECISIONS.md so the next session can continue cold. Use at the end of a stage or session, when the Stop hook says STATUS.md is stale, or when the user says /handoff.
---

1. Collect the facts. Read `git status`, `git log --oneline -10`, `git diff --stat`, and the results of the last test run (run `/test` if code changed since then).
2. Rewrite `STATUS.md`, keeping its sections: date and milestone line, Done, Not yet verified, Environment quirks, Blockers. Rules:
   - Change only what's true now. Delete stale lines rather than piling up history; git keeps the history.
   - "Done" only for things that were run or tested. Anything written but not run goes under "Not yet verified", with the reason.
   - Give test counts as measured (`N passed`), with the date.
   - Keep the file under ~60 lines.
3. For each new decision (a model choice, threshold, limit, dataset decision, deviation from `docs/PRD.md`, owner approval), add a row to `docs/DECISIONS.md`: the decision, then why or its status. Update the "Open" list.
4. If the PRD itself changed, update `docs/PRD.md` and regenerate `docs/source/CenpAI_PRD_v2.docx` from it, or tell the user it is out of date.
5. Write files with the Write or Edit tools, not PowerShell `Set-Content` (it adds a byte-order mark).

Finish with three lines: what was done, what's next, and what's blocked.
