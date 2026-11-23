"""Summarise phone_test_results.csv for docs/reports/detector_comparison.md.

The CSV stays with the clips (never in Git). One row per plate appearance per model:

    clip,appearance,condition,model,leaked,uncovered_frames,false_mask_s

- condition: 1-10 as in docs/protocols/data_and_phone_test.md
- leaked: yes or no; uncovered_frames: frames that showed a readable plate (0 if not leaked)
- no-plate clips (condition 10): one row per clip and model, appearance and leaked left blank,
  false_mask_s = seconds a mask covered something that is not a plate

Usage: python tools/score_phone_test.py path/to/phone_test_results.csv
Prints Markdown tables to paste into the report. Standard library only.
"""

from __future__ import annotations

import csv
import math
import sys
from collections import defaultdict

CONDITIONS = {
    1: "Approach",
    2: "Pan in from the edge",
    3: "Angles",
    4: "Night",
    5: "Backlight",
    6: "Shake",
    7: "Partly covered",
    8: "Motorcycle",
    9: "Plate on a screen",
    10: "No plate",
}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for k successes out of n."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def load(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        rows = [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]
    for i, r in enumerate(rows, start=2):
        if not r.get("model") or not r.get("condition", "").isdigit():
            raise SystemExit(f"line {i}: needs model and a numeric condition")
        if r["condition"] != "10" and r.get("leaked", "").lower() not in ("yes", "no"):
            raise SystemExit(f"line {i}: leaked must be yes or no")
    return rows


def summarise(rows: list[dict[str, str]]) -> str:
    models = sorted({r["model"] for r in rows})
    out: list[str] = []

    out.append("| model | leaked / appearances | leak rate | 95% CI | uncovered frames per leak |")
    out.append("|---|---|---|---|---|")
    for m in models:
        apps = [r for r in rows if r["model"] == m and r["condition"] != "10"]
        leaks = [r for r in apps if r["leaked"].lower() == "yes"]
        n, k = len(apps), len(leaks)
        lo, hi = wilson(k, n)
        frames = [int(r.get("uncovered_frames") or 0) for r in leaks]
        per = f"{sum(frames) / k:.1f} (median {sorted(frames)[k // 2]}, max {max(frames)})" if k else "-"
        rate = f"{k / n:.3f}" if n else "-"
        out.append(f"| {m} | {k} / {n} | {rate} | {lo:.3f}-{hi:.3f} | {per} |")

    out.append("")
    out.append("Leaks per condition (counts only; groups this small support no claims):")
    out.append("")
    out.append("| condition | " + " | ".join(models) + " |")
    out.append("|---|" + "---|" * len(models))
    by = defaultdict(lambda: [0, 0])
    for r in rows:
        if r["condition"] == "10":
            continue
        cell = by[(int(r["condition"]), r["model"])]
        cell[1] += 1
        cell[0] += r["leaked"].lower() == "yes"
    for c in sorted({c for c, _ in by}):
        cells = [f"{by[(c, m)][0]} / {by[(c, m)][1]}" if (c, m) in by else "-" for m in models]
        out.append(f"| {c} {CONDITIONS.get(c, '')} | " + " | ".join(cells) + " |")

    out.append("")
    out.append("| model | no-plate clips | false-mask seconds |")
    out.append("|---|---|---|")
    for m in models:
        np_rows = [r for r in rows if r["model"] == m and r["condition"] == "10"]
        secs = sum(float(r.get("false_mask_s") or 0) for r in np_rows)
        out.append(f"| {m} | {len(np_rows)} | {secs:.1f} |")
    return "\n".join(out)


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        raise SystemExit(__doc__)
    print(summarise(load(argv[1])))


if __name__ == "__main__":
    main(sys.argv)
