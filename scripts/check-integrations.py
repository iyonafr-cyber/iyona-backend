#!/usr/bin/env python3
"""Probe GitHub PAT, Vercel, and Cursor Cloud Agents from iyona-backend/.env.

Does not print secrets. Exit 0 if every configured live probe succeeds.
Usage:
  python3 scripts/check-integrations.py
  IYONA_BE_ROOT=/path/to/iyona-backend python3 scripts/check-integrations.py
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
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


def http_probe(
    url: str,
    headers: dict[str, str],
    method: str = "GET",
) -> tuple[int | None, str]:
    # curl uses the macOS cert store; CPython on this machine often does not.
    cmd = [
        "curl",
        "-sS",
        "-X",
        method,
        "--max-time",
        "15",
        "-w",
        "\n%{http_code}",
    ]
    for key, value in headers.items():
        cmd.extend(["-H", f"{key}: {value}"])
    cmd.append(url)
    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return None, "curl is not installed"
    if completed.returncode != 0 and not completed.stdout.strip():
        return None, (completed.stderr or completed.stdout or "curl failed").strip()[:200]
    raw = completed.stdout.rstrip("\n")
    if "\n" not in raw:
        return None, (completed.stderr or raw or "empty curl response")[:200]
    body, _, status_s = raw.rpartition("\n")
    try:
        return int(status_s), body
    except ValueError:
        return None, (raw or completed.stderr)[:200]


def json_obj(body: str) -> dict:
    try:
        data = json.loads(body)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def ok(label: str, detail: str) -> None:
    print(f"OK   {label}: {detail}")


def fail(label: str, detail: str) -> None:
    print(f"FAIL {label}: {detail}")


def skip(label: str, detail: str) -> None:
    print(f"SKIP {label}: {detail}")


def main() -> int:
    root = Path(
        os.environ.get("IYONA_BE_ROOT")
        or os.environ.get("JARVIS_BE_ROOT")
        or Path(__file__).resolve().parent.parent
    )
    env_path = root / ".env"
    env = load_dotenv(env_path)
    for key, value in os.environ.items():
        env.setdefault(key, value)

    print(f"Env file: {env_path} ({'found' if env_path.exists() else 'MISSING'})")
    print("=== Required integration env (presence only) ===")
    keys = [
        "CURSOR_API_KEY",
        "CURSOR_API_BASE_URL",
        "CURSOR_AGENT_MODEL_ID",
        "GITHUB_PAT",
        "GITHUB_ORG",
        "JARVIS_GITHUB_TOKEN",
        "JARVIS_GITHUB_ORG",
        "VERCEL_TOKEN",
        "VERCEL_TEAM_ID",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
    ]
    for key in keys:
        value = env.get(key, "")
        if value.strip():
            print(f"ENV  {key}: SET (len={len(value)})")
        else:
            print(f"ENV  {key}: MISSING")

    failed = 0
    print("\n=== Live probes ===")

    # ── GitHub ────────────────────────────────────────────────────────────
    gh = (env.get("GITHUB_PAT") or env.get("JARVIS_GITHUB_TOKEN") or "").strip()
    org = (env.get("GITHUB_ORG") or env.get("JARVIS_GITHUB_ORG") or "").strip()
    if not gh:
        fail("GitHub", "GITHUB_PAT is not set")
        failed += 1
    else:
        code, body = http_probe(
            "https://api.github.com/user",
            {
                "Authorization": f"Bearer {gh}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "iyona-health-check",
            },
        )
        data = json_obj(body)
        login = data.get("login")
        if code == 200 and login:
            ok("GitHub /user", f"authenticated as {login}")
        else:
            fail(
                "GitHub /user",
                f"HTTP {code} {data.get('message') or body[:160]}",
            )
            failed += 1

        rl_code, rl_body = http_probe(
            "https://api.github.com/rate_limit",
            {
                "Authorization": f"Bearer {gh}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "iyona-health-check",
            },
        )
        remaining = (
            json_obj(rl_body).get("resources", {}).get("core", {}).get("remaining")
        )
        if rl_code == 200 and isinstance(remaining, int):
            ok("GitHub rate_limit", f"core remaining={remaining}")
        else:
            fail("GitHub rate_limit", f"HTTP {rl_code} {rl_body[:160]}")
            failed += 1

        if org:
            org_code, org_body = http_probe(
                f"https://api.github.com/orgs/{org}",
                {
                    "Authorization": f"Bearer {gh}",
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "iyona-health-check",
                },
            )
            org_data = json_obj(org_body)
            if org_code == 200:
                ok("GitHub org", f"{org_data.get('login', org)} reachable")
            elif org_code == 404 and login and login.lower() == org.lower():
                fail(
                    "GitHub org",
                    f"GITHUB_ORG={org} is the PAT user, not an organization. "
                    "Unset GITHUB_ORG so repos are created under the user account.",
                )
                failed += 1
            else:
                fail(
                    "GitHub org",
                    f"HTTP {org_code} {org_data.get('message') or org_body[:160]}",
                )
                failed += 1
        else:
            skip("GitHub org", "GITHUB_ORG unset — repos will be created under the PAT user")

    # ── Vercel ────────────────────────────────────────────────────────────
    vt = (env.get("VERCEL_TOKEN") or "").strip()
    if not vt:
        fail("Vercel", "VERCEL_TOKEN is not set")
        failed += 1
    else:
        url = "https://api.vercel.com/v2/user"
        tid = (env.get("VERCEL_TEAM_ID") or "").strip()
        if tid:
            url += f"?teamId={tid}"
        code, body = http_probe(
            url,
            {
                "Authorization": f"Bearer {vt}",
                "User-Agent": "iyona-health-check",
            },
        )
        data = json_obj(body)
        user = data.get("user") or {}
        detail = (
            user.get("username")
            or user.get("email")
            or (data.get("error") or {}).get("message")
            or body[:160]
        )
        if code == 200:
            ok("Vercel /v2/user", str(detail))
        else:
            fail("Vercel /v2/user", f"HTTP {code} {detail}")
            failed += 1

        dep_url = "https://api.vercel.com/v6/deployments?limit=1"
        if tid:
            dep_url += f"&teamId={tid}"
        dep_code, dep_body = http_probe(
            dep_url,
            {
                "Authorization": f"Bearer {vt}",
                "User-Agent": "iyona-health-check",
            },
        )
        dep_data = json_obj(dep_body)
        if dep_code == 200:
            deps = dep_data.get("deployments") or []
            ok("Vercel /v6/deployments", f"reachable (sample={len(deps)})")
        else:
            err = (dep_data.get("error") or {}).get("message") or dep_body[:160]
            fail("Vercel /v6/deployments", f"HTTP {dep_code} {err}")
            failed += 1

        if tid:
            team_code, team_body = http_probe(
                f"https://api.vercel.com/v2/teams/{tid}",
                {
                    "Authorization": f"Bearer {vt}",
                    "User-Agent": "iyona-health-check",
                },
            )
            team_data = json_obj(team_body)
            name = team_data.get("name") or team_data.get("slug")
            if team_code == 200 and name:
                ok("Vercel team", str(name))
            else:
                fail(
                    "Vercel team",
                    f"HTTP {team_code} {(team_data.get('error') or {}).get('message') or team_body[:160]}",
                )
                failed += 1
        else:
            skip(
                "Vercel team",
                "VERCEL_TEAM_ID unset — deploys will use the token's personal account",
            )

    # ── Cursor Cloud Agents ───────────────────────────────────────────────
    ck = (env.get("CURSOR_API_KEY") or "").strip()
    if not ck:
        fail("Cursor", "CURSOR_API_KEY is not set")
        failed += 1
    else:
        base = (env.get("CURSOR_API_BASE_URL") or "https://api.cursor.com").rstrip(
            "/"
        )
        basic = "Basic " + base64.b64encode(f"{ck}:".encode("utf-8")).decode("ascii")
        headers = {
            "Authorization": basic,
            "Accept": "application/json",
            "User-Agent": "iyona-health-check",
        }
        code, body = http_probe(f"{base}/v1/me", headers)
        if code == 404:
            code, body = http_probe(f"{base}/v1/models", headers)
            label = "Cursor GET /v1/models"
        else:
            label = "Cursor GET /v1/me"
        data = json_obj(body)
        if code == 200:
            who = (
                data.get("userEmail")
                or data.get("email")
                or data.get("user_email")
                or "authenticated"
            )
            ok(label, str(who))
        else:
            fail(
                label,
                f"HTTP {code} {data.get('message') or data.get('error') or body[:160]}",
            )
            failed += 1
        model = (env.get("CURSOR_AGENT_MODEL_ID") or "composer-2.5").strip()
        print(f"INFO Cursor model configured: {model}")

    print("\n=== Summary ===")
    if failed:
        print(f"{failed} check(s) failed")
        return 1
    print("All live probes passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
