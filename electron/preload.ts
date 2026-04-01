import { contextBridge, ipcRenderer } from 'electron'
import type {
  DashboardSettings,
  DashboardSnapshot,
  LocalSourceFilter,
  LocalSourceId,
  RemoteInstallRequest,
  RemoteInstallResult,
  RemoteSourceId,
  SkillRecord,
  SkillScope,
  SkillSourceSnapshot,
  SkillStats,
  SkillsDashboardApi,
  SourceId,
  SourceKind,
} from '../src/shared/contracts'

const sourceIds: SourceId[] = ['claude', 'codex', 'openclaw', 'tencent', 'clawhub', 'anthropic']
const localSourceIds: LocalSourceId[] = ['claude', 'codex', 'openclaw']
const remoteSourceIds: RemoteSourceId[] = ['tencent', 'clawhub', 'anthropic']
const sourceKinds: SourceKind[] = ['local', 'remote']
const skillScopes: SkillScope[] = ['personal', 'global', 'remote']

const api: SkillsDashboardApi = {
  getSnapshot: async () => validateDashboardSnapshot(await ipcRenderer.invoke('dashboard:get-snapshot')),
  refresh: async () => validateDashboardSnapshot(await ipcRenderer.invoke('dashboard:refresh')),
  updateSelectedSource: async (selectedSource) =>
    validateDashboardSettings(
      await ipcRenderer.invoke('dashboard:update-selected-source', selectedSource),
    ),
  installRemoteSkill: async (request) =>
    validateRemoteInstallResult(
      await ipcRenderer.invoke('dashboard:install-remote-skill', validateRemoteInstallRequest(request)),
    ),
}

contextBridge.exposeInMainWorld('skillsDashboard', api)

function validateDashboardSnapshot(value: unknown): DashboardSnapshot {
  if (!isRecord(value)) {
    throw new Error('Invalid dashboard snapshot payload.')
  }

  return {
    generatedAt: requireString(value.generatedAt, 'generatedAt'),
    settings: validateDashboardSettings(value.settings),
    sources: requireArray(value.sources, 'sources').map((entry) => validateSkillSource(entry)),
    skills: requireArray(value.skills, 'skills').map((entry) => validateSkillRecord(entry)),
  }
}

function validateDashboardSettings(value: unknown): DashboardSettings {
  if (!isRecord(value)) {
    throw new Error('Invalid dashboard settings payload.')
  }

  return {
    selectedSource: validateLocalSourceFilter(value.selectedSource),
  }
}

function validateSkillSource(value: unknown): SkillSourceSnapshot {
  if (!isRecord(value)) {
    throw new Error('Invalid skill source payload.')
  }

  const scopeCounts = requireRecord(value.scopeCounts, 'scopeCounts')

  return {
    id: validateSourceId(value.id),
    label: requireString(value.label, 'label'),
    kind: validateSourceKind(value.kind),
    paths: requireStringArray(value.paths, 'paths'),
    available: requireBoolean(value.available, 'available'),
    missingPaths: requireStringArray(value.missingPaths, 'missingPaths'),
    statusMessage: requireNullableString(value.statusMessage, 'statusMessage'),
    skillCount: requireNumber(value.skillCount, 'skillCount'),
    scopeCounts: {
      personal: requireNumber(scopeCounts.personal, 'scopeCounts.personal'),
      global: requireNumber(scopeCounts.global, 'scopeCounts.global'),
      remote: requireNumber(scopeCounts.remote, 'scopeCounts.remote'),
    },
  }
}

function validateSkillRecord(value: unknown): SkillRecord {
  if (!isRecord(value)) {
    throw new Error('Invalid skill record payload.')
  }

  return {
    id: requireString(value.id, 'id'),
    slug: requireString(value.slug, 'slug'),
    title: requireString(value.title, 'title'),
    description: requireString(value.description, 'description'),
    previewText: requireString(value.previewText, 'previewText'),
    sourceId: validateSourceId(value.sourceId),
    sourceLabel: requireString(value.sourceLabel, 'sourceLabel'),
    scope: validateSkillScope(value.scope),
    origin: validateSkillOrigin(value.origin),
    skillDir: requireNullableString(value.skillDir, 'skillDir'),
    skillMdPath: requireNullableString(value.skillMdPath, 'skillMdPath'),
    externalUrl: requireNullableString(value.externalUrl, 'externalUrl'),
    ownerName: requireNullableString(value.ownerName, 'ownerName'),
    version: requireNullableString(value.version, 'version'),
    lastModified: requireNullableString(value.lastModified, 'lastModified'),
    stats: validateSkillStats(value.stats),
  }
}

function validateRemoteInstallResult(value: unknown): RemoteInstallResult {
  if (!isRecord(value)) {
    throw new Error('Invalid remote install result payload.')
  }

  return {
    remoteSourceId: validateRemoteSourceId(value.remoteSourceId),
    slug: requireString(value.slug, 'slug'),
    targetSource: validateLocalSourceId(value.targetSource),
    installedPath: requireString(value.installedPath, 'installedPath'),
    folderName: requireString(value.folderName, 'folderName'),
    replacedExisting: requireBoolean(value.replacedExisting, 'replacedExisting'),
    message: requireString(value.message, 'message'),
  }
}

function validateRemoteInstallRequest(value: unknown): RemoteInstallRequest {
  if (!isRecord(value)) {
    throw new Error('Invalid remote install request payload.')
  }

  return {
    remoteSourceId: validateRemoteSourceId(value.remoteSourceId),
    slug: requireString(value.slug, 'slug'),
    title: requireString(value.title, 'title'),
    externalUrl: requireNullableString(value.externalUrl, 'externalUrl'),
    skillMdPath: requireNullableString(value.skillMdPath, 'skillMdPath'),
    targetSource: validateLocalSourceId(value.targetSource),
  }
}

function validateLocalSourceFilter(value: unknown): LocalSourceFilter {
  return value === 'all' ? 'all' : validateLocalSourceId(value)
}

function validateSourceId(value: unknown): SourceId {
  if (typeof value === 'string' && sourceIds.includes(value as SourceId)) {
    return value as SourceId
  }

  throw new Error('Invalid source identifier.')
}

function validateLocalSourceId(value: unknown): LocalSourceId {
  if (typeof value === 'string' && localSourceIds.includes(value as LocalSourceId)) {
    return value as LocalSourceId
  }

  throw new Error('Invalid local source identifier.')
}

function validateRemoteSourceId(value: unknown): RemoteSourceId {
  if (typeof value === 'string' && remoteSourceIds.includes(value as RemoteSourceId)) {
    return value as RemoteSourceId
  }

  throw new Error('Invalid remote source identifier.')
}

function validateSourceKind(value: unknown): SourceKind {
  if (typeof value === 'string' && sourceKinds.includes(value as SourceKind)) {
    return value as SourceKind
  }

  throw new Error('Invalid source kind.')
}

function validateSkillScope(value: unknown): SkillScope {
  if (typeof value === 'string' && skillScopes.includes(value as SkillScope)) {
    return value as SkillScope
  }

  throw new Error('Invalid skill scope.')
}

function validateSkillOrigin(value: unknown) {
  if (value === 'local' || value === 'remote') {
    return value
  }

  throw new Error('Invalid skill origin.')
}

function validateSkillStats(value: unknown): SkillStats {
  if (!isRecord(value)) {
    throw new Error('Invalid skill stats payload.')
  }

  return {
    downloads: requireNullableNumber(value.downloads, 'stats.downloads'),
    installs: requireNullableNumber(value.installs, 'stats.installs'),
    stars: requireNullableNumber(value.stars, 'stats.stars'),
  }
}

function requireArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array for ${fieldName}.`)
  }

  return value
}

function requireRecord(value: unknown, fieldName: string) {
  if (!isRecord(value)) {
    throw new Error(`Expected object for ${fieldName}.`)
  }

  return value
}

function requireStringArray(value: unknown, fieldName: string) {
  return requireArray(value, fieldName).map((entry, index) =>
    requireString(entry, `${fieldName}[${index}]`),
  )
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== 'string') {
    throw new Error(`Expected string for ${fieldName}.`)
  }

  return value
}

function requireNullableString(value: unknown, fieldName: string) {
  if (value === null) {
    return null
  }

  return requireString(value, fieldName)
}

function requireBoolean(value: unknown, fieldName: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean for ${fieldName}.`)
  }

  return value
}

function requireNumber(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Expected number for ${fieldName}.`)
  }

  return value
}

function requireNullableNumber(value: unknown, fieldName: string) {
  if (value === null) {
    return null
  }

  return requireNumber(value, fieldName)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
