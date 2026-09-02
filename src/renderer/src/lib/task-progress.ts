import type { AgentTodo } from '../hooks/useAgentStore'
import type { AgentTaskProgress } from '../types'

export function getCurrentTaskProgress(todos: AgentTodo[]): AgentTaskProgress | undefined {
  const index = todos.findIndex((todo) => todo.status === 'in_progress')
  if (index === -1) return undefined

  return {
    current: index + 1,
    total: todos.length,
    content: todos[index].content
  }
}
