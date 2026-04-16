import { GitPullRequest } from '@phosphor-icons/react'
import { Tooltip } from './Tooltip'
import { PrTooltipContent, type PrTooltipActions } from './PrTooltip'

interface PrBadgeProps {
  url: string
  stopPropagation?: boolean
  actions?: PrTooltipActions
}

export function PrBadge({ url, stopPropagation, actions }: PrBadgeProps) {
  const hasActions = actions && (actions.onOpen || actions.onEdit || actions.onRemove)
  return (
    <Tooltip
      content={<PrTooltipContent url={url} actions={actions} />}
      position="top"
      interactive={!!hasActions}
    >
      <button
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation()
          window.api?.openExternal(url)
        }}
        className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-kumo-brand/10 text-kumo-brand hover:bg-kumo-brand/20 transition-colors text-[9px] font-medium cursor-pointer"
      >
        <GitPullRequest size={10} weight="bold" />
        PR
      </button>
    </Tooltip>
  )
}
