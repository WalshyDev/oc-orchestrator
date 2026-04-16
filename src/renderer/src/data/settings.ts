export interface NotificationPrefs {
  needs_approval: boolean
  needs_input: boolean
  errored: boolean
  completed: boolean
}

export type QuickActionIcon =
  | 'git-pull-request'
  | 'rocket'
  | 'lightning'
  | 'terminal'
  | 'code'
  | 'check-circle'
  | 'paper-plane'
  | 'wrench'

export interface QuickAction {
  id: string
  label: string
  icon: QuickActionIcon
  prompt: string
}

export const MAX_QUICK_ACTIONS = 3

export interface AppSettings {
  model: string
  editor: string
  customEditorCommand: string
  terminal: string
  createPrPrompt: string
  quickActions: QuickAction[]
  notifications: NotificationPrefs
  verboseMode: boolean
  soundEnabled: boolean
}

export const SETTINGS_STORAGE_KEY = 'oc-orchestrator:settings'

export const DEFAULT_CREATE_PR_PROMPT = `Prepare this work for review.

1. Check the current git branch name. If it looks auto-generated (e.g. project/next-feature-1234567890 or project/some-slug-1234567890), rename it to something descriptive based on the actual changes, using the format "username/short-description" (e.g. "walshy/fix-agent-workflow-bug"). Use \`git branch -m <new-name>\` to rename before pushing. If the branch already has a sensible name, keep it.
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
  terminal: 'default',
  createPrPrompt: DEFAULT_CREATE_PR_PROMPT,
  quickActions: [],
  notifications: {
    needs_approval: true,
    needs_input: true,
    errored: true,
    completed: false,
  },
  verboseMode: false,
  soundEnabled: true,
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!stored) return DEFAULT_SETTINGS

    const parsed = JSON.parse(stored) as Partial<AppSettings>

    // Quick actions: take up to MAX_QUICK_ACTIONS, default to empty.
    // Existing users without quickActions simply get no custom buttons (PR is still static).
    const quickActions = Array.isArray(parsed.quickActions)
      ? parsed.quickActions.slice(0, MAX_QUICK_ACTIONS)
      : []

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      notifications: {
        ...DEFAULT_SETTINGS.notifications,
        ...(parsed.notifications ?? {}),
      },
      createPrPrompt: parsed.createPrPrompt?.trim() ? parsed.createPrPrompt : DEFAULT_CREATE_PR_PROMPT,
      quickActions,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function isQuickActionValid(qa: QuickAction): boolean {
  return Boolean(qa.label?.trim() && qa.prompt?.trim())
}

export const SETTINGS_CHANGED_EVENT = 'oc-orchestrator:settings-changed'

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
}
