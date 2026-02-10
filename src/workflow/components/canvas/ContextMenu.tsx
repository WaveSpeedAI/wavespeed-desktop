/**
 * Context menu — polished dropdown for node/canvas right-click actions.
 */
import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  action: () => void
  shortcut?: string
  icon?: string
  disabled?: boolean
  divider?: boolean
  keepOpen?: boolean
  destructive?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 100)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClickOutside) }
  }, [onClose])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Adjust position to stay within viewport
  const adjustedStyle = (() => {
    const menuWidth = 200
    const menuHeight = items.length * 36
    const left = x + menuWidth > window.innerWidth ? x - menuWidth : x
    const top = y + menuHeight > window.innerHeight ? y - menuHeight : y
    return { left: Math.max(4, left), top: Math.max(4, top) }
  })()

  return (
    <div
      ref={menuRef}
      className="fixed z-[1000] min-w-[180px] rounded-lg border border-border bg-popover/95 backdrop-blur-sm py-1 text-popover-foreground shadow-xl"
      style={adjustedStyle}
    >
      {items.map((item, index) => {
        if (item.divider) {
          return <div key={`div-${index}`} className="my-1 mx-2 h-px bg-border" />
        }
        return (
          <button
            key={index}
            onClick={() => {
              if (!item.disabled) {
                item.action()
                if (!item.keepOpen) onClose()
              }
            }}
            disabled={item.disabled}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-[13px] transition-colors
              ${item.disabled
                ? 'opacity-40 cursor-not-allowed'
                : item.destructive
                  ? 'hover:bg-red-500/10 text-red-400'
                  : 'hover:bg-accent'}`}
          >
            <span className="flex items-center gap-2.5">
              {item.icon && <span className="w-4 text-center text-sm">{item.icon}</span>}
              <span>{item.label}</span>
            </span>
            {item.shortcut && (
              <span className="ml-6 text-[11px] text-muted-foreground/70">{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
