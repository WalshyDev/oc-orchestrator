import { describe, expect, it } from 'vitest'
import { createOptimisticUserMessage, replaceNextOptimisticUserFilePart } from '../renderer/src/lib/optimistic-message'

describe('optimistic user message attachments', () => {
  it('keeps an attached screenshot visible with the text before the server echoes the message', () => {
    const message = createOptimisticUserMessage('session-1', 'Check this screenshot', [
      { mime: 'image/png', dataUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==', filename: 'screenshot.png' }
    ], 'provider/model')

    expect(message?.modelId).toBe('provider/model')
    expect(message?.parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'Check this screenshot' }),
      expect.objectContaining({
        type: 'file',
        fileMime: 'image/png',
        fileUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==',
        fileName: 'screenshot.png'
      })
    ])
  })

  it('reconciles echoed image parts without duplicating the optimistic preview', () => {
    const message = createOptimisticUserMessage('session-1', 'Compare these', [
      { mime: 'image/png', dataUrl: 'data:image/png;base64,b25l', filename: 'one.png' },
      { mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,dHdv', filename: 'two.jpg' }
    ])!

    expect(replaceNextOptimisticUserFilePart(message, {
      id: 'server-file-1',
      type: 'file',
      fileMime: 'image/png',
      fileUrl: 'data:image/png;base64,b25l',
      fileName: 'one.png'
    })).toBe(true)
    expect(replaceNextOptimisticUserFilePart(message, {
      id: 'server-file-2',
      type: 'file',
      fileMime: 'image/jpeg',
      fileUrl: 'data:image/jpeg;base64,dHdv',
      fileName: 'two.jpg'
    })).toBe(true)

    expect(message.parts).toHaveLength(3)
    expect(message.parts.slice(1).map(({ id }) => id)).toEqual(['server-file-1', 'server-file-2'])
  })

  it('does not replace a server part on a message without an optimistic file', () => {
    const message = createOptimisticUserMessage('session-1', 'Text only')!

    expect(replaceNextOptimisticUserFilePart(message, {
      id: 'server-file-1',
      type: 'file',
      fileMime: 'image/png',
      fileUrl: 'data:image/png;base64,c2NyZWVuc2hvdA=='
    })).toBe(false)
  })
})
