#!/usr/bin/env python3
"""Probe Cursor, GitHub PAT, and Vercel connectivity. Prints presence-only env + live HTTP checks."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


def load_dotenv(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip("\"'")
    return env


def http_probe(url: str, headers: dict[str, str]) -> tuple[int | None, str]:
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def main() -> int:
    root = Path(os.environ.get("JARVIS_BE_ROOT", "/home/ubuntu/Jarvis-BE"))
    env = load_dotenv(root / ".env")
    for key, value in os.environ.items():
        env.setdefault(key, value)

    keys = [
        "CURSOR_API_KEY",
        "CURSOR_API_BASE_URL",
        "CURSOR_AGENT_MODEL_ID",
        "GITHUB_PAT",
        "JARVIS_GITHUB_TOKEN",
        "JARVIS_GITHUB_ORG",
        "VERCEL_TOKEN",
        "VERCEL_TEAM_ID",
        "VERCEL_DEPLOYMENT_PROTECTION_BYPASS",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
    ]
    print("=== Required integration env (presence only) ===")
    for key in keys:
        value = env.get(key, "")
        if value.strip():
            print(f"ENV {key}: SET (len={len(value)})")
        else:
            print(f"ENV {key}: MISSING")

    print("\n=== Live probes ===")
    gh = (env.get("GITHUB_PAT") or env.get("JARVIS_GITHUB_TOKEN") or "").strip()
    if gh:
        prefix = f"{gh[:4]}..." if len(gh) >= 4 else "(short)"
        print(f"GitHub token prefix={prefix}")
        for scheme in ("Bearer", "token"):
            code, body = http_probe(
                "https://api.github.com/user",
                {
                    "Authorization": f"{scheme} {gh}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "jarvis-health-check",
                },
            )
            try:
                data = json.loads(body)
                detail = data.get("login") or data.get("message") or "?"
            except json.JSONDecodeError:
                detail = body[:120]
            print(f"GitHub /user ({scheme}): HTTP {code} detail={detail}")
    else:
        print("GitHub /user: SKIPPED (no token)")

    vt = (env.get("VERCEL_TOKEN") or "").strip()
    if vt:
        url = "https://api.vercel.com/v2/user"
        tid = (env.get("VERCEL_TEAM_ID") or "").strip()
        if tid:
            url += f"?teamId={tid}"
        code, body = http_probe(
            url,
            {
                "Authorization": f"Bearer {vt}",
                "User-Agent": "jarvis-health-check",
            },
        )
        try:
            data = json.loads(body)
            user = data.get("user") or {}
            detail = (
                user.get("username")
                or user.get("email")
                or data.get("error", {}).get("message")
                or "?"
            )
        except json.JSONDecodeError:
            detail = body[:120]
        print(f"Vercel /v2/user: HTTP {code} detail={detail}")

        dep_code, dep_body = http_probe(
            "https://api.vercel.com/v6/deployments?limit=1",
            {
                "Authorization": f"Bearer {vt}",
                "User-Agent": "jarvis-health-check",
            },
        )
        try:
            dep_data = json.loads(dep_body)
            deps = dep_data.get("deployments") or []
            dep_detail = f"deployments_count={len(deps)}"
        except json.JSONDecodeError:
            dep_detail = dep_body[:120]
        print(f"Vercel /v6/deployments: HTTP {dep_code} detail={dep_detail}")
    else:
        print("Vercel /v2/user: SKIPPED (no token)")

    ck = (env.get("CURSOR_API_KEY") or "").strip()
    if ck:
        base = (env.get("CURSOR_API_BASE_URL") or "https://api.cursor.com").rstrip("/")
        code, body = http_probe(
            f"{base}/v1/agents?limit=1",
            {
                "Authorization": f"Bearer {ck}",
                "Content-Type": "application/json",
                "User-Agent": "jarvis-health-check",
            },
        )
        try:
            data = json.loads(body)
            if isinstance(data, dict) and "agents" in data:
                detail = f"agents_count={len(data.get('agents') or [])}"
            elif isinstance(data, dict):
                detail = data.get("message") or data.get("error") or str(list(data.keys())[:4])
            else:
                detail = str(data)[:120]
        except json.JSONDecodeError:
            detail = body[:120]
        print(f"Cursor GET /v1/agents: HTTP {code} detail={detail}")
        model = (env.get("CURSOR_AGENT_MODEL_ID") or "composer-2").strip()
        print(f"Cursor model configured: {model}")
    else:
        print("Cursor API: SKIPPED (no key)")

    print("\n=== PM2 ===")
    try:
        out = subprocess.check_output(["pm2", "jlist"], text=True)
        for proc in json.loads(out):
            if proc.get("name") != "jarvis-dev":
                continue
            pm2_env = proc.get("pm2_env", {})
            print("status=", pm2_env.get("status"))
            print("restarts=", pm2_env.get("restart_time"))
            print("node=", pm2_env.get("node_version"))
    except Exception as exc:  # noqa: BLE001
        print("pm2 check failed:", exc)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
