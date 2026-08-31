export interface AgentInterrupt {
  agentId: string
}

export function getPendingInterruptStatus(
  agentId: string,
  permissions: Iterable<AgentInterrupt>,
  questions: Iterable<AgentInterrupt>
): 'needs_input' | 'needs_approval' | undefined {
  for (const question of questions) {
    if (question.agentId === agentId) return 'needs_input'
  }
  for (const permission of permissions) {
    if (permission.agentId === agentId) return 'needs_approval'
  }
  return undefined
}
