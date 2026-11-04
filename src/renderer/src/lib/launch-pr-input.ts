export function parseLaunchPrUrl(input: string): string | undefined {
  const value = input.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username || url.password) return undefined
    return value
  } catch {
    return undefined
  }
}

export function buildLaunchPrompt(prompt: string, prUrl?: string): string | undefined {
  if (!prUrl) return prompt || undefined
  return [prompt.trim(), prUrl].filter(Boolean).join(' ')
}
