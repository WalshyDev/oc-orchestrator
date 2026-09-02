import type { AgentTodo } from '../hooks/useAgentStore'
import type { AgentTaskProgress } from '../types'

export function getCurrentTaskProgress(todos: AgentTodo[]): AgentTaskProgress | undefined {
  const index = todos.findIndex((todo) => todo.status === 'in_progress')
  if (index === -1) {
    return todos.length > 0 && todos.every((todo) => todo.status === 'completed')
      ? { status: 'completed', total: todos.length }
      : undefined
  }

  return {
    status: 'in_progress',
    current: index + 1,
    total: todos.length,
    content: todos[index].content
  }
}
