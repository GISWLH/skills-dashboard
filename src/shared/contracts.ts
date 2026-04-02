export type LocalSourceId = 'claude' | 'codex' | 'openclaw'
export type RemoteSourceId = 'tencent' | 'clawhub' | 'anthropic'
export type SourceId = LocalSourceId | RemoteSourceId
export type LocalSourceFilter = LocalSourceId | 'all'
export type SkillScope = 'personal' | 'global' | 'remote'
export type SourceKind = 'local' | 'remote'
export type SkillOrigin = 'local' | 'remote'

export const localSourceOrder: LocalSourceId[] = ['claude', 'codex', 'openclaw']
export const remoteSourceOrder: RemoteSourceId[] = ['tencent', 'clawhub', 'anthropic']
export const sourceOrder: SourceId[] = [...localSourceOrder, ...remoteSourceOrder]

export interface SkillStats {
  downloads: number | null
  installs: number | null
  stars: number | null
}

export interface SkillRecord {
  id: string
  slug: string
  title: string
  description: string
  previewText: string
  sourceId: SourceId
  sourceLabel: string
  scope: SkillScope
  origin: SkillOrigin
  skillDir: string | null
  skillMdPath: string | null
  externalUrl: string | null
  ownerName: string | null
  version: string | null
  lastModified: string | null
  stats: SkillStats
}

export interface SkillSourceSnapshot {
  id: SourceId
  label: string
  kind: SourceKind
  paths: string[]
  available: boolean
  missingPaths: string[]
  statusMessage: string | null
  skillCount: number
  scopeCounts: Record<SkillScope, number>
}

export interface DashboardSettings {
  selectedSource: LocalSourceFilter
}

export interface DashboardSnapshot {
  generatedAt: string
  settings: DashboardSettings
  sources: SkillSourceSnapshot[]
  skills: SkillRecord[]
}

export interface RemoteInstallRequest {
  remoteSourceId: RemoteSourceId
  slug: string
  title: string
  externalUrl: string | null
  skillMdPath: string | null
  targetSource: LocalSourceId
}

export interface RemoteInstallResult {
  remoteSourceId: RemoteSourceId
  slug: string
  targetSource: LocalSourceId
  installedPath: string
  folderName: string
  replacedExisting: boolean
  message: string
}

export interface LocalSyncOperation {
  slug: string
  fromSource: LocalSourceId
  toSource: LocalSourceId
  sourcePath: string
  targetPath: string
}

export interface LocalSyncResult {
  syncedAt: string
  totalUniqueSkills: number
  createdFolders: number
  operations: LocalSyncOperation[]
  message: string
}

export interface SkillsDashboardApi {
  getSnapshot: () => Promise<DashboardSnapshot>
  refresh: () => Promise<DashboardSnapshot>
  updateSelectedSource: (selectedSource: LocalSourceFilter) => Promise<DashboardSettings>
  installRemoteSkill: (request: RemoteInstallRequest) => Promise<RemoteInstallResult>
  syncLocalSkills: () => Promise<LocalSyncResult>
}
