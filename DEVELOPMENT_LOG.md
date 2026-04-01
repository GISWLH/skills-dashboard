# Development Log

## 2026-04-01 - Split Local Board And Cloud Explore

### Goal

Stop mixing public repositories into the same browsing panel as local skills.

The dashboard now has two clearly separated modes:

1. Local Board
2. Cloud Explore

This was required because the earlier mixed view made the source dropdown
confusing and made the product feel like one giant merged catalog, which is not
the intended UX.

### UI Restructure

The main renderer was reworked so local and remote browsing no longer share the
same filter flow.

Local Board now contains:

- only installed/local skills
- only local source filters:
  - `all`
  - `claude`
  - `codex`
  - `openclaw`
- the local source status strip
- grouped local skill sections

Cloud Explore now contains:

- only remote/public skills
- a dedicated repository selector
- top repository cards for:
  - Tencent SkillHub
  - ClawHub
  - Anthropic Skills
- per-repository color styling
- `More` expansion for the selected repository
- per-card `Download`

So the remote catalogs are no longer in the same dropdown as the local board.

### Remote Install MVP

Remote installation is now part of the desktop app.

The current install target is explicit in the cloud panel. The user can choose:

- Claude Code
- CodeX
- OpenClaw

The install writes into the corresponding local skill root:

- `~/.claude/skills`
- `~/.codex/skills`
- `~/.openclaw/skills`

### Install Strategy By Source

The three public sources do not expose the same install shape, so the first
implementation uses different strategies:

- ClawHub
  - Downloads the public zip package from the site's exposed download endpoint
  - Extracts the package
  - Copies the skill folder into the selected local target

- Tencent SkillHub
  - Tencent currently behaves as a public catalog layer for featured skills
  - In the observed feed, entries point to ClawHub skill pages
  - So the current installer supports Tencent entries when their homepage maps
    to a ClawHub download path

- Anthropic Skills
  - Uses GitHub's official contents API
  - Recursively downloads the target `skills/<slug>/` directory
  - Writes the files into the selected local skill root

### Safe Install Behavior

The installer avoids blindly overwriting unrelated local folders.

Current behavior:

- if the target folder does not exist, install there directly
- if the folder exists but was previously installed by this dashboard for the
  same remote source and slug, replace it
- otherwise install into a suffixed folder such as `skill-name-1`

An install manifest file is written into the installed folder so later
re-downloads of the same remote skill can safely replace the prior dashboard
install.

### Why The Split Matters

This is not only a visual preference. The split also reduces logic coupling:

- local preview remains grounded in on-disk folders
- cloud preview can focus on repository metadata and remote excerpts
- install actions are now only shown where they make sense
- the local source dropdown is again trustworthy and predictable

### Verification

Verified with:

- `npm run build`
- `npm run lint`

## 2026-04-01 - Remote Source Catalogs

### Goal

Add remote catalog browsing without waiting for remote installation support.

The dashboard should be able to merge remote public sources into the same UI as
local skills, while preserving where each skill comes from.

### Added Remote Sources

The current build adds three remote catalogs:

1. Tencent SkillHub
2. ClawHub
3. Anthropic Skills

### Current Fetch Strategy

This implementation is intentionally pragmatic rather than fully exhaustive:

- Tencent SkillHub:
  - Uses Tencent's live frontend-discovered backend at `https://lightmake.site`
  - Fetches the featured Top 50 feed from `/api/skills/top`
- ClawHub:
  - Uses the public Convex backend exposed by the live site
  - Fetches the top 100 public non-suspicious skills via `skills:listPublicPageV4`
- Anthropic Skills:
  - Uses GitHub's official contents API for directory listing
  - Fetches each remote `SKILL.md` from `raw.githubusercontent.com`
  - Covers the full official `skills/` directory

### Why This Shape

Tencent SkillHub and ClawHub are large public registries. Pulling the entire
remote corpus into the desktop app on every refresh would be unnecessarily
heavy for a first implementation.

So the remote MVP uses:

- curated/featured feed for Tencent
- top public catalog slice for ClawHub
- full official repo for Anthropic because it is small enough

This keeps startup and refresh cost reasonable while still making remote source
discovery useful.

### Data Model Changes

The shared contracts were extended to support both local and remote records:

- new source IDs for `tencent`, `clawhub`, and `anthropic`
- source kind: `local` or `remote`
- skill origin: `local` or `remote`
- new `remote` scope
- optional remote metadata:
  - external URL
  - owner name
  - version
  - stats

### UI Changes

The dashboard UI was updated to reflect the mixed catalog model:

- filter dropdown now includes the three remote sources
- masthead no longer claims the app is local-only
- top counters now show `Local` and `Remote` instead of `Personal` and `Global`
- source cards can show remote status messages
- preview cards now adapt to local vs remote metadata

### Important Limitation

Remote browsing is now supported, but remote installation is still not part of
this implementation.

The current version is for:

- catalog discovery
- unified search
- source-aware preview

It is not yet for:

- one-click remote install
- remote update tracking
- remote version pinning
- deduplicating the same skill across multiple remote storefronts

### Verification

Verified with:

- `npm run build`
- `npm run lint`

## 2026-03-31 - Local Chinese Skill Summary Initialization

### Goal

Add a local initialization pass so each skill card can show a short Chinese
description that answers one practical question:

`这个 skill 大概是做什么的？`

This is used for the small card summary and for the preview header summary.

### Short Answer

This feature does **not** rely on network search.

This feature does **not** call any external LLM, translation API, or online
service.

It is generated **locally** from the skill's own files on disk by deterministic
rules.

### What It Depends On

The implementation currently depends on:

- Node local filesystem access via `node:fs`
- local path handling via `node:path`
- YAML frontmatter parsing via the local `yaml` npm package
- the existing Electron main-process skill scan

No online retrieval, no remote repository access, and no background model call
is used in this first version.

### Where It Runs

The logic runs in the Electron main-process scanner:

- [electron/skills.ts](/D:/Onedrive/GitHub/skills-dashboard/electron/skills.ts)

It is part of the normal snapshot refresh path:

1. `getDashboardSnapshot()`
2. `scanInstalledSkills()`
3. `scanSource()`
4. `scanRoot()`
5. `scanSkillDirectory()`
6. `buildChineseCardDescription()`

So the summary is regenerated:

- on first desktop load
- on manual refresh
- whenever local skill files change and the user refreshes again

### Files It Reads

For each skill folder, the scanner reads:

1. `SKILL.md`
2. a small number of top-level support files in the same folder

The current support file selection is intentionally conservative:

- `README*`
- other top-level `.md`
- top-level `.txt`
- `package.json`

The scanner does **not** recurse through the entire skill directory for summary
generation. It only samples a few top-level files, to keep startup cost
predictable.

### Generation Pipeline

The generation path is:

1. Parse `SKILL.md` frontmatter.
2. Extract candidate summary signals from:
   - frontmatter `description`
   - first meaningful paragraph in `SKILL.md`
   - intent-like sentences such as `Use when`, `This skill`, `用于`, `适用于`, `当用户需要`
   - first meaningful paragraph from a few support files
   - `package.json.description` and a few `package.json.keywords`
3. Normalize and deduplicate those signals.
4. Try Chinese-first extraction.
5. If Chinese extraction fails, fall back to English keyword classification.
6. If both fail, return a generic Chinese fallback sentence.

### Chinese-First Extraction

If the source material already contains Chinese, the system prefers to keep and
reuse that Chinese directly instead of rephrasing it through any external tool.

The Chinese-first path does this:

1. Split candidate text into rough sentences.
2. Keep only sentences containing Chinese characters.
3. Drop obvious command-like lines such as `ssh`, `npm`, `python`, headings, or
   shell snippets.
4. Keep the first 1-2 meaningful sentences.
5. Truncate them to a card-friendly length.

This works especially well for skills whose `SKILL.md` already includes Chinese
descriptions or bilingual frontmatter.

### English Fallback Generation

If the scanner cannot find usable Chinese text, it does not use machine
translation.

Instead, it uses a local rule-based classifier:

1. Scan the collected English text for action keywords:
   - `search`
   - `download`
   - `analyze`
   - `generate`
   - `translate`
   - `extract`
   - `deploy`
   - `monitor`
   - `manage`
   - `connect`
   - and similar terms
2. Scan for domain keywords:
   - papers / arXiv
   - frontend / React / HTML / CSS
   - SSH / remote / NAS / server
   - images / OCR / vision
   - experiments / training / GPU
   - markdown / docx / LaTeX / slides / poster
   - visualization / Mermaid
   - notifications / WeChat / Feishu
   - Obsidian / vault / canvas
3. Scan for concrete targets:
   - `arXiv`
   - `SSH`
   - `PDF`
   - `Markdown`
   - `React`
   - `Obsidian`
   - `Feishu`
   - `WandB`
   - and similar identifiers
4. Combine the matches into a short Chinese template sentence.

Typical output style:

- `用于搜索和下载学术论文相关任务。`
- `用于生成前端界面相关任务。重点覆盖 React 和 HTML/CSS 场景。`
- `用于连接和管理远程主机相关任务。重点覆盖 SSH 场景。`

### Final Fallback

If the skill files are too sparse, malformed, or mostly non-descriptive, the
system falls back to a generic sentence based on the title or folder name:

- `用于处理 Remote SSH 相关任务。`

This avoids empty cards even when the source files are weak.

### Why This Version Is Local-Only

The local-only design was chosen for the first iteration because it is:

- predictable
- fast to debug
- easy to ship in a Windows desktop app
- independent of API keys or network conditions
- cheap to run at every refresh

It also keeps the behavior transparent. A summary comes from files that already
exist in the skill folder, not from an opaque remote service.

### Current Limitations

This first version is intentionally simple, so it has limits:

- It is rule-based, not semantic reasoning.
- It may miss subtle intent in long English descriptions.
- It may produce summaries that are accurate but too generic.
- It only samples a few top-level files, not the whole repository.
- It does not currently persist a separate summary cache on disk.

### Future Upgrade Paths

Possible next steps:

- add an explicit `Initialize Summaries` button
- cache generated summaries locally in JSON
- allow manual override per skill
- prefer a dedicated `summary_zh` field if the skill author provides one
- add an optional LLM-enhanced mode later, behind a clear switch

### Important Implementation Note

This summary system is **automatic** and **derived from the skill content**.

It is not hand-written per skill, and it is not fetched from the internet.

The result is therefore only as good as the source material inside the skill
folder plus the local rule set in [electron/skills.ts](/D:/Onedrive/GitHub/skills-dashboard/electron/skills.ts).
