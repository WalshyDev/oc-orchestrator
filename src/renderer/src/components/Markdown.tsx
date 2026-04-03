import { memo } from 'react'
import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
  className?: string
}

function ExternalLink({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (href) {
      window.api.openExternal(href)
    }
  }

  return (
    <a {...props} href={href} onClick={handleClick}>
      {children}
    </a>
  )
}

function ScrollableTable({ children, ...props }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table {...props}>{children}</table>
    </div>
  )
}

// Hoist to module scope — stable references prevent ReactMarkdown from
// re-parsing markdown on every render due to referential inequality.
const REMARK_PLUGINS = [remarkGfm]
const DISALLOWED_ELEMENTS = ['script', 'iframe', 'object', 'embed', 'form']
const COMPONENTS = { a: ExternalLink, table: ScrollableTable }

export const Markdown = memo(function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={`markdown-body ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        disallowedElements={DISALLOWED_ELEMENTS}
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
