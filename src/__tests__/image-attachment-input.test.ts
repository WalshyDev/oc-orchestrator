import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ImageAttachmentInput } from '../renderer/src/components/ImageAttachmentInput'
import type { useImageAttachments } from '../renderer/src/hooks/useImageAttachments'

function makeImages(): ReturnType<typeof useImageAttachments> {
  return {
    attachments: [{ id: 'screenshot', mime: 'image/png', dataUrl: 'data:image/png;base64,test', filename: 'Screenshot.png' }],
    isDragOver: false,
    fileInputRef: { current: null },
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    handlePaste: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handleFileInputChange: vi.fn()
  }
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return []
    return [child, ...elements(child.props.children as ReactNode)]
  })
}

describe('image attachment prompt controls', () => {
  it('handles screenshot paste and drag events around either prompt', () => {
    const images = makeImages()
    const input = ImageAttachmentInput({ images, children: createElement('textarea') })
    expect(input.props.onPaste).toBe(images.handlePaste)
    expect(input.props.onDragOver).toBe(images.handleDragOver)
    expect(input.props.onDragEnter).toBe(images.handleDragEnter)
    expect(input.props.onDragLeave).toBe(images.handleDragLeave)
    expect(input.props.onDrop).toBe(images.handleDrop)
  })

  it('opens the image picker and removes a selected screenshot', () => {
    const images = makeImages()
    const click = vi.fn()
    images.fileInputRef.current = { click } as unknown as HTMLInputElement
    const controls = elements(ImageAttachmentInput({ images, children: createElement('textarea') }))
    const attach = controls.find((element) => element.props.title === 'Attach image')!
    const openPicker = attach.props.onClick as () => void
    openPicker()
    expect(click).toHaveBeenCalledOnce()

    const remove = controls.find((element) => element.props['aria-label'] === 'Remove Screenshot.png')!
    const removeScreenshot = remove.props.onClick as () => void
    removeScreenshot()
    expect(images.removeAttachment).toHaveBeenCalledWith('screenshot')

    const picker = controls.find((element) => element.props.type === 'file')!
    expect(picker.props.onChange).toBe(images.handleFileInputChange)
    expect(picker.props.multiple).toBe(true)
    expect(picker.props.accept).toContain('image/png')
  })

  it('shows the preview, prompt, and attachment hint together', () => {
    const markup = renderToStaticMarkup(createElement(ImageAttachmentInput, {
      images: makeImages(),
      children: createElement('textarea', { placeholder: 'Continue the imported session' })
    }))
    expect(markup).toContain('alt="Screenshot.png"')
    expect(markup).toContain('Continue the imported session')
    expect(markup).toContain('Paste or drag images to attach.')
  })
})
