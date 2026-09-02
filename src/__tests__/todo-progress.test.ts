import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TodoList } from '../renderer/src/components/DetailDrawer'
import { applyTodoUpdate, isCurrentTodoFetch, type AgentTodo } from '../renderer/src/hooks/useAgentStore'
import { getCurrentTaskProgress } from '../renderer/src/lib/task-progress'

describe('Todo progress', () => {
  it('reports the active task position and content', () => {
    expect(getCurrentTaskProgress([
      { content: 'Trace events', status: 'completed' },
      { content: 'Add coverage', status: 'in_progress' },
      { content: 'Run checks', status: 'pending' }
    ])).toEqual({
      status: 'in_progress',
      current: 2,
      total: 3,
      content: 'Add coverage'
    })
  })

  it('does not report progress without an active task', () => {
    expect(getCurrentTaskProgress([
      { content: 'Trace events', status: 'completed' },
      { content: 'Add coverage', status: 'pending' }
    ])).toBeUndefined()
  })

  it('reports when every tracked task is complete', () => {
    expect(getCurrentTaskProgress([
      { content: 'Trace events', status: 'completed' },
      { content: 'Add coverage', status: 'completed' }
    ])).toEqual({
      status: 'completed',
      total: 2
    })

    expect(getCurrentTaskProgress([])).toBeUndefined()
    expect(getCurrentTaskProgress([
      { content: 'Trace events', status: 'completed' },
      { content: 'Old approach', status: 'cancelled' }
    ])).toBeUndefined()
  })

  it('tracks the current task when the todo list changes over time', () => {
    const todos = new Map<string, AgentTodo[]>()

    applyTodoUpdate(todos, {
      sessionID: 'session-1',
      todos: [
        { content: 'Trace events', status: 'in_progress' },
        { content: 'Add coverage', status: 'pending' }
      ]
    })
    expect(getCurrentTaskProgress(todos.get('session-1') ?? [])).toEqual({
      status: 'in_progress',
      current: 1,
      total: 2,
      content: 'Trace events'
    })

    applyTodoUpdate(todos, {
      sessionID: 'session-1',
      todos: [
        { content: 'Trace events', status: 'completed' },
        { content: 'Refine coverage', status: 'in_progress' },
        { content: 'Run checks', status: 'pending' }
      ]
    })
    expect(getCurrentTaskProgress(todos.get('session-1') ?? [])).toEqual({
      status: 'in_progress',
      current: 2,
      total: 3,
      content: 'Refine coverage'
    })
  })

  it('replaces an earlier task snapshot when OpenCode reports new progress', () => {
    const todos = new Map<string, AgentTodo[]>()

    applyTodoUpdate(todos, {
      sessionID: 'session-1',
      todos: [
        { content: 'Trace events', status: 'in_progress', priority: 'high' },
        { content: 'Add coverage', status: 'pending', priority: 'high' },
        { content: 'Run checks', status: 'pending', priority: 'medium' }
      ]
    })
    applyTodoUpdate(todos, {
      sessionID: 'session-1',
      todos: [
        { content: 'Trace events', status: 'completed', priority: 'high' },
        { content: 'Add coverage', status: 'completed', priority: 'high' },
        { content: 'Run checks', status: 'in_progress', priority: 'medium' }
      ]
    })

    const current = todos.get('session-1') ?? []
    const markup = renderToStaticMarkup(createElement(TodoList, { todos: current }))

    expect(current).toEqual([
      { content: 'Trace events', status: 'completed', priority: 'high' },
      { content: 'Add coverage', status: 'completed', priority: 'high' },
      { content: 'Run checks', status: 'in_progress', priority: 'medium' }
    ])
    expect(markup).toContain('2 of 3 complete')
    expect(markup).toContain('67%')
  })

  it('only applies the latest fetch when no live event arrived', () => {
    expect(isCurrentTodoFetch(
      { eventRevision: 1, fetchGeneration: 2 },
      { eventRevision: 1, fetchGeneration: 2 }
    )).toBe(true)
    expect(isCurrentTodoFetch(
      { eventRevision: 1, fetchGeneration: 1 },
      { eventRevision: 1, fetchGeneration: 2 }
    )).toBe(false)
    expect(isCurrentTodoFetch(
      { eventRevision: 1, fetchGeneration: 2 },
      { eventRevision: 2, fetchGeneration: 2 }
    )).toBe(false)
  })
})
