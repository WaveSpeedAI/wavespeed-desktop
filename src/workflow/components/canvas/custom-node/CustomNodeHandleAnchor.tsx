/**
 * HandleAnchor — inline wrapper that places a React-Flow Handle on the node
 * border, vertically centred with the label text.
 *
 * The Handle lives inside a `position: relative` span so that its vertical
 * `top: 50%` is relative to the current row (not the whole card).  We then
 * compute a `left` / `right` offset to push the handle to the card border.
 *
 * CRITICAL: we use **useLayoutEffect** (not useEffect) to compute the
 * offset.  React Flow measures handle positions via a ResizeObserver
 * callback that fires *after* paint.  useLayoutEffect runs synchronously
 * after DOM mutations but *before* paint, so the handle is already in its
 * final position when React Flow reads getBoundingClientRect().
 */
import React, { useRef, useLayoutEffect, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { HANDLE_SIZE } from './CustomNodeTypes'

/* ── handle appearance ─────────────────────────────────────────────── */

export const handleLeft = (_connected: boolean, media = false): React.CSSProperties => ({
  width: HANDLE_SIZE, height: HANDLE_SIZE,
  borderRadius: '50%',
  border: `2px solid ${media ? 'hsl(142 71% 45%)' : 'hsl(var(--primary))'}`,
  background: _connected
    ? (media ? 'hsl(142 71% 45%)' : 'hsl(var(--primary))')
    : 'hsl(var(--card))',
  zIndex: 40,
  transition: 'background 150ms ease, box-shadow 150ms ease',
  boxShadow: _connected
    ? `0 0 0 2px ${media ? 'hsla(142,71%,45%,.2)' : 'hsla(var(--primary)/.2)'}`
    : 'none',
})

export const handleRight = (): React.CSSProperties => ({
  width: HANDLE_SIZE, height: HANDLE_SIZE,
  borderRadius: '50%',
  border: '2px solid hsl(var(--primary))',
  background: 'hsl(var(--primary))',
  zIndex: 40,
  boxShadow: '0 0 0 2px hsla(var(--primary)/.2)',
})

/* ── HandleAnchor component ──────────────────────────────────────────── */

export function HandleAnchor({ id, type, connected, media, children }: {
  id: string; type: 'target' | 'source'; connected: boolean; media?: boolean
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [offset, setOffset] = useState<number | null>(null)
  const pos = type === 'target' ? Position.Left : Position.Right
  const appearance = type === 'target' ? handleLeft(connected, media) : handleRight()

  // Compute the horizontal distance from this span to the card border.
  // Must run synchronously before paint so React Flow's ResizeObserver
  // reads the final handle position.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // Find the card div (rounded-xl border)
    let card: HTMLElement | null = el
    while (card && !card.classList.contains('rounded-xl')) card = card.parentElement
    if (!card) return

    // Find the zoom level from the viewport transform
    const viewport = el.closest('.react-flow__viewport') as HTMLElement | null
    let zoom = 1
    if (viewport) {
      const style = window.getComputedStyle(viewport)
      const matrix = new DOMMatrixReadOnly(style.transform)
      zoom = matrix.a || 1 // scaleX = zoom
    }

    const cardRect = card.getBoundingClientRect()
    const anchorRect = el.getBoundingClientRect()

    // getBoundingClientRect returns screen pixels (after zoom).
    // CSS left/right values are in local coordinates (before zoom).
    // Divide by zoom to convert.
    if (type === 'target') {
      setOffset((cardRect.left - anchorRect.left) / zoom - HANDLE_SIZE / 2)
    } else {
      setOffset((anchorRect.right - cardRect.right) / zoom + HANDLE_SIZE / 2)
    }
  })

  const handleStyle: React.CSSProperties = {
    ...appearance,
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    ...(type === 'target'
      ? { left: offset ?? -(HANDLE_SIZE / 2 + 1) }
      : { right: offset ?? -(HANDLE_SIZE / 2 + 1) }),
  }

  return (
    <span ref={ref} className="relative inline-flex items-center self-stretch" style={{ width: 0, minWidth: 0, overflow: 'visible' }}>
      <Handle type={type} position={pos} id={id} style={handleStyle} />
      {children}
    </span>
  )
}
