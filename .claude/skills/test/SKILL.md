---
name: test
description: Run the CenpAI test suite (or one module) in the project venv with the memory-safe settings this laptop needs. Use before claiming a change works, and when the user says /test.
argument-hint: "[module name, e.g. ml or media_video]"
---

Run from the repo root in PowerShell:

```powershell
$env:OPENBLAS_NUM_THREADS='1'; .venv\Scripts\python -m pytest -q                      # no argument: full suite (~40 s, needs ffmpeg)
$env:OPENBLAS_NUM_THREADS='1'; .venv\Scripts\python -m pytest tests/test_<arg>.py -q   # argument given: $ARGUMENTS
```

If `tests/test_<arg>.py` doesn't exist, list `tests/` and pick the closest match, or ask.

Report the pass/fail counts and the first failure's assertion. A `malloc failed` or `MemoryError` from ffmpeg or numpy usually means the machine ran out of RAM, not a code bug: rerun only that test once before you investigate. Never change a test to make it pass unless the test itself is wrong, and say so if it is.
