import { useState, useCallback, useRef } from 'react'
import type { MessageAttachment } from '../types/api'

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024 // 20 MB
const MAX_ATTACHMENT_COUNT = 10

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
      imageFiles.map(async (f): Promise<MessageAttachment> => ({
        id: generateAttachmentId(),
        mime: f.type,
        dataUrl: await readFileAsDataUrl(f),
        filename: f.name
      }))
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
