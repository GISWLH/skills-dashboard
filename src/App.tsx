import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import type {
  DashboardSnapshot,
  LocalSourceFilter,
  LocalSourceId,
  RemoteSourceId,
  SkillRecord,
  SkillSourceSnapshot,
} from './shared/contracts'
import { localSourceOrder, remoteSourceOrder } from './shared/contracts'

type PanelMode = 'local' | 'remote'

const bridgeError =
  'Electron desktop bridge is unavailable. Run the dashboard with `npm run dev` or launch the packaged app.'

function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>('local')
  const [selectedSource, setSelectedSource] = useState<LocalSourceFilter>('all')
  const [installTarget, setInstallTarget] = useState<LocalSourceId>('codex')
  const [previewSkillId, setPreviewSkillId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [remoteVisibleCounts, setRemoteVisibleCounts] = useState<Record<RemoteSourceId, number>>({
    tencent: 6,
    clawhub: 6,
    anthropic: 6,
  })
  const deferredQuery = useDeferredValue(searchQuery.trim().toLowerCase())
  const browseScrollRef = useRef(0)

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    const api = window.skillsDashboard
    if (!snapshot || !api || snapshot.settings.selectedSource === selectedSource) {
      return
    }

    void api.updateSelectedSource(selectedSource)
  }, [selectedSource, snapshot])

  useEffect(() => {
    if (!previewSkillId) {
      return
    }

    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [previewSkillId])

  useEffect(() => {
    if (!previewSkillId) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePreview()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewSkillId])

  useEffect(() => {
    if (!feedbackMessage) {
      return
    }

    const timeout = window.setTimeout(() => setFeedbackMessage(null), 4200)
    return () => window.clearTimeout(timeout)
  }, [feedbackMessage])

  const localSources = useMemo(
    () => snapshot?.sources.filter((source) => source.kind === 'local') ?? [],
    [snapshot],
  )
  const remoteSources = useMemo(
    () => snapshot?.sources.filter((source) => source.kind === 'remote') ?? [],
    [snapshot],
  )

  const visibleLocalSkills = useMemo(
    () => getVisibleLocalSkills(snapshot, selectedSource, deferredQuery),
    [snapshot, selectedSource, deferredQuery],
  )
  const remoteSkillsBySource = useMemo(
    () =>
      Object.fromEntries(
        remoteSourceOrder.map((sourceId) => [
          sourceId,
          getRemoteSkillsBySource(snapshot, sourceId, deferredQuery),
        ]),
      ) as Record<RemoteSourceId, SkillRecord[]>,
    [snapshot, deferredQuery],
  )

  const previewSkill = snapshot?.skills.find((skill) => skill.id === previewSkillId) ?? null
  const localSections = useMemo(
    () => buildLocalSections(visibleLocalSkills, localSources, selectedSource),
    [visibleLocalSkills, localSources, selectedSource],
  )

  const installedLocalCount = snapshot?.skills.filter((skill) => skill.origin === 'local').length ?? 0
  const availableLocalSources = localSources.filter((source) => source.available).length
  const remoteCatalogCount = snapshot?.skills.filter((skill) => skill.origin === 'remote').length ?? 0
  const availableRemoteSources = remoteSources.filter((source) => source.available).length

  async function bootstrap() {
    const api = window.skillsDashboard
    if (!api) {
      setErrorMessage(bridgeError)
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setErrorMessage(null)
      const nextSnapshot = await api.getSnapshot()
      setSnapshot(nextSnapshot)
      setSelectedSource(nextSnapshot.settings.selectedSource)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleRefresh() {
    const api = window.skillsDashboard
    if (!api) {
      setErrorMessage(bridgeError)
      return
    }

    try {
      setIsRefreshing(true)
      setErrorMessage(null)
      const nextSnapshot = await api.refresh()
      setSnapshot(nextSnapshot)
      setSelectedSource(nextSnapshot.settings.selectedSource)
      setFeedbackMessage(panelMode === 'local' ? '本地看板已刷新。' : '云端目录已刷新。')
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleRemoteInstall(skill: SkillRecord) {
    const api = window.skillsDashboard
    if (!api || skill.origin !== 'remote') {
      setErrorMessage(bridgeError)
      return
    }

    try {
      setInstallingSkillId(skill.id)
      setErrorMessage(null)

      const result = await api.installRemoteSkill({
        remoteSourceId: skill.sourceId as RemoteSourceId,
        slug: skill.slug,
        title: skill.title,
        externalUrl: skill.externalUrl,
        skillMdPath: skill.skillMdPath,
        targetSource: installTarget,
      })

      const nextSnapshot = await api.getSnapshot()
      setSnapshot(nextSnapshot)
      setFeedbackMessage(result.message)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setInstallingSkillId(null)
    }
  }

  function handleSourceChange(nextSource: LocalSourceFilter) {
    startTransition(() => {
      setSelectedSource(nextSource)
    })
  }

  function handleMoreRemote(nextSource: RemoteSourceId) {
    setRemoteVisibleCounts((current) => ({
      ...current,
      [nextSource]: (current[nextSource] ?? 6) + 6,
    }))
  }

  function openPreview(skillId: string) {
    browseScrollRef.current = window.scrollY
    setPreviewSkillId(skillId)
  }

  function closePreview() {
    setPreviewSkillId(null)
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: browseScrollRef.current, behavior: 'auto' })
    })
  }

  return (
    <div className="app-shell">
      <div className="bg-orbit bg-orbit-a" />
      <div className="bg-orbit bg-orbit-b" />

      <header className="masthead">
        <div className="eyebrow-row">
          <span className="eyebrow">Windows Desktop Index</span>
          <span className="eyebrow muted">
            {panelMode === 'local' ? 'Local Board' : 'Cloud Explore'}
          </span>
        </div>

        <div className="masthead-grid">
          <div className="masthead-copy">
            <p className="kicker">Quick review your skills</p>
            <h1>Agent Skills Dashboard</h1>
            <p className="summary">
              {panelMode === 'local'
                ? 'Browse Claude Code, CodeX, and OpenClaw skills in one local board. This first cut only scans your machine and keeps every skill mapped back to its real folder.'
                : 'Explore public skill repositories in a separate cloud panel. Main catalogs are color-coded, expandable, and can download directly into one of your local skill folders.'}
            </p>
          </div>

          <div className="signal-panel">
            {panelMode === 'local' ? (
              <>
                <div className="signal-card">
                  <span className="signal-label">Installed skills</span>
                  <strong>{installedLocalCount}</strong>
                </div>
                <div className="signal-card">
                  <span className="signal-label">Visible cards</span>
                  <strong>{visibleLocalSkills.length}</strong>
                </div>
                <div className="signal-card">
                  <span className="signal-label">Sources online</span>
                  <strong>{availableLocalSources}</strong>
                </div>
                <div className="signal-card">
                  <span className="signal-label">Selected collection</span>
                  <strong>{selectedSource === 'all' ? 'ALL' : selectedSource}</strong>
                </div>
              </>
            ) : (
              <>
                <div className="signal-card">
                  <span className="signal-label">Cloud skills</span>
                  <strong>{remoteCatalogCount}</strong>
                </div>
                <div className="signal-card">
                  <span className="signal-label">Repositories</span>
                  <strong>{remoteSources.length}</strong>
                </div>
                <div className="signal-card">
                  <span className="signal-label">Sources online</span>
                  <strong>{availableRemoteSources}</strong>
                </div>
                <div className="signal-card">
                  <span className="signal-label">Install target</span>
                  <strong>{installTarget}</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mode-switch" aria-label="panel mode">
        <button
          className={`mode-chip ${panelMode === 'local' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setPanelMode('local')}
        >
          Local Board
        </button>
        <button
          className={`mode-chip ${panelMode === 'remote' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setPanelMode('remote')}
        >
          Cloud Explore
        </button>
      </section>

      <section className="command-bar">
        {panelMode === 'local' ? (
          <label className="field">
            <span>Collection</span>
            <select
              value={selectedSource}
              onChange={(event) => handleSourceChange(event.target.value as LocalSourceFilter)}
            >
              <option value="all">All Skills</option>
              <option value="claude">Claude Code</option>
              <option value="codex">CodeX</option>
              <option value="openclaw">OpenClaw</option>
            </select>
          </label>
        ) : (
          <>
            <label className="field">
              <span>Install Target</span>
              <select
                value={installTarget}
                onChange={(event) => setInstallTarget(event.target.value as LocalSourceId)}
              >
                <option value="claude">Claude Code</option>
                <option value="codex">CodeX</option>
                <option value="openclaw">OpenClaw</option>
              </select>
            </label>
          </>
        )}

        <label className="field grow">
          <span>Search</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={
              panelMode === 'local'
                ? 'Find by title, slug, summary, or content'
                : 'Find cloud skills by title, slug, owner, or summary'
            }
          />
        </label>

        <button
          className="refresh-button"
          type="button"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing
            ? 'Refreshing...'
            : panelMode === 'local'
              ? 'Refresh Local Board'
              : 'Refresh Cloud Catalogs'}
        </button>
      </section>

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
      {feedbackMessage ? <div className="feedback-banner">{feedbackMessage}</div> : null}

      {previewSkillId ? (
        <main className="preview-stage">
          <button className="back-button" type="button" onClick={closePreview}>
            Back To Board
          </button>

          {previewSkill ? (
            <article className="preview-page">
              <div className="preview-hero">
                <div className="preview-hero-copy">
                  <p className="section-kicker">Preview Page</p>
                  <h2>{previewSkill.title}</h2>
                  <p className="preview-summary">{previewSkill.description}</p>
                </div>

                <div className="preview-actions">
                  <div className="detail-pills">
                    <span className={`badge badge-${previewSkill.sourceId}`}>{previewSkill.sourceLabel}</span>
                    <span className="badge badge-scope">{previewSkill.scope}</span>
                  </div>

                  {previewSkill.origin === 'remote' ? (
                    <button
                      className="download-button"
                      type="button"
                      onClick={() => void handleRemoteInstall(previewSkill)}
                      disabled={installingSkillId === previewSkill.id}
                    >
                      {installingSkillId === previewSkill.id
                        ? 'Downloading...'
                        : `Download To ${installTarget}`}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="preview-meta-grid">
                {getPreviewMetaCards(previewSkill).map((item) => (
                  <article className="meta-card" key={item.label}>
                    <span className="meta-label">{item.label}</span>
                    {item.tone === 'strong' ? (
                      <strong>{item.value}</strong>
                    ) : (
                      <code>{item.value}</code>
                    )}
                  </article>
                ))}
              </div>

              <section className="preview-pane">
                <div className="preview-pane-header">
                  <div>
                    <p className="section-kicker">
                      {previewSkill.origin === 'local' ? 'Local Snapshot' : 'Remote Snapshot'}
                    </p>
                    <h3>Preview Excerpt</h3>
                  </div>
                  <span className="preview-note">
                    {previewSkill.origin === 'local' ? 'SKILL.md excerpt' : 'Catalog excerpt'}
                  </span>
                </div>

                <pre className="preview-text">{previewSkill.previewText}</pre>
              </section>
            </article>
          ) : (
            <div className="empty-state detail-empty">
              The selected skill is no longer available in the latest scan.
            </div>
          )}
        </main>
      ) : (
        <main className="browse-stage">
          {panelMode === 'local' ? (
            <>
              <section className="source-strip" aria-label="local source status">
                {localSources.map((source) => (
                  <article
                    className={`source-card ${source.available ? 'is-available' : 'is-missing'}`}
                    key={source.id}
                  >
                    <div className="source-card-header">
                      <div>
                        <p className="source-name">{source.label}</p>
                        <p className="source-meta">{formatSourceMeta(source)}</p>
                      </div>
                      <span className="status-pill">{getSourceStatusLabel(source)}</span>
                    </div>

                    <div className="path-list">
                      {source.paths.map((sourcePath) => (
                        <code key={sourcePath}>{sourcePath}</code>
                      ))}
                    </div>

                    {source.missingPaths.length > 0 ? (
                      <p className="source-warning">
                        Missing: {source.missingPaths.join(' / ')}
                      </p>
                    ) : null}
                  </article>
                ))}
              </section>

              <section className="board">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">Local overview</p>
                    <h2>Installed skills</h2>
                  </div>
                  <p className="section-note">
                    {snapshot?.generatedAt
                      ? `Last scan ${formatTime(snapshot.generatedAt)}`
                      : 'Waiting for first scan'}
                  </p>
                </div>

                {isLoading ? (
                  <div className="empty-state">Scanning local folders...</div>
                ) : visibleLocalSkills.length === 0 ? (
                  <div className="empty-state">
                    No matching local skills were found in the selected collection.
                  </div>
                ) : (
                  <div className="section-stack">
                    {localSections.map((section) => (
                      <section className="skill-section" key={section.id}>
                        <div className="skill-section-header">
                          <div>
                            <p className="section-kicker">{section.label}</p>
                            <h3>{section.skills.length} cards</h3>
                          </div>
                          <p className="section-note">{formatSectionMeta(section.skills)}</p>
                        </div>

                        <div className="skills-grid">
                          {section.skills.map((skill) => (
                            <article className="skill-card" key={skill.id}>
                              <div className="skill-card-top">
                                <span className={`badge badge-${skill.sourceId}`}>{skill.sourceLabel}</span>
                                <span className="badge badge-scope">{skill.scope}</span>
                              </div>
                              <h3>{skill.title}</h3>
                              <p className="skill-description">{skill.description}</p>
                              <div className="skill-card-meta">
                                <span>{formatTime(skill.lastModified)}</span>
                              </div>
                              <div className="skill-card-footer">
                                <code>{skill.slug}</code>
                                <button
                                  className="card-link"
                                  type="button"
                                  onClick={() => openPreview(skill.id)}
                                >
                                  Open preview
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="cloud-stage">
              {remoteSources.map((source) => {
                const sourceId = source.id as RemoteSourceId
                const sourceSkills = remoteSkillsBySource[sourceId] ?? []
                const visibleLimit = remoteVisibleCounts[sourceId] ?? 6
                const visibleCards = sourceSkills.slice(0, visibleLimit)

                return (
                  <section className={`cloud-repo cloud-repo-${sourceId}`} key={sourceId}>
                    <div className="cloud-repo-header">
                      <div className="cloud-repo-title">
                        <p className="section-kicker">Remote Repository</p>
                        <h2>{source.label}</h2>
                        {source.statusMessage ? (
                          <p className="repo-description">{source.statusMessage}</p>
                        ) : null}
                      </div>
                      <div className="cloud-repo-meta">
                        <span className="status-pill">{source.available ? 'online' : 'offline'}</span>
                        <span className="repo-skill-count">{sourceSkills.length} skills</span>
                      </div>
                    </div>

                    {isLoading ? (
                      <div className="empty-state">Loading catalog...</div>
                    ) : sourceSkills.length === 0 ? (
                      <div className="empty-state">
                        {source.available
                          ? 'No matching skills found in this catalog.'
                          : 'This catalog is currently offline.'}
                      </div>
                    ) : (
                      <>
                        <div className="skills-grid">
                          {visibleCards.map((skill) => (
                            <article className="skill-card remote-card" key={skill.id}>
                              <div className="skill-card-top">
                                <span className={`badge badge-${skill.sourceId}`}>{skill.sourceLabel}</span>
                                <span className="badge badge-scope">
                                  {skill.version ? `v${skill.version}` : 'remote'}
                                </span>
                              </div>
                              <h3>{skill.title}</h3>
                              <p className="skill-description">{skill.description}</p>
                              <div className="skill-card-meta">
                                <span>{skill.ownerName || 'Unknown owner'}</span>
                                <span>{formatSkillStats(skill) || 'No public stats'}</span>
                              </div>
                              <div className="skill-card-footer">
                                <button
                                  className="card-link"
                                  type="button"
                                  onClick={() => openPreview(skill.id)}
                                >
                                  Open preview
                                </button>
                                <button
                                  className="download-button"
                                  type="button"
                                  onClick={() => void handleRemoteInstall(skill)}
                                  disabled={installingSkillId === skill.id}
                                >
                                  {installingSkillId === skill.id ? 'Downloading...' : 'Download'}
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>

                        {visibleCards.length < sourceSkills.length ? (
                          <div className="more-row">
                            <button
                              className="more-button"
                              type="button"
                              onClick={() => handleMoreRemote(sourceId)}
                            >
                              More From {source.label}
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </main>
      )}
    </div>
  )
}

function getVisibleLocalSkills(
  snapshot: DashboardSnapshot | null,
  selectedSource: LocalSourceFilter,
  query: string,
) {
  if (!snapshot) {
    return []
  }

  return snapshot.skills.filter((skill) => {
    if (skill.origin !== 'local') {
      return false
    }

    if (selectedSource !== 'all' && skill.sourceId !== selectedSource) {
      return false
    }

    if (!query) {
      return true
    }

    const searchable = `${skill.title} ${skill.slug} ${skill.description} ${skill.previewText}`.toLowerCase()
    return searchable.includes(query)
  })
}

function getRemoteSkillsBySource(
  snapshot: DashboardSnapshot | null,
  sourceId: RemoteSourceId,
  query: string,
) {
  if (!snapshot) {
    return []
  }

  return snapshot.skills.filter((skill) => {
    if (skill.origin !== 'remote' || skill.sourceId !== sourceId) {
      return false
    }

    if (!query) {
      return true
    }

    const searchable =
      `${skill.title} ${skill.slug} ${skill.description} ${skill.previewText} ${skill.ownerName ?? ''}`.toLowerCase()
    return searchable.includes(query)
  })
}

function buildLocalSections(
  skills: SkillRecord[],
  sources: SkillSourceSnapshot[],
  selectedSource: LocalSourceFilter,
) {
  const activeOrder =
    selectedSource === 'all'
      ? localSourceOrder
      : localSourceOrder.filter((sourceId) => sourceId === selectedSource)

  return activeOrder
    .map((sourceId) => {
      const source = sources.find((entry) => entry.id === sourceId)
      return {
        id: sourceId,
        label: source?.label ?? sourceId,
        skills: skills.filter((skill) => skill.sourceId === sourceId),
      }
    })
    .filter((section) => section.skills.length > 0)
}

function formatSourceMeta(source: SkillSourceSnapshot) {
  const counts = [
    source.scopeCounts.personal > 0 ? `${source.scopeCounts.personal} personal` : '',
    source.scopeCounts.global > 0 ? `${source.scopeCounts.global} global` : '',
  ].filter(Boolean)

  return `${source.skillCount} skills${counts.length > 0 ? ` / ${counts.join(' / ')}` : ''}`
}

function getSourceStatusLabel(source: SkillSourceSnapshot) {
  if (source.available) {
    return 'online'
  }

  return source.kind === 'remote' ? 'offline' : 'missing'
}

function formatSectionMeta(skills: SkillRecord[]) {
  const counts = [
    skills.filter((skill) => skill.scope === 'personal').length,
    skills.filter((skill) => skill.scope === 'global').length,
  ]

  return [counts[0] > 0 ? `${counts[0]} personal` : '', counts[1] > 0 ? `${counts[1]} global` : '']
    .filter(Boolean)
    .join(' / ')
}

function getPreviewMetaCards(skill: SkillRecord) {
  const cards = [
    { label: 'Slug', value: skill.slug, tone: 'code' as const },
    { label: 'Updated', value: formatTime(skill.lastModified), tone: 'strong' as const },
    skill.origin === 'local'
      ? { label: 'Folder', value: skill.skillDir || 'Local folder unavailable', tone: 'code' as const }
      : { label: 'Owner', value: skill.ownerName || 'Unknown', tone: 'strong' as const },
    skill.origin === 'local'
      ? { label: 'Definition', value: skill.skillMdPath || 'SKILL.md unavailable', tone: 'code' as const }
      : {
          label: 'Catalog',
          value: skill.externalUrl || skill.skillMdPath || 'Remote page unavailable',
          tone: 'code' as const,
        },
  ]

  if (skill.origin === 'remote' && skill.version) {
    cards.splice(2, 0, { label: 'Version', value: skill.version, tone: 'strong' as const })
  }

  if (skill.origin === 'remote' && hasAnyStats(skill)) {
    cards.push({ label: 'Stats', value: formatSkillStats(skill), tone: 'strong' as const })
  }

  return cards
}

function hasAnyStats(skill: SkillRecord) {
  return skill.stats.downloads !== null || skill.stats.installs !== null || skill.stats.stars !== null
}

function formatSkillStats(skill: SkillRecord) {
  const segments = [
    skill.stats.downloads !== null ? `${skill.stats.downloads.toLocaleString('en-US')} downloads` : '',
    skill.stats.installs !== null ? `${skill.stats.installs.toLocaleString('en-US')} installs` : '',
    skill.stats.stars !== null ? `${skill.stats.stars.toLocaleString('en-US')} stars` : '',
  ].filter(Boolean)

  return segments.join(' / ')
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'An unknown error occurred while refreshing the dashboard.'
}

function formatTime(value: string | null) {
  if (!value) {
    return 'Unknown'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default App
