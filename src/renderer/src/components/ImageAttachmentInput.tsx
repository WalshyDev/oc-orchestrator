import type { ReactNode } from 'react'
import { Paperclip, X } from '@phosphor-icons/react'
import type { useImageAttachments } from '../hooks/useImageAttachments'

interface ImageAttachmentInputProps {
  images: ReturnType<typeof useImageAttachments>
  children: ReactNode
}

export function ImageAttachmentInput({ images, children }: ImageAttachmentInputProps) {
  return (
    <div
      className={`relative flex flex-col rounded-md border transition-colors ${
        images.isDragOver ? 'border-kumo-brand bg-kumo-brand/[0.04]' : 'border-kumo-line focus-within:border-kumo-ring'
      }`}
      onPaste={images.handlePaste}
      onDragOver={images.handleDragOver}
      onDragEnter={images.handleDragEnter}
      onDragLeave={images.handleDragLeave}
      onDrop={images.handleDrop}
    >
      {images.attachments.length > 0 && (
        <div className="flex gap-2 px-3 py-2 overflow-x-auto">
          {images.attachments.map((att) => (
            <div key={att.id} className="relative group shrink-0">
              <img
                src={att.dataUrl}
                alt={att.filename ?? 'attachment'}
                className="h-16 w-16 rounded-md border border-kumo-line object-cover"
              />
              <button
                type="button"
                onClick={() => images.removeAttachment(att.id!)}
                aria-label={`Remove ${att.filename ?? 'image'}`}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-kumo-danger text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                <X size={8} weight="bold" />
              </button>
              {att.filename && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] px-1 py-0.5 rounded-b-md truncate">
                  {att.filename}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {children}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-kumo-line">
        <button
          type="button"
          onClick={() => images.fileInputRef.current?.click()}
          className="flex items-center gap-1 text-[10px] text-kumo-subtle hover:text-kumo-default transition-colors"
          title="Attach image"
        >
          <Paperclip size={11} />
          <span>Attach image</span>
        </button>
        <input
          ref={images.fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={images.handleFileInputChange}
        />
        <span className="text-[10px] text-kumo-subtle/60">Paste or drag images to attach.</span>
      </div>
    </div>
  )
}
