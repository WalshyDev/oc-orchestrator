import { GitPullRequest } from '@phosphor-icons/react'
import { Tooltip } from './Tooltip'
import { PrTooltipContent } from './PrTooltip'

interface PrBadgeProps {
  url: string
  stopPropagation?: boolean
}

export function PrBadge({ url, stopPropagation }: PrBadgeProps) {
  return (
    <Tooltip content={<PrTooltipContent url={url} />} position="top">
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
