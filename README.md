<p align="center">
  <img src="public/icon.png" width="120" alt="Agent Skills Dashboard icon" />
</p>

<h1 align="center">Agent Skills Dashboard</h1>

<p align="center">
  A Windows desktop app for browsing, searching, and installing AI agent skills — locally installed or from public cloud catalogs.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/electron-41-47848f?style=flat-square&logo=electron" />
  <img src="https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/typescript-5-3178c6?style=flat-square&logo=typescript" />
</p>

---

## What It Does

Agent Skills Dashboard gives you one place to see every skill installed across your local AI agent runtimes, and to explore public skill catalogs so you can download and try new ones in a single click.

**Local Board** — scans three runtimes on your machine and shows all installed skills in a searchable card grid:

| Runtime | Folder |
|---|---|
| Claude Code | `~/.claude/skills` |
| CodeX | `~/.codex/skills` (personal + global) |
| OpenClaw | `~/.openclaw/skills` |

**Cloud Explore** — loads public skill catalogs from three repositories, each color-coded and expandable:

| Repository | Color |
|---|---|
| Tencent SkillHub | Teal |
| ClawHub | Rose |
| Anthropic Skills | Amber |

Each catalog section shows a preview set of cards. Click **More** to load additional skills, or click **Download** to install any remote skill directly into one of your local runtime folders.

---

## Getting Started

### Prerequisites

- Node.js 20 or later
- Windows 10 / 11

### Install and run

```bash
git clone https://github.com/GISWLH/skills-dashboard.git
cd skills-dashboard
npm install
npm run dev
```

This opens the Electron desktop window. The app scans your local skill folders and loads remote catalogs on startup.

### Build a distributable

```bash
npm run dist
```

Produces a Windows NSIS installer under `release/`. The unpacked app is at:

```
release/win-unpacked/Agent Skills Dashboard.exe
```

---

## How to Use

### Local Board

1. Open the app — it scans all three runtimes automatically.
2. Use the **Collection** dropdown to filter to a single runtime.
3. Type in the **Search** box to filter by title, slug, or description.
4. Click **Open preview** on any card to see the full skill definition.
5. Hit **Refresh Local Board** after installing or editing skills outside the app.

### Cloud Explore

1. Click **Cloud Explore** at the top to switch panels.
2. All three catalogs load simultaneously, each in its own color-coded section.
3. Click **More From …** at the bottom of any section to expand it.
4. Set the **Install Target** dropdown to choose which local runtime to install into.
5. Click **Download** on any skill card to install it locally.

### Remote Install Notes

| Catalog | Install Method |
|---|---|
| ClawHub | Downloads the public zip package |
| Tencent SkillHub | Installs via the linked ClawHub page |
| Anthropic Skills | Recursively downloads the official GitHub skill directory |

No version pinning or cross-store deduplication yet — this is the first install cut.

---

## Project Structure

```
skills-dashboard/
├── electron/
│   ├── main.ts        # App lifecycle, BrowserWindow, IPC handlers
│   ├── preload.ts     # Context bridge — validates all IPC data
│   └── skills.ts      # Scan local folders, fetch remote catalogs, install skills
├── src/
│   ├── App.tsx        # Main React component — all UI and state
│   ├── shared/
│   │   └── contracts.ts   # Shared TypeScript types for IPC
│   └── App.css        # All styles
└── public/
    └── icon.png       # App icon
```

---

## Supported Skill Format

Each skill is a folder containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
---

Skill content here.
```

The dashboard reads the frontmatter for title, description, and version, and displays a preview excerpt from the body.

---

## License

MIT
