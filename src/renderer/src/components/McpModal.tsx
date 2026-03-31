import { useState, useEffect, useCallback } from 'react'
import { X, CircleNotch, Plug, PlugsConnected, Warning, Lock } from '@phosphor-icons/react'

interface McpServerInfo {
  name: string
  status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration'
  error?: string
}

interface McpModalProps {
  agentId: string
  onClose: () => void
}

const STATUS_CONFIG: Record<McpServerInfo['status'], { label: string; color: string; icon: typeof Plug }> = {
  connected: { label: 'Connected', color: 'text-kumo-success', icon: PlugsConnected },
  disabled: { label: 'Disabled', color: 'text-kumo-subtle', icon: Plug },
  failed: { label: 'Failed', color: 'text-kumo-danger', icon: Warning },
  needs_auth: { label: 'Needs Auth', color: 'text-amber-400', icon: Lock },
  needs_client_registration: { label: 'Needs Registration', color: 'text-amber-400', icon: Lock }
}

export function McpModal({ agentId, onClose }: McpModalProps) {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  const fetchStatus = useCallback(async () => {
    try {
      const result = await window.api.getMcpStatus(agentId)
      if (result.ok && result.data) {
        const statuses = result.data as Record<string, { status: string; error?: string }>
        const serverList: McpServerInfo[] = Object.entries(statuses)
          .map(([name, info]) => ({
            name,
            status: info.status as McpServerInfo['status'],
            error: info.error
          }))
          .sort((left, right) => left.name.localeCompare(right.name))

        setServers(serverList)
      }
    } catch (error) {
      console.error('Failed to fetch MCP status:', error)
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  const handleToggle = async (serverName: string, currentStatus: McpServerInfo['status']): Promise<void> => {
    setToggling((prev) => new Set(prev).add(serverName))

    try {
      if (currentStatus === 'connected') {
        await window.api.disconnectMcp(agentId, serverName)
      } else {
        await window.api.connectMcp(agentId, serverName)
      }
      // Re-fetch status after toggle
      await fetchStatus()
    } catch (error) {
      console.error(`Failed to toggle MCP server ${serverName}:`, error)
    } finally {
      setToggling((prev) => {
        const next = new Set(prev)
        next.delete(serverName)
        return next
      })
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] max-h-[70vh] bg-kumo-elevated border border-kumo-line rounded-xl shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-kumo-line">
          <div>
            <h2 className="text-base font-semibold text-kumo-strong">MCP Servers</h2>
            <p className="text-[11px] text-kumo-subtle mt-0.5">
              {servers.filter((server) => server.status === 'connected').length} of {servers.length} connected
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-kumo-line text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Server List */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-kumo-subtle text-sm">
              <CircleNotch size={16} className="animate-spin" />
              Loading MCP servers...
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-kumo-subtle text-sm">
              <Plug size={24} />
              <span>No MCP servers configured</span>
              <span className="text-[11px]">Add MCP servers in your opencode.json config</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {servers.map((server) => {
                const config = STATUS_CONFIG[server.status]
                const StatusIcon = config.icon
                const isToggling = toggling.has(server.name)
                const isConnected = server.status === 'connected'

                return (
                  <div
                    key={server.name}
                    className="flex items-center justify-between px-3 py-3 rounded-lg hover:bg-kumo-fill/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusIcon size={16} className={config.color} />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium text-kumo-strong truncate">{server.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[11px] font-medium ${config.color}`}>{config.label}</span>
                          {server.error && (
                            <span className="text-[10px] text-kumo-danger truncate max-w-[200px]" title={server.error}>
                              {server.error}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => void handleToggle(server.name, server.status)}
                      disabled={isToggling}
                      className={`shrink-0 px-3 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
                        isToggling
                          ? 'border-kumo-line text-kumo-subtle cursor-wait'
                          : isConnected
                            ? 'border-kumo-danger/25 text-kumo-danger bg-kumo-danger/8 hover:bg-kumo-danger/15'
                            : 'border-kumo-success/25 text-kumo-success bg-kumo-success/8 hover:bg-kumo-success/15'
                      }`}
                    >
                      {isToggling ? (
                        <CircleNotch size={12} className="animate-spin" />
                      ) : isConnected ? (
                        'Disconnect'
                      ) : (
                        'Connect'
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-kumo-line">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-kumo-subtle border border-kumo-line rounded-md hover:bg-kumo-fill transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
