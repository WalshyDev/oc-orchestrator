import { ArrowLineUpRight, GitMerge, GitPullRequest, GitlabLogo, GithubLogo, PencilSimple, Trash } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

type PrHost = 'github' | 'gitlab'

interface PrInfo {
  host: PrHost
  owner: string
  repo: string
  number: string
}

export interface PrTooltipActions {
  onOpen?: () => void
  onEdit?: () => void
  onRemove?: () => void
}

const hostMeta: Record<PrHost, { icon: ReactNode; label: string }> = {
  github: { icon: <GithubLogo size={12} weight="bold" />, label: 'GitHub' },
  gitlab: { icon: <GitlabLogo size={12} weight="bold" />, label: 'GitLab' },
}

function openExternal(url: string) {
  window.api?.openExternal(url)
}

function parsePrUrl(url: string): PrInfo | null {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)

    // GitHub: github.com/:owner/:repo/pull/:number
    if (u.hostname === 'github.com' || u.hostname.includes('github')) {
      const pullIdx = parts.indexOf('pull')
      if (pullIdx >= 2 && parts[pullIdx + 1]) {
        return { host: 'github', owner: parts[pullIdx - 2], repo: parts[pullIdx - 1], number: parts[pullIdx + 1] }
      }
    }

    // GitLab: gitlab.com/:group(s)/:repo/-/merge_requests/:number
    if (u.hostname.includes('gitlab') || u.hostname.includes('cfdata')) {
      const mrIdx = parts.indexOf('merge_requests')
      const dashIdx = parts.indexOf('-')
      if (mrIdx >= 1 && parts[mrIdx + 1] && dashIdx >= 2) {
        return { host: 'gitlab', owner: parts.slice(0, dashIdx - 1).join('/'), repo: parts[dashIdx - 1], number: parts[mrIdx + 1] }
      }
    }

    return null
  } catch {
    return null
  }
}

const cardClass = 'rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 shadow-xl text-[11px] max-w-[320px]'
const actionBtnClass = 'w-6 h-6 flex items-center justify-center rounded hover:bg-kumo-fill transition-colors cursor-pointer'

function ActionBar({ onOpen, onEdit, onRemove }: PrTooltipActions) {
  if (!onOpen && !onEdit && !onRemove) return null
  return (
    <div className="flex items-center gap-0.5 border-t border-kumo-line pt-1.5 -mx-1">
      {onOpen && (
        <button onClick={onOpen} className={`${actionBtnClass} text-kumo-subtle hover:text-kumo-default`} title="Open PR">
          <ArrowLineUpRight size={12} weight="bold" />
        </button>
      )}
      {onEdit && (
        <button onClick={onEdit} className={`${actionBtnClass} text-kumo-subtle hover:text-kumo-default`} title="Edit PR link">
          <PencilSimple size={12} weight="bold" />
        </button>
      )}
      {onRemove && (
        <button onClick={onRemove} className={`${actionBtnClass} text-kumo-subtle hover:text-kumo-danger`} title="Remove PR link">
          <Trash size={12} weight="bold" />
        </button>
      )}
    </div>
  )
}

interface PrTooltipContentProps {
  url: string
  actions?: PrTooltipActions
}

export function PrTooltipContent({ url, actions }: PrTooltipContentProps): ReactNode {
  const info = parsePrUrl(url)

  if (!info) {
    return (
      <div className={`${cardClass} space-y-1.5`}>
        <div className="flex items-center gap-1.5 text-kumo-subtle">
          <GitPullRequest size={12} weight="bold" />
          <button onClick={() => openExternal(url)} className="text-kumo-default truncate hover:underline cursor-pointer">
            {url}
          </button>
        </div>
        {actions && <ActionBar {...actions} />}
      </div>
    )
  }

  const { icon, label } = hostMeta[info.host]

  return (
    <div className={`${cardClass} min-w-[180px] space-y-1.5`}>
      <div className="flex items-center gap-1.5 text-kumo-subtle">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <GitMerge size={12} weight="bold" className="shrink-0 text-kumo-brand" />
        <span className="text-kumo-default font-medium truncate">{info.owner}/{info.repo}</span>
        <button
          onClick={() => openExternal(url)}
          className="text-kumo-brand font-mono hover:underline cursor-pointer"
        >
          #{info.number}
        </button>
      </div>
      {actions && <ActionBar {...actions} />}
    </div>
  )
}
