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

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={`markdown-body ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['script', 'iframe', 'object', 'embed', 'form']}
        components={{
          a: ExternalLink
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
