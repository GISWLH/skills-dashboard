/// <reference types="vite/client" />

import type { SkillsDashboardApi } from './shared/contracts'

declare global {
  interface Window {
    skillsDashboard?: SkillsDashboardApi
  }
}

export {}
