"""
release.py — publish a GitHub release for skills-dashboard.

Usage:
    python scripts/release.py <version> [--notes "extra notes"]

Examples:
    python scripts/release.py v0.2.0
    python scripts/release.py v0.2.1 --notes "Fix remote install for Anthropic Skills"

Requires:
    - GITHUB_TOKEN env var with repo scope
    - npm run build already done (or pass --build to build first)
    - The zip must already exist, or pass --pack to run packaging first

What it does:
    1. Optionally builds & packages (--build / --pack)
    2. Creates the GitHub release tag
    3. Uploads release/AgentSkillsDashboard-<version>-win-x64.zip as an asset
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "GISWLH/skills-dashboard"
ROOT = Path(__file__).resolve().parent.parent


def headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "skills-dashboard-release",
    }


def gh_get(url: str, token: str):
    req = urllib.request.Request(url, headers=headers(token))
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def gh_post(url: str, token: str, data: dict | None = None, raw: bytes | None = None, content_type: str = "application/json"):
    body = json.dumps(data).encode() if data is not None else raw
    h = {**headers(token), "Content-Type": content_type}
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  HTTP {e.code}: {err[:300]}")
        raise


def build(version: str) -> Path:
    """Build the web + electron bundles and package into a zip."""
    print("Building …")
    subprocess.run(["npx", "vite", "build"], cwd=ROOT, check=True, shell=True)

    zip_name = f"AgentSkillsDashboard-{version}-win-x64.zip"
    zip_path = ROOT / "release" / zip_name
    unpacked = ROOT / "release" / "win-unpacked"

    if not unpacked.exists():
        print("  win-unpacked not found. Run `npm run dist` manually first.")
        sys.exit(1)

    print(f"Packing {zip_path.name} …")
    shutil.make_archive(str(zip_path.with_suffix("")), "zip", unpacked)
    return zip_path


def main():
    parser = argparse.ArgumentParser(description="Publish a GitHub release")
    parser.add_argument("version", help="Version tag, e.g. v0.2.0")
    parser.add_argument("--notes", default="", help="Extra release notes")
    parser.add_argument("--build", action="store_true", help="Run vite build before packing")
    parser.add_argument("--pack", action="store_true", help="Repack win-unpacked into zip")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("Error: GITHUB_TOKEN environment variable is not set.")
        sys.exit(1)

    version = args.version
    zip_name = f"AgentSkillsDashboard-{version}-win-x64.zip"
    zip_path = ROOT / "release" / zip_name

    if args.build or args.pack:
        zip_path = build(version)
    elif not zip_path.exists():
        print(f"Zip not found: {zip_path}")
        print("Run with --build or --pack to generate it first.")
        sys.exit(1)

    body = f"Download the zip, extract, and run `Agent Skills Dashboard.exe` — no installer needed.\n\n"
    if args.notes:
        body += f"### Changes\n{args.notes}\n\n"
    body += (
        "### 用法\n"
        f"1. 下载 `{zip_name}`\n"
        "2. 解压到任意目录\n"
        "3. 运行 `Agent Skills Dashboard.exe`"
    )

    # Create release
    print(f"Creating release {version} …")
    try:
        rel = gh_post(
            f"https://api.github.com/repos/{REPO}/releases",
            token,
            data={
                "tag_name": version,
                "name": f"{version}",
                "body": body,
                "draft": False,
                "prerelease": False,
            },
        )
    except urllib.error.HTTPError:
        print("  Could not create release. It may already exist — fetching existing …")
        rel = gh_get(f"https://api.github.com/repos/{REPO}/releases/tags/{version}", token)

    upload_url = rel["upload_url"].split("{")[0]
    release_url = rel["html_url"]
    print(f"  Release: {release_url}")

    # Upload asset
    size_mb = zip_path.stat().st_size // 1024 // 1024
    print(f"Uploading {zip_name} ({size_mb} MB) …")
    raw = zip_path.read_bytes()
    try:
        asset = gh_post(
            f"{upload_url}?name={zip_name}",
            token,
            raw=raw,
            content_type="application/octet-stream",
        )
        print(f"  Download: {asset['browser_download_url']}")
    except urllib.error.HTTPError as e:
        if e.code == 422:
            print("  Asset already exists on this release.")
        else:
            sys.exit(1)

    print("\nDone.")


if __name__ == "__main__":
    main()
