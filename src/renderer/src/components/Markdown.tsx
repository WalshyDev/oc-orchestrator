import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
  className?: string
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={`markdown-body ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['script', 'iframe', 'object', 'embed', 'form']}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
