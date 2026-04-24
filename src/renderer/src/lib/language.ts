/**
 * Map a filename to a Monaco language ID. Monaco will fall back to plain
 * text for unknown extensions, which is fine for lockfiles and configs.
 */
const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  scala: 'scala',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  proto: 'protobuf',
  tf: 'hcl',
  hcl: 'hcl'
}

export function languageForPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile'
  const dot = base.lastIndexOf('.')
  if (dot === -1) return 'plaintext'
  const ext = base.slice(dot + 1).toLowerCase()
  return EXTENSION_MAP[ext] ?? 'plaintext'
}
