// LogConsole Component - Real-time SD process logs viewer
import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Trash2, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useSDModelsStore } from '@/stores/sdModelsStore'

interface LogConsoleProps {
  isGenerating: boolean
}

export function LogConsole({ isGenerating }: LogConsoleProps) {
  const { sdLogs, addSdLog, clearSdLogs } = useSDModelsStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  // Listen to SD logs
  useEffect(() => {
    if (!window.electronAPI?.onSdLog || !isGenerating) {
      return
    }

    const removeListener = window.electronAPI.onSdLog((data) => {
      addSdLog({
        type: data.type,
        message: data.message,
        timestamp: new Date()
      })
    })

    return () => {
      removeListener()
    }
  }, [isGenerating, addSdLog])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      // Use scrollTop for instant, jank-free scrolling
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
    }
  }, [sdLogs, autoScroll])

  // Detect manual scroll and disable auto-scroll
  const handleScroll = () => {
    if (!logsContainerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10

    setAutoScroll(isAtBottom)
  }

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    } as Intl.DateTimeFormatOptions)
  }

  // Don't show console if not generating and no logs
  if (!isGenerating && sdLogs.length === 0) {
    return null
  }

  return (
    <Card className="mt-3">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium text-xs">
            SD Process Logs
            {sdLogs.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                ({sdLogs.length})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isExpanded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                clearSdLogs()
              }}
              className="h-6 px-2"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              <span className="text-xs">Clear</span>
            </Button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Logs Content */}
      {isExpanded && (
        <CardContent className="p-0">
          <div
            ref={logsContainerRef}
            onScroll={handleScroll}
            className="bg-black/95 text-white font-mono text-[10px] overflow-y-auto max-h-64 px-3 py-2"
          >
            {sdLogs.length === 0 ? (
              <div className="text-muted-foreground text-center py-6 text-xs">
                No logs yet. Waiting for SD process output...
              </div>
            ) : (
              sdLogs.map((log) => (
                <div
                  key={log.id}
                  className={cn(
                    'flex gap-2 leading-tight py-0.5',
                    log.type === 'stderr' && 'text-yellow-400'
                  )}
                >
                  <span className="text-gray-500 shrink-0 text-[9px]">
                    [{formatTimestamp(log.timestamp)}]
                  </span>
                  <span className="whitespace-pre-wrap break-all">
                    {log.message}
                  </span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>

          {/* Auto-scroll indicator */}
          {!autoScroll && sdLogs.length > 0 && (
            <div className="px-2 py-1 bg-muted/50 text-xs text-center">
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setAutoScroll(true)
                  logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                }}
                className="h-auto p-0 text-[10px]"
              >
                Scroll to bottom
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
