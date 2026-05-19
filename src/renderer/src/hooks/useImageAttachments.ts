import { useState, useCallback, useRef } from 'react'
import type { MessageAttachment } from '../types/api'

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024 // 20 MB
const MAX_ATTACHMENT_COUNT = 10

// Anthropic rejects multi-image requests where any dimension exceeds 2000px.
// 1568px is Anthropic's documented sweet spot for vision (~1.15 megapixels)
// and keeps margin under the hard limit.
const MAX_IMAGE_DIMENSION = 1568

// Animated GIFs lose animation when re-encoded via canvas, so we leave them
// alone and rely on the upstream size check to reject anything too large.
const RESIZABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

let nextAttachmentId = 0
function generateAttachmentId(): string {
  return `att-${Date.now()}-${nextAttachmentId++}`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = dataUrl
  })
}

/**
 * Downscale an image data URL if its largest dimension exceeds MAX_IMAGE_DIMENSION.
 * Returns the original data URL if no resize is needed or if resizing fails.
 * Re-encodes to JPEG for non-PNG sources to keep payload small.
 */
async function maybeResizeDataUrl(
  dataUrl: string,
  mime: string
): Promise<{ dataUrl: string; mime: string }> {
  if (!RESIZABLE_TYPES.has(mime)) return { dataUrl, mime }

  try {
    const img = await loadImage(dataUrl)
    const { naturalWidth: w, naturalHeight: h } = img
    if (w <= MAX_IMAGE_DIMENSION && h <= MAX_IMAGE_DIMENSION) {
      return { dataUrl, mime }
    }

    const scale = MAX_IMAGE_DIMENSION / Math.max(w, h)
    const targetW = Math.max(1, Math.round(w * scale))
    const targetH = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return { dataUrl, mime }
    ctx.drawImage(img, 0, 0, targetW, targetH)

    // Preserve PNG transparency; everything else becomes JPEG for smaller payload.
    const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg'
    const quality = outMime === 'image/jpeg' ? 0.9 : undefined
    const resized = canvas.toDataURL(outMime, quality)
    return { dataUrl: resized, mime: outMime }
  } catch {
    // If anything goes wrong (CORS, decode failure) fall back to the original.
    return { dataUrl, mime }
  }
}

export function useImageAttachments() {
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(
      (f) => ACCEPTED_IMAGE_TYPES.includes(f.type) && f.size <= MAX_ATTACHMENT_SIZE
    )
    if (imageFiles.length === 0) return

    const results = await Promise.allSettled(
      imageFiles.map(async (f): Promise<MessageAttachment> => {
        const rawDataUrl = await readFileAsDataUrl(f)
        const { dataUrl, mime } = await maybeResizeDataUrl(rawDataUrl, f.type)
        return {
          id: generateAttachmentId(),
          mime,
          dataUrl,
          filename: f.name
        }
      })
    )

    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<MessageAttachment> => r.status === 'fulfilled')
      .map((r) => r.value)

    if (succeeded.length === 0) return

    setAttachments((prev) => {
      const remaining = MAX_ATTACHMENT_COUNT - prev.length
      if (remaining <= 0) return prev
      return [...prev, ...succeeded.slice(0, remaining)]
    })
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id))
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments([])
  }, [])

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (const item of items) {
      if (ACCEPTED_IMAGE_TYPES.includes(item.type)) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault()
      void addImageFiles(imageFiles)
    }
  }, [addImageFiles])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)
    if (event.dataTransfer?.files?.length) {
      void addImageFiles(event.dataTransfer.files)
    }
  }, [addImageFiles])

  const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      void addImageFiles(event.target.files)
      event.target.value = ''
    }
  }, [addImageFiles])

  return {
    attachments,
    isDragOver,
    fileInputRef,
    removeAttachment,
    clearAttachments,
    handlePaste,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleFileInputChange
  }
}
