"""Claude Code hooks for CenpAI.

    guard.py pre   PreToolUse: deny secret/data leaks; ask before push, deploy, or paid actions
    guard.py stop  Stop: block once if code changed after STATUS.md was last updated
"""
import json
import re
import subprocess
import sys
from pathlib import Path

SECRET_VARS = re.compile(r"ROBOFLOW_API_KEY|HF_TOKEN|HUGGING_FACE_HUB_TOKEN|RENDER_API_KEY|GH_TOKEN|GITHUB_TOKEN")
DUMP_ENV = re.compile(r"(^|[;&|]\s*)(printenv|env|set|Get-ChildItem\s+env:|gci\s+env:|dir\s+env:|ls\s+env:)\s*($|[;&|])", re.I)
READ_DOTENV = re.compile(r"\b(cat|type|more|less|head|tail|Get-Content|gc)\b[^|;&]*\.env(?!\.example)\b", re.I)
START = r"(^|[;&|(]\s*)"                                   # a command position, not text inside a message
OUTWARD = re.compile(START + r"(git\s+(-C\s+\S+\s+)?push\b|gh\s+(repo\s+(delete|create|edit|rename)|release|pr\s+merge)\b"
                     r"|docker\s+push\b|(npx\s+)?vercel\b|render\s|huggingface-cli\s+upload\b|twine\s+upload\b)"
                     r"|api\.render\.com", re.I)
PAID_MCP = {"mcp__claude_ai_Roboflow__trainings_create", "mcp__claude_ai_Roboflow__autolabel_start",
            "mcp__claude_ai_Roboflow__batch_processing_run", "mcp__claude_ai_Roboflow__project_deployment_launch",
            "mcp__plugin_vercel_vercel__create_deployment"}
FORBIDDEN = re.compile(r"(^|/)(\.env(\..+)?|data/.*|runs/.*|media/.*)$|\.(pt|pth|ckpt|safetensors|zip|jpe?g|png|mp4|mov|avi)$", re.I)
MAX_BYTES = 50 * 2**20
CODE = re.compile(r"^(cenpai|ml|tests|notebooks)/|^(Dockerfile|render\.yaml|requirements[^/]*\.txt)$")


def out(decision, reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision,
                                             "permissionDecisionReason": reason}}))
    sys.exit(0)


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True).stdout.splitlines()


def staged_problems(cwd, cmd):
    files = git(cwd, "diff", "--cached", "--name-only")
    if re.search(r"\s-\w*a", cmd):                          # git commit -a / -am also commits tracked changes
        files += git(cwd, "diff", "--name-only")
    bad = [f for f in files if FORBIDDEN.search(f) and f != ".env.example"]
    bad += [f for f in files if (Path(cwd) / f).is_file() and (Path(cwd) / f).stat().st_size > MAX_BYTES]
    return sorted(set(bad))


def pre(ev):
    tool, inp, cwd = ev.get("tool_name", ""), ev.get("tool_input") or {}, ev.get("cwd") or "."
    if tool in PAID_MCP:
        out("ask", f"{tool} may spend credits or publish something. Owner approval required (PRD §7, §10).")
    if tool == "Read":
        name = Path(inp.get("file_path", "")).name
        if re.fullmatch(r"\.env(\..+)?", name) and name != ".env.example":
            out("deny", "Reading .env would expose secrets. Use .env.example, or ask the owner.")
        return
    cmd = inp.get("command", "")
    if SECRET_VARS.search(cmd) or DUMP_ENV.search(cmd) or READ_DOTENV.search(cmd):
        out("deny", "This command could print a secret (API key / token / .env). Scripts read keys from the "
                    "environment themselves; never echo them.")
    if re.search(r"\bgit\b[^;&|]*\bcommit\b", cmd):
        bad = staged_problems(cwd, cmd)
        if bad:
            out("deny", "Refusing to commit raw data, media, weights, secrets, or files over 50 MB: "
                        + ", ".join(bad[:10]) + ". Unstage them (git restore --staged <file>).")
    if OUTWARD.search(cmd):
        out("ask", "This publishes or deploys (push / repo change / deploy / upload). Confirm with the owner first.")


def stop(ev):
    if ev.get("stop_hook_active"):
        return
    cwd = Path(ev.get("cwd") or ".")
    changed = [l[3:].strip().strip('"') for l in git(cwd, "status", "--porcelain")]
    code = [cwd / f for f in changed if CODE.search(f) and (cwd / f).exists()]
    status = cwd / "STATUS.md"
    if code and status.exists() and max(p.stat().st_mtime for p in code) > status.stat().st_mtime:
        print(json.dumps({"decision": "block", "reason": "Code changed after STATUS.md was last updated. "
                          "Update STATUS.md (or run /handoff), or reply briefly why no update is needed."}))


if __name__ == "__main__":
    ev = json.loads(sys.stdin.read() or "{}")
    {"pre": pre, "stop": stop}[sys.argv[1]](ev)
