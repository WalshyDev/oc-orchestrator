export interface NotificationPrefs {
  needs_approval: boolean
  needs_input: boolean
  errored: boolean
  completed: boolean
}

export interface AppSettings {
  model: string
  editor: string
  customEditorCommand: string
  createPrPrompt: string
  notifications: NotificationPrefs
}

export const SETTINGS_STORAGE_KEY = 'oc-orchestrator:settings'

export const DEFAULT_CREATE_PR_PROMPT = `Prepare this work for review.

1. Check the current git branch. If it is not already a feature branch, create and switch to a sensible feature branch first.
2. Review the working tree, then create a concise but informative commit message. Do not list changed files in the commit message.
3. Commit the relevant changes.
4. Push the branch.
5. Open a pull request. Try GitHub with gh if the remote is GitHub, or GitLab with glab if the remote is GitLab.
6. If opening the PR with gh or glab does not work, that is fine - give me the PR URL if you can determine it, or the exact compare/create URL I should open manually.

Return the final PR URL or manual URL, plus a short note on what you committed.`

export const DEFAULT_SETTINGS: AppSettings = {
  model: 'auto',
  editor: 'vscode',
  customEditorCommand: '',
  createPrPrompt: DEFAULT_CREATE_PR_PROMPT,
  notifications: {
    needs_approval: true,
    needs_input: true,
    errored: true,
    completed: false,
  },
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!stored) return DEFAULT_SETTINGS

    const parsed = JSON.parse(stored) as Partial<AppSettings>

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      notifications: {
        ...DEFAULT_SETTINGS.notifications,
        ...(parsed.notifications ?? {}),
      },
      createPrPrompt: parsed.createPrPrompt?.trim() ? parsed.createPrPrompt : DEFAULT_CREATE_PR_PROMPT,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}
