import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import YAML from 'yaml'
import { sourceOrder } from '../src/shared/contracts'
import type {
  DashboardSettings,
  DashboardSnapshot,
  LocalSourceFilter,
  LocalSourceId,
  RemoteInstallRequest,
  RemoteInstallResult,
  RemoteSourceId,
  SkillRecord,
  SkillStats,
  SkillScope,
  SkillSourceSnapshot,
} from '../src/shared/contracts'

interface ScanRoot {
  path: string
  scope: SkillScope
  skipHiddenChildren: boolean
}

interface LocalSourceDefinition {
  id: LocalSourceId
  label: string
  displayPaths: string[]
  roots: ScanRoot[]
}

interface RemoteSourceDefinition {
  id: RemoteSourceId
  label: string
  paths: string[]
  statusMessage: string | null
  fetchSkills: () => Promise<SkillRecord[]>
}

interface ParsedSkillMatter {
  body: string
  name: string | undefined
  description: string | undefined
}

interface DashboardInstallManifest {
  installedAt: string
  installedBy: 'agent-skills-dashboard'
  remoteSourceId: RemoteSourceId
  slug: string
  externalUrl: string | null
}

interface GitHubContentEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url: string | null
  html_url: string
  url: string
}

const execFileAsync = promisify(execFile)
const installManifestFileName = '.agent-skills-dashboard.json'

const defaultSettings: DashboardSettings = {
  selectedSource: 'all',
}

function getLocalSourceDefinitions(): LocalSourceDefinition[] {
  const home = homedir()

  return [
    {
      id: 'claude',
      label: 'Claude Code',
      displayPaths: [path.join(home, '.claude', 'skills')],
      roots: [
        {
          path: path.join(home, '.claude', 'skills'),
          scope: 'personal',
          skipHiddenChildren: true,
        },
      ],
    },
    {
      id: 'codex',
      label: 'CodeX',
      displayPaths: [
        path.join(home, '.codex', 'skills'),
        path.join(home, '.codex', 'skills', '.system'),
      ],
      roots: [
        {
          path: path.join(home, '.codex', 'skills'),
          scope: 'personal',
          skipHiddenChildren: true,
        },
        {
          path: path.join(home, '.codex', 'skills', '.system'),
          scope: 'global',
          skipHiddenChildren: true,
        },
      ],
    },
    {
      id: 'openclaw',
      label: 'OpenClaw',
      displayPaths: [path.join(home, '.openclaw', 'skills')],
      roots: [
        {
          path: path.join(home, '.openclaw', 'skills'),
          scope: 'personal',
          skipHiddenChildren: true,
        },
      ],
    },
  ]
}

function getRemoteSourceDefinitions(): RemoteSourceDefinition[] {
  return [
    {
      id: 'tencent',
      label: 'Tencent SkillHub',
      paths: ['https://skillhub.tencent.com/#featured'],
      statusMessage: 'Remote featured feed',
      fetchSkills: fetchTencentRemoteSkills,
    },
    {
      id: 'clawhub',
      label: 'ClawHub',
      paths: ['https://clawhub.ai/skills?nonSuspicious=true'],
      statusMessage: 'Remote public catalog',
      fetchSkills: fetchClawHubRemoteSkills,
    },
    {
      id: 'anthropic',
      label: 'Anthropic Skills',
      paths: ['https://github.com/anthropics/skills/tree/main/skills'],
      statusMessage: 'Official GitHub repository',
      fetchSkills: fetchAnthropicRemoteSkills,
    },
  ]
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const settings = await readSettings()
  const scanned = await scanInstalledSkills()

  return {
    generatedAt: new Date().toISOString(),
    settings,
    sources: scanned.sources,
    skills: scanned.skills,
  }
}

export async function updateSelectedSource(selectedSource: LocalSourceFilter) {
  const nextSettings: DashboardSettings = {
    selectedSource: normalizeSourceFilter(selectedSource),
  }

  await writeSettings(nextSettings)
  return nextSettings
}

export async function installRemoteSkill(
  request: RemoteInstallRequest,
): Promise<RemoteInstallResult> {
  const stagingPath = path.join(tmpdir(), `agent-skills-dashboard-${crypto.randomUUID()}`)
  const targetRoot = getInstallTargetRoot(request.targetSource)

  await fs.mkdir(stagingPath, { recursive: true })

  try {
    switch (request.remoteSourceId) {
      case 'anthropic':
        await downloadAnthropicSkillToDirectory(request.slug, stagingPath)
        break
      case 'clawhub':
        await downloadClawHubSkillZipToDirectory(request.slug, stagingPath)
        break
      case 'tencent':
        await downloadTencentSkillToDirectory(request, stagingPath)
        break
      default:
        throw new Error('Unsupported remote source.')
    }

    const skillRoot = await resolveInstalledSkillRoot(stagingPath)
    const desiredFolderName =
      sanitizeFolderName(request.slug) || sanitizeFolderName(request.title) || 'remote-skill'
    const installLocation = await resolveInstallLocation(
      targetRoot,
      desiredFolderName,
      request.remoteSourceId,
      request.slug,
    )

    await fs.mkdir(targetRoot, { recursive: true })

    if (installLocation.replacedExisting) {
      await fs.rm(installLocation.installedPath, { recursive: true, force: true })
    }

    await fs.cp(skillRoot, installLocation.installedPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    })

    const manifest: DashboardInstallManifest = {
      installedAt: new Date().toISOString(),
      installedBy: 'agent-skills-dashboard',
      remoteSourceId: request.remoteSourceId,
      slug: request.slug,
      externalUrl: request.externalUrl,
    }

    await fs.writeFile(
      path.join(installLocation.installedPath, installManifestFileName),
      JSON.stringify(manifest, null, 2),
      'utf8',
    )

    return {
      remoteSourceId: request.remoteSourceId,
      slug: request.slug,
      targetSource: request.targetSource,
      installedPath: installLocation.installedPath,
      folderName: installLocation.folderName,
      replacedExisting: installLocation.replacedExisting,
      message:
        installLocation.folderName === desiredFolderName
          ? `Installed into ${installLocation.installedPath}`
          : `Installed into ${installLocation.installedPath} because ${desiredFolderName} already existed`,
    }
  } finally {
    await fs.rm(stagingPath, { recursive: true, force: true })
  }
}

async function scanInstalledSkills() {
  const [localResults, remoteResults] = await Promise.all([
    Promise.all(getLocalSourceDefinitions().map(async (sourceDefinition) => scanLocalSource(sourceDefinition))),
    Promise.all(getRemoteSourceDefinitions().map(async (sourceDefinition) => scanRemoteSource(sourceDefinition))),
  ])

  const sourceResults = [...localResults, ...remoteResults]

  const sources = sourceResults.map((result) => result.source)
  const skills = sourceResults
    .flatMap((result) => result.skills)
    .sort(compareSkills)

  return { sources, skills }
}

async function scanLocalSource(sourceDefinition: LocalSourceDefinition) {
  const rootResults = await Promise.all(
    sourceDefinition.roots.map(async (root) => scanRoot(sourceDefinition, root)),
  )

  const skills = rootResults.flatMap((result) => result.skills)
  const source: SkillSourceSnapshot = {
    id: sourceDefinition.id,
    label: sourceDefinition.label,
    kind: 'local',
    paths: sourceDefinition.displayPaths,
    available: rootResults.some((result) => result.exists),
    missingPaths: rootResults.filter((result) => !result.exists).map((result) => result.path),
    statusMessage: null,
    skillCount: skills.length,
    scopeCounts: {
      personal: skills.filter((skill) => skill.scope === 'personal').length,
      global: skills.filter((skill) => skill.scope === 'global').length,
      remote: 0,
    },
  }

  return { source, skills }
}

async function scanRemoteSource(sourceDefinition: RemoteSourceDefinition) {
  try {
    const skills = await sourceDefinition.fetchSkills()
    const source: SkillSourceSnapshot = {
      id: sourceDefinition.id,
      label: sourceDefinition.label,
      kind: 'remote',
      paths: sourceDefinition.paths,
      available: true,
      missingPaths: [],
      statusMessage: sourceDefinition.statusMessage,
      skillCount: skills.length,
      scopeCounts: {
        personal: 0,
        global: 0,
        remote: skills.length,
      },
    }

    return { source, skills }
  } catch (error) {
    const source: SkillSourceSnapshot = {
      id: sourceDefinition.id,
      label: sourceDefinition.label,
      kind: 'remote',
      paths: sourceDefinition.paths,
      available: false,
      missingPaths: [],
      statusMessage: getScanErrorMessage(error),
      skillCount: 0,
      scopeCounts: {
        personal: 0,
        global: 0,
        remote: 0,
      },
    }

    return { source, skills: [] as SkillRecord[] }
  }
}

async function scanRoot(sourceDefinition: LocalSourceDefinition, root: ScanRoot) {
  const exists = await pathExists(root.path)
  if (!exists) {
    return {
      path: root.path,
      exists: false,
      skills: [] as SkillRecord[],
    }
  }

  const entries = await fs.readdir(root.path, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => isSkillDirectoryName(entry.name, root))

  const scannedSkills = await Promise.all(
    directories.map(async (entry) =>
      scanSkillDirectory(sourceDefinition, root.scope, path.join(root.path, entry.name), entry.name),
    ),
  )

  return {
    path: root.path,
    exists: true,
    skills: scannedSkills.filter((skill): skill is SkillRecord => skill !== null),
  }
}

async function scanSkillDirectory(
  sourceDefinition: LocalSourceDefinition,
  scope: SkillScope,
  skillDir: string,
  folderName: string,
): Promise<SkillRecord | null> {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!(await pathExists(skillMdPath))) {
    return null
  }

  const contents = sanitizeSourceText(await fs.readFile(skillMdPath, 'utf8'))
  const stats = await fs.stat(skillMdPath)
  const parsed = parseSkillMatter(contents)
  const description = await buildChineseCardDescription(skillDir, parsed, folderName)

  return {
    id: `${sourceDefinition.id}:${scope}:${folderName}`,
    slug: folderName,
    title: formatTitle(parsed.name || folderName),
    description,
    previewText: buildPreviewText(parsed.body),
    sourceId: sourceDefinition.id,
    sourceLabel: sourceDefinition.label,
    scope,
    origin: 'local',
    skillDir,
    skillMdPath,
    externalUrl: null,
    ownerName: null,
    version: null,
    lastModified: stats.mtime.toISOString(),
    stats: createEmptySkillStats(),
  } satisfies SkillRecord
}

async function fetchTencentRemoteSkills() {
  const response = await fetchJson<{
    code: number
    data?: {
      skills?: Array<{
        category?: string
        description?: string
        description_zh?: string
        downloads?: number
        homepage?: string
        installs?: number
        name?: string
        ownerName?: string
        slug?: string
        stars?: number
        updated_at?: number
        version?: string
      }>
    }
    message?: string
  }>('https://lightmake.site/api/skills/top')

  if (response.code !== 0) {
    throw new Error(response.message || 'Tencent SkillHub API returned an error.')
  }

  return (response.data?.skills ?? [])
    .filter((skill) => typeof skill.slug === 'string' && typeof skill.name === 'string')
    .map((skill) => {
      const englishDescription = sanitizeSourceText(skill.description || '')
      const chineseDescription = sanitizeSourceText(skill.description_zh || '')
      const title = sanitizeSourceText(skill.name || skill.slug || 'Unnamed skill')
      const description =
        truncateLine(chineseDescription, 180) ||
        buildChineseDescriptionFromSignals(
          [englishDescription, chineseDescription, skill.category],
          title,
        )
      const previewText = buildPreviewText(
        [
          chineseDescription,
          englishDescription,
          skill.category ? `Category: ${skill.category}` : '',
          skill.version ? `Version: ${skill.version}` : '',
          skill.homepage ? `Homepage: ${skill.homepage}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      )

      return {
        id: `tencent:remote:${skill.slug}`,
        slug: skill.slug || title,
        title: formatTitle(title),
        description,
        previewText,
        sourceId: 'tencent',
        sourceLabel: 'Tencent SkillHub',
        scope: 'remote',
        origin: 'remote',
        skillDir: null,
        skillMdPath: null,
        externalUrl: skill.homepage || null,
        ownerName: skill.ownerName || null,
        version: skill.version || null,
        lastModified: toIsoTimestamp(skill.updated_at),
        stats: {
          downloads: normalizeOptionalNumber(skill.downloads),
          installs: normalizeOptionalNumber(skill.installs),
          stars: normalizeOptionalNumber(skill.stars),
        },
      } satisfies SkillRecord
    })
}

async function fetchClawHubRemoteSkills() {
  const response = await fetchJson<{
    status: string
    value?: {
      page?: Array<{
        ownerHandle?: string | null
        owner?: {
          displayName?: string
          handle?: string
        } | null
        latestVersion?: {
          version?: string
          changelog?: string
          createdAt?: number
        } | null
        skill?: {
          slug?: string
          displayName?: string
          summary?: string
          updatedAt?: number
          stats?: {
            downloads?: number
            installsAllTime?: number
            stars?: number
          } | null
        } | null
      }>
    }
  }>('https://wry-manatee-359.convex.cloud/api/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'skills:listPublicPageV4',
      args: {
        numItems: 100,
        sort: 'downloads',
        dir: 'desc',
        highlightedOnly: false,
        nonSuspiciousOnly: true,
      },
    }),
  })

  if (response.status !== 'success') {
    throw new Error('ClawHub public query returned an error.')
  }

  return (response.value?.page ?? [])
    .filter((entry) => entry.skill?.slug)
    .map((entry) => {
      const skill = entry.skill
      const latestVersion = entry.latestVersion
      const ownerHandle = entry.ownerHandle || entry.owner?.handle || null
      const ownerName = sanitizeSourceText(
        entry.owner?.displayName || ownerHandle || '',
      )
      const title = sanitizeSourceText(skill?.displayName || skill?.slug || 'Unnamed skill')
      const summary = sanitizeSourceText(skill?.summary || '')
      const changelog = sanitizeSourceText(latestVersion?.changelog || '')
      const externalUrl =
        ownerHandle && skill?.slug ? `https://clawhub.ai/${ownerHandle}/${skill.slug}` : null

      return {
        id: `clawhub:remote:${ownerHandle || 'unknown'}:${skill?.slug}`,
        slug: skill?.slug || title,
        title: formatTitle(title),
        description: buildChineseDescriptionFromSignals([summary, changelog], title),
        previewText: buildPreviewText(
          [
            summary,
            changelog ? `Latest changelog:\n${changelog}` : '',
            externalUrl ? `Catalog page: ${externalUrl}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        ),
        sourceId: 'clawhub',
        sourceLabel: 'ClawHub',
        scope: 'remote',
        origin: 'remote',
        skillDir: null,
        skillMdPath: null,
        externalUrl,
        ownerName: ownerName || null,
        version: latestVersion?.version || null,
        lastModified: toIsoTimestamp(skill?.updatedAt ?? latestVersion?.createdAt),
        stats: {
          downloads: normalizeOptionalNumber(skill?.stats?.downloads),
          installs: normalizeOptionalNumber(skill?.stats?.installsAllTime),
          stars: normalizeOptionalNumber(skill?.stats?.stars),
        },
      } satisfies SkillRecord
    })
}

async function fetchAnthropicRemoteSkills() {
  const directoryEntries = await fetchJson<
    Array<{
      name: string
      path: string
      type: string
      html_url: string
    }>
  >('https://api.github.com/repos/anthropics/skills/contents/skills?ref=main', {
    headers: {
      'User-Agent': 'agent-skills-dashboard',
      Accept: 'application/vnd.github+json',
    },
  })

  const skillDirectories = directoryEntries.filter((entry) => entry.type === 'dir')

  const remoteSkills = await Promise.all(
    skillDirectories.map(async (entry) => {
      const rawSkillUrl = `https://raw.githubusercontent.com/anthropics/skills/main/${entry.path}/SKILL.md`
      const contents = sanitizeSourceText(
        await fetchText(rawSkillUrl, {
          headers: {
            'User-Agent': 'agent-skills-dashboard',
          },
        }),
      )
      const parsed = parseSkillMatter(contents)
      const title = formatTitle(parsed.name || entry.name)
      const description = buildChineseDescriptionFromSignals(
        [parsed.description, extractDescription(parsed.body), extractIntentSentence(parsed.body)],
        title,
      )

      return {
        id: `anthropic:remote:${entry.name}`,
        slug: entry.name,
        title,
        description,
        previewText: buildPreviewText(parsed.body),
        sourceId: 'anthropic',
        sourceLabel: 'Anthropic Skills',
        scope: 'remote',
        origin: 'remote',
        skillDir: null,
        skillMdPath: rawSkillUrl,
        externalUrl: entry.html_url,
        ownerName: 'Anthropic',
        version: null,
        lastModified: null,
        stats: createEmptySkillStats(),
      } satisfies SkillRecord
    }),
  )

  return remoteSkills
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}: ${url}`)
  }

  return (await response.json()) as T
}

async function fetchText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}: ${url}`)
  }

  return response.text()
}

function parseSkillMatter(contents: string): ParsedSkillMatter {
  const lines = contents.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return {
      body: contents,
      name: undefined,
      description: undefined,
    }
  }

  let closingIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      closingIndex = index
      break
    }
  }

  if (closingIndex === -1) {
    return {
      body: contents,
      name: undefined,
      description: undefined,
    }
  }

  const frontmatterBlock = lines.slice(1, closingIndex).join('\n')
  let data: Record<string, unknown> = {}

  try {
    const parsedYaml = YAML.parse(frontmatterBlock)
    data = isRecord(parsedYaml) ? parsedYaml : {}
  } catch {
    data = {}
  }

  return {
    body: lines.slice(closingIndex + 1).join('\n'),
    name: getOptionalMatterField(data.name),
    description: truncateDescriptionField(data.description),
  }
}

async function buildChineseCardDescription(
  skillDir: string,
  parsed: ParsedSkillMatter,
  folderName: string,
) {
  const signals = await collectSummarySignals(skillDir, parsed)
  return buildChineseDescriptionFromSignals(signals, formatTitle(parsed.name || folderName))
}

async function collectSummarySignals(skillDir: string, parsed: ParsedSkillMatter) {
  const rootSupportSignals = await readSummarySupportSignals(skillDir)

  return dedupeSignals([
    parsed.description,
    extractDescription(parsed.body),
    extractIntentSentence(parsed.body),
    ...rootSupportSignals,
  ])
}

async function readSummarySupportSignals(skillDir: string) {
  try {
    const entries = await fs.readdir(skillDir, { withFileTypes: true })
    const supportFiles = entries
      .filter((entry) => entry.isFile())
      .filter((entry) => isSummarySupportFile(entry.name))
      .sort((left, right) => compareSummarySupportFiles(left.name, right.name))
      .slice(0, 3)

    const signals = await Promise.all(
      supportFiles.map(async (entry) =>
        extractSummarySignalFromFile(path.join(skillDir, entry.name), entry.name),
      ),
    )

    return signals.filter((signal): signal is string => Boolean(signal))
  } catch {
    return []
  }
}

async function extractSummarySignalFromFile(filePath: string, fileName: string) {
  const normalizedName = fileName.toLowerCase()

  try {
    if (normalizedName === 'package.json') {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) {
        return ''
      }

      const description =
        typeof parsed.description === 'string' ? sanitizeSourceText(parsed.description).trim() : ''
      const keywords = Array.isArray(parsed.keywords)
        ? parsed.keywords
            .filter((keyword): keyword is string => typeof keyword === 'string')
            .map((keyword) => sanitizeSourceText(keyword))
            .slice(0, 5)
        : []

      return [description, keywords.length > 0 ? keywords.join(', ') : '']
        .filter(Boolean)
        .join('. ')
    }

    const raw = sanitizeSourceText(await fs.readFile(filePath, 'utf8'))
    return extractDescription(raw)
  } catch {
    return ''
  }
}

function isSummarySupportFile(fileName: string) {
  const normalized = fileName.toLowerCase()

  if (normalized === 'skill.md') {
    return false
  }

  if (normalized.startsWith('license') || normalized.startsWith('changelog')) {
    return false
  }

  return (
    normalized === 'package.json' ||
    normalized.startsWith('readme') ||
    normalized.endsWith('.md') ||
    normalized.endsWith('.txt')
  )
}

function compareSummarySupportFiles(left: string, right: string) {
  return getSummarySupportFilePriority(left) - getSummarySupportFilePriority(right)
}

function getSummarySupportFilePriority(fileName: string) {
  const normalized = fileName.toLowerCase()

  if (normalized.startsWith('readme')) {
    return 0
  }

  if (normalized === 'package.json') {
    return 1
  }

  if (normalized.endsWith('.md')) {
    return 2
  }

  if (normalized.endsWith('.txt')) {
    return 3
  }

  return 4
}

function dedupeSignals(signals: Array<string | undefined>) {
  const seen = new Set<string>()

  return signals
    .map((signal) => normalizeSignal(signal))
    .filter((signal): signal is string => Boolean(signal))
    .filter((signal) => {
      const fingerprint = signal.toLowerCase()
      if (seen.has(fingerprint)) {
        return false
      }

      seen.add(fingerprint)
      return true
    })
}

function normalizeSignal(value: string | undefined) {
  if (!value) {
    return ''
  }

  return sanitizeSourceText(value)
    .replace(/\r\n/g, '\n')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeSourceText(value: string) {
  return value
    .replace(/鈫\?/g, '→ ')
    .replace(/鈫/g, '→')
    .replace(/鈥\?/g, ' - ')
    .replace(/鈥/g, '-')
}

function buildChineseSummaryFromSignals(signals: string[]) {
  const chineseSummary = extractChineseSummary(signals)
  if (chineseSummary) {
    return chineseSummary
  }

  const englishSummary = buildKeywordBasedChineseSummary(signals.join(' '))
  if (englishSummary) {
    return englishSummary
  }

  return ''
}

function buildChineseDescriptionFromSignals(
  signals: Array<string | undefined>,
  fallbackTitle: string,
) {
  const normalizedSignals = dedupeSignals(signals)
  const chineseSummary = buildChineseSummaryFromSignals(normalizedSignals)
  if (chineseSummary) {
    return chineseSummary
  }

  return `用于处理 ${formatTitle(fallbackTitle)} 相关任务。`
}

function createEmptySkillStats(): SkillStats {
  return {
    downloads: null,
    installs: null,
    stars: null,
  }
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toIsoTimestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const milliseconds = value > 1e12 ? value : value * 1000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function getScanErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown source error.'
}

function extractChineseSummary(signals: string[]) {
  const chineseSentences = signals
    .flatMap((signal) => splitIntoSentences(signal))
    .map((sentence) => normalizeChineseSentence(sentence))
    .filter((sentence) => containsChinese(sentence))
    .filter((sentence) => sentence.length >= 8)
    .filter((sentence) => !looksLikeCommandSentence(sentence))

  if (chineseSentences.length === 0) {
    return ''
  }

  const distinctSentences: string[] = []
  for (const sentence of chineseSentences) {
    if (!distinctSentences.some((existing) => existing === sentence)) {
      distinctSentences.push(sentence)
    }
  }

  return distinctSentences
    .slice(0, 2)
    .map((sentence) => truncateChineseSentence(sentence, 44))
    .join('')
}

function buildKeywordBasedChineseSummary(sourceText: string) {
  const normalized = normalizeSignal(sourceText)
  if (!normalized) {
    return ''
  }

  const actions = collectMatchedLabels(normalized, [
    { label: '搜索', patterns: [/\bsearch\b/i, /\bquery\b/i, /\bfind\b/i, /\blookup\b/i, /\bdiscover\b/i] },
    { label: '下载', patterns: [/\bdownload\b/i, /\bfetch\b/i, /\bretrieve\b/i] },
    { label: '总结', patterns: [/\bsummar(?:ize|ise)\b/i, /\bdigest\b/i] },
    { label: '分析', patterns: [/\banaly(?:ze|se)\b/i, /\binspect\b/i, /\bprofile\b/i, /\bbenchmark\b/i] },
    { label: '生成', patterns: [/\bgenerate\b/i, /\bcreate\b/i, /\bbuild\b/i, /\bproduce\b/i] },
    { label: '编写', patterns: [/\bwrite\b/i, /\bdraft\b/i, /\bauthor\b/i] },
    { label: '编辑', patterns: [/\bedit\b/i, /\bmodify\b/i, /\brevise\b/i, /\bpolish\b/i] },
    { label: '翻译', patterns: [/\btranslate\b/i] },
    { label: '提取', patterns: [/\bextract\b/i] },
    { label: '转换', patterns: [/\bconvert\b/i, /\btransform\b/i] },
    { label: '安装', patterns: [/\binstall\b/i, /\bsetup\b/i] },
    { label: '部署', patterns: [/\bdeploy\b/i, /\blaunch\b/i] },
    { label: '运行', patterns: [/\brun\b/i, /\bexecute\b/i] },
    { label: '监控', patterns: [/\bmonitor\b/i, /\btrack\b/i, /\bcheck\b/i] },
    { label: '管理', patterns: [/\bmanage\b/i, /\bmaintain\b/i, /\borganize\b/i] },
    { label: '通知', patterns: [/\bnotify\b/i, /\bsend\b/i, /\bpush\b/i, /\bpublish\b/i] },
    { label: '连接', patterns: [/\bconnect\b/i, /\bssh\b/i, /remote access/i] },
    { label: '上传', patterns: [/\bupload\b/i] },
    { label: '读取', patterns: [/\bread\b/i, /\bparse\b/i] },
  ]).slice(0, 3)

  const domains = collectMatchedLabels(normalized, [
    { label: '学术论文', patterns: [/\bpaper\b/i, /\barxiv\b/i, /\bliterature\b/i, /\bcitation\b/i] },
    { label: '前端界面', patterns: [/\bfrontend\b/i, /\breact\b/i, /\bhtml\b/i, /\bcss\b/i, /\bui\b/i, /landing page/i, /\bdashboard\b/i, /\bcomponent\b/i] },
    { label: '远程主机', patterns: [/\bssh\b/i, /\bserver\b/i, /\bhost\b/i, /\bremote\b/i, /\bnas\b/i, /\bscp\b/i] },
    { label: '图像与视觉内容', patterns: [/\bimage\b/i, /\bvideo\b/i, /\bvision\b/i, /\bocr\b/i, /\bsegmentation\b/i, /\bdetection\b/i] },
    { label: '实验与训练流程', patterns: [/\bexperiment\b/i, /\btraining\b/i, /\bwandb\b/i, /\bgpu\b/i, /\bmodel\b/i, /\bbenchmark\b/i] },
    { label: '文档与论文写作', patterns: [/\bmarkdown\b/i, /\bdocx\b/i, /\bslides\b/i, /\bposter\b/i, /\bgrant\b/i, /\bproposal\b/i, /\blatex\b/i] },
    { label: '图表与可视化', patterns: [/\bfigure\b/i, /\bplot\b/i, /\bchart\b/i, /\bdiagram\b/i, /\bmermaid\b/i, /\bvisualization\b/i] },
    { label: '通知与发布', patterns: [/\bemail\b/i, /\bwechat\b/i, /\bfeishu\b/i, /\btelegram\b/i, /\bdiscord\b/i, /\bpublish\b/i] },
    { label: '笔记与知识库', patterns: [/\bobsidian\b/i, /\bvault\b/i, /\bcanvas\b/i, /\bwikilink\b/i] },
    { label: '数据与文件处理', patterns: [/\bjson\b/i, /\bcsv\b/i, /\bpdf\b/i, /\bfile\b/i, /\bdataset\b/i] },
    { label: '本地技能与工具链', patterns: [/\bskill\b/i, /\bworkflow\b/i, /\btool\b/i] },
  ]).slice(0, 1)

  const targets = collectMatchedLabels(normalized, [
    { label: 'arXiv', patterns: [/\barxiv\b/i] },
    { label: 'SSH', patterns: [/\bssh\b/i] },
    { label: 'PDF', patterns: [/\bpdf\b/i] },
    { label: 'Markdown', patterns: [/\bmarkdown\b/i] },
    { label: 'React', patterns: [/\breact\b/i] },
    { label: 'HTML/CSS', patterns: [/\bhtml\b/i, /\bcss\b/i] },
    { label: 'Obsidian', patterns: [/\bobsidian\b/i] },
    { label: 'WeChat', patterns: [/\bwechat\b/i] },
    { label: 'Feishu', patterns: [/\bfeishu\b/i] },
    { label: 'WandB', patterns: [/\bwandb\b/i] },
    { label: 'Zotero', patterns: [/\bzotero\b/i] },
    { label: 'Google Workspace', patterns: [/\bgmail\b/i, /\bcalendar\b/i, /\bdrive\b/i, /\bgoogle workspace\b/i] },
    { label: 'Mermaid', patterns: [/\bmermaid\b/i] },
    { label: 'LaTeX', patterns: [/\blatex\b/i] },
    { label: 'Bilibili', patterns: [/\bbilibili\b/i] },
  ]).slice(0, 4)

  const sentences: string[] = []
  const actionText = joinLabels(actions, '和')
  const domainText = joinLabels(domains, '与')

  if (actionText && domainText) {
    sentences.push(`用于${actionText}${domainText}相关任务。`)
  } else if (actionText) {
    sentences.push(`用于${actionText}相关任务。`)
  } else if (domainText) {
    sentences.push(`用于处理${domainText}相关任务。`)
  }

  if (targets.length > 0) {
    sentences.push(`重点覆盖 ${joinLabels(targets, '和')} 场景。`)
  }

  return sentences
    .map((sentence) => truncateChineseSentence(sentence, 44))
    .join('')
}

function collectMatchedLabels(
  sourceText: string,
  rules: Array<{ label: string; patterns: RegExp[] }>,
) {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(sourceText)))
    .map((rule) => rule.label)
}

function joinLabels(values: string[], lastJoiner: string) {
  if (values.length === 0) {
    return ''
  }

  if (values.length === 1) {
    return values[0]
  }

  if (values.length === 2) {
    return `${values[0]}${lastJoiner}${values[1]}`
  }

  return `${values.slice(0, -1).join('、')}${lastJoiner}${values.at(-1)}`
}

function splitIntoSentences(value: string) {
  return value
    .split(/(?<=[。！？!?])\s*|(?<=[.])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function normalizeChineseSentence(value: string) {
  return ensureChinesePeriod(
    value
      .replace(/^[-*+]\s*/, '')
      .replace(/^#+\s*/, '')
      .replace(/^>\s?/, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function ensureChinesePeriod(value: string) {
  if (!value) {
    return ''
  }

  return /[。！？!?]$/.test(value) ? value : `${value}。`
}

function containsChinese(value: string) {
  return getMeaningfulChineseCharacterCount(value) >= 2
}

function getMeaningfulChineseCharacterCount(value: string) {
  const mojibakeCharacters = new Set(['鈫', '鈥', '銆', '锛', '锟', '馃'])

  return [...value].filter((character) => {
    if (!/[\u4e00-\u9fff]/.test(character)) {
      return false
    }

    return !mojibakeCharacters.has(character)
  }).length
}

function looksLikeCommandSentence(value: string) {
  return /^(?:Use:|Current hosts:|ssh |scp |python |npm |pip |##|###)/i.test(value)
}

function truncateChineseSentence(value: string, limit: number) {
  const normalized = value.trim()
  if (normalized.length <= limit) {
    return normalized
  }

  const truncated = normalized.slice(0, limit - 1).trimEnd()
  return ensureChinesePeriod(truncated.replace(/[。！？!?]$/, ''))
}

function extractIntentSentence(body: string) {
  const normalized = normalizeSignal(body)
  if (!normalized) {
    return ''
  }

  const matches = normalized.match(
    /(?:Use when|This skill|Supports?|适用于|用于|当用户需要|当用户要求)(.*?)(?:[。！？.!?]|$)/i,
  )

  return matches?.[0]?.trim() ?? ''
}

function extractDescription(body: string) {
  const lines = body.split(/\r?\n/)
  const paragraph: string[] = []
  let insideCodeBlock = false

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (line.startsWith('```')) {
      insideCodeBlock = !insideCodeBlock
      continue
    }

    if (insideCodeBlock) {
      continue
    }

    if (!line) {
      if (paragraph.length > 0) {
        break
      }

      continue
    }

    if (line.startsWith('#') || line === '---' || /^(?:[-*+]|\d+\.)\s/.test(line)) {
      continue
    }

    paragraph.push(line.replace(/^>\s?/, ''))
  }

  if (paragraph.length === 0) {
    return ''
  }

  return truncateLine(paragraph.join(' '), 180)
}

function buildPreviewText(body: string) {
  const cleaned = body
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!cleaned) {
    return 'No preview content available.'
  }

  const limit = 5000
  if (cleaned.length <= limit) {
    return cleaned
  }

  return `${cleaned.slice(0, limit).trimEnd()}\n\n...`
}

function stripWrappingQuotes(value: string) {
  const match = value.match(/^(['"])(.*)\1$/)
  return match ? match[2] : value
}

function truncateLine(value: string, limit: number) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= limit) {
    return singleLine
  }

  return `${singleLine.slice(0, limit - 1).trimEnd()}...`
}

function formatTitle(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function compareSkills(left: SkillRecord, right: SkillRecord) {
  const sourceDelta = sourceOrder.indexOf(left.sourceId) - sourceOrder.indexOf(right.sourceId)
  if (sourceDelta !== 0) {
    return sourceDelta
  }

  if (left.scope !== right.scope) {
    return getScopeOrder(left.scope) - getScopeOrder(right.scope)
  }

  return left.title.localeCompare(right.title, 'en', {
    numeric: true,
    sensitivity: 'base',
  })
}

function getScopeOrder(scope: SkillScope) {
  switch (scope) {
    case 'personal':
      return 0
    case 'global':
      return 1
    case 'remote':
      return 2
    default:
      return 3
  }
}

function isSkillDirectoryName(name: string, root: ScanRoot) {
  if (root.skipHiddenChildren && name.startsWith('.')) {
    return false
  }

  return name !== 'dist' && name !== 'node_modules'
}

function normalizeSourceFilter(selectedSource: LocalSourceFilter | string): LocalSourceFilter {
  return selectedSource === 'claude' ||
    selectedSource === 'codex' ||
    selectedSource === 'openclaw'
    ? selectedSource
    : 'all'
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readSettings(): Promise<DashboardSettings> {
  const settingsPath = getSettingsPath()

  try {
    const raw = await fs.readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return {
      selectedSource: normalizeSourceFilter(
        isRecord(parsed) && typeof parsed.selectedSource === 'string'
          ? parsed.selectedSource
          : 'all',
      ),
    }
  } catch {
    return defaultSettings
  }
}

async function writeSettings(settings: DashboardSettings) {
  const settingsPath = getSettingsPath()
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'dashboard-settings.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getOptionalMatterField(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = stripWrappingQuotes(value.trim())
  return normalized || undefined
}

function truncateDescriptionField(value: unknown) {
  const normalized = getOptionalMatterField(value)
  return normalized ? truncateLine(normalized, 180) : undefined
}

function getInstallTargetRoot(targetSource: LocalSourceId) {
  const home = homedir()

  switch (targetSource) {
    case 'claude':
      return path.join(home, '.claude', 'skills')
    case 'codex':
      return path.join(home, '.codex', 'skills')
    case 'openclaw':
      return path.join(home, '.openclaw', 'skills')
    default:
      return path.join(home, '.codex', 'skills')
  }
}

function sanitizeFolderName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function resolveInstallLocation(
  targetRoot: string,
  desiredFolderName: string,
  remoteSourceId: RemoteSourceId,
  slug: string,
) {
  const primaryPath = path.join(targetRoot, desiredFolderName)
  const replacePrimary = await directoryMatchesInstallManifest(primaryPath, remoteSourceId, slug)

  if (!(await pathExists(primaryPath)) || replacePrimary) {
    return {
      folderName: desiredFolderName,
      installedPath: primaryPath,
      replacedExisting: replacePrimary,
    }
  }

  let suffix = 1
  while (true) {
    const folderName = `${desiredFolderName}-${suffix}`
    const installedPath = path.join(targetRoot, folderName)

    if (!(await pathExists(installedPath))) {
      return {
        folderName,
        installedPath,
        replacedExisting: false,
      }
    }

    suffix += 1
  }
}

async function directoryMatchesInstallManifest(
  targetPath: string,
  remoteSourceId: RemoteSourceId,
  slug: string,
) {
  if (!(await pathExists(targetPath))) {
    return false
  }

  const manifestPath = path.join(targetPath, installManifestFileName)
  if (!(await pathExists(manifestPath))) {
    return false
  }

  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    return (
      isRecord(parsed) &&
      parsed.installedBy === 'agent-skills-dashboard' &&
      parsed.remoteSourceId === remoteSourceId &&
      parsed.slug === slug
    )
  } catch {
    return false
  }
}

async function downloadClawHubSkillZipToDirectory(slug: string, destinationPath: string) {
  const zipPath = path.join(tmpdir(), `agent-skills-dashboard-${crypto.randomUUID()}.zip`)

  try {
    await downloadFile(
      `https://wry-manatee-359.convex.site/api/v1/download?slug=${encodeURIComponent(slug)}`,
      zipPath,
    )
    await extractZipArchive(zipPath, destinationPath)
  } finally {
    await fs.rm(zipPath, { force: true })
  }
}

async function downloadTencentSkillToDirectory(
  request: RemoteInstallRequest,
  destinationPath: string,
) {
  if (request.externalUrl && isClawHubUrl(request.externalUrl)) {
    await downloadClawHubSkillZipToDirectory(request.slug, destinationPath)
    return
  }

  throw new Error('Tencent SkillHub item does not expose a supported direct download source yet.')
}

async function downloadAnthropicSkillToDirectory(slug: string, destinationPath: string) {
  await downloadGitHubDirectory(
    `https://api.github.com/repos/anthropics/skills/contents/skills/${encodeURIComponent(
      slug,
    )}?ref=main`,
    destinationPath,
  )
}

async function downloadGitHubDirectory(apiUrl: string, destinationPath: string) {
  const entries = await fetchJson<GitHubContentEntry[]>(apiUrl, {
    headers: getGitHubHeaders(),
  })

  await fs.mkdir(destinationPath, { recursive: true })

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(destinationPath, entry.name)

      if (entry.type === 'dir') {
        await downloadGitHubDirectory(entry.url, entryPath)
        return
      }

      if (!entry.download_url) {
        throw new Error(`GitHub file ${entry.path} does not have a download URL.`)
      }

      const buffer = await fetchBuffer(entry.download_url, {
        headers: getGitHubHeaders(),
      })
      await fs.writeFile(entryPath, buffer)
    }),
  )
}

async function resolveInstalledSkillRoot(stagingPath: string) {
  if (await pathExists(path.join(stagingPath, 'SKILL.md'))) {
    return stagingPath
  }

  const entries = await fs.readdir(stagingPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const candidate = path.join(stagingPath, entry.name)
    if (await pathExists(path.join(candidate, 'SKILL.md'))) {
      return candidate
    }
  }

  throw new Error('Downloaded skill package does not contain SKILL.md at the expected location.')
}

async function extractZipArchive(zipPath: string, destinationPath: string) {
  await fs.mkdir(destinationPath, { recursive: true })

  if (process.platform === 'win32') {
    const command = `Expand-Archive -LiteralPath ${toPowerShellLiteral(
      zipPath,
    )} -DestinationPath ${toPowerShellLiteral(destinationPath)} -Force`

    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
    })
    return
  }

  await execFileAsync('tar', ['-xf', zipPath, '-C', destinationPath], {
    windowsHide: true,
  })
}

function toPowerShellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

async function downloadFile(url: string, destinationPath: string) {
  const buffer = await fetchBuffer(url)
  await fs.writeFile(destinationPath, buffer)
}

async function fetchBuffer(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}: ${url}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

function getGitHubHeaders() {
  return {
    'User-Agent': 'agent-skills-dashboard',
    Accept: 'application/vnd.github+json',
  }
}

function isClawHubUrl(value: string) {
  try {
    return new URL(value).hostname === 'clawhub.ai'
  } catch {
    return false
  }
}
