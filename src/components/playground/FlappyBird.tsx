import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface FlappyBirdProps {
  onGameStart?: () => void
  onGameEnd?: (score: number) => void
  onGameQuit?: () => void
  isTaskRunning?: boolean
  taskStatus?: string
  idleMessage?: {
    title: string
    subtitle: string
  }
  hasResults?: boolean
  onViewResults?: () => void
}

interface Bird {
  x: number
  y: number
  velocity: number
  width: number
  height: number
}

interface Pipe {
  x: number
  topHeight: number
  passed: boolean
}

type GameState = 'idle' | 'playing' | 'gameover'

// Physics values calibrated for 60fps, scaled by delta time
const TARGET_FPS = 60
const GRAVITY = 0.4 * TARGET_FPS
const JUMP_STRENGTH = -7
const PIPE_SPEED = 3 * TARGET_FPS
const PIPE_GAP = 140
const PIPE_WIDTH = 52
const PIPE_SPACING = 200
const BIRD_SIZE = 36
const PIXEL_SIZE = 3

// Pixel art bird body (13x11 grid) - classic Flappy Bird style
// Colors: 0=transparent, 1=body, 3=eye white, 4=eye pupil, 5=beak top, 6=beak bottom, 7=body shadow, 8=outline
const BIRD_BODY = [
  [0, 0, 0, 0, 8, 8, 8, 8, 8, 0, 0, 0, 0],
  [0, 0, 0, 8, 1, 1, 1, 1, 1, 8, 0, 0, 0],
  [0, 0, 8, 1, 1, 1, 1, 3, 3, 3, 8, 0, 0],
  [0, 8, 1, 1, 1, 1, 3, 3, 4, 3, 3, 8, 0],
  [0, 8, 1, 1, 1, 1, 1, 3, 3, 3, 8, 5, 8],
  [8, 1, 1, 1, 1, 1, 1, 1, 1, 8, 5, 5, 8],
  [8, 1, 1, 1, 1, 1, 1, 1, 1, 8, 6, 6, 8],
  [8, 7, 7, 1, 1, 1, 1, 1, 8, 8, 6, 8, 0],
  [0, 8, 7, 7, 1, 1, 1, 1, 1, 8, 8, 0, 0],
  [0, 0, 8, 7, 7, 1, 1, 1, 1, 8, 0, 0, 0],
  [0, 0, 0, 8, 8, 8, 8, 8, 8, 0, 0, 0, 0],
]

// Wing animation frames (4x3 each) - positioned on left side of body
const WING_FRAMES = [
  // Frame 0 - wing up
  [
    [8, 2, 2, 8],
    [0, 8, 2, 8],
    [0, 0, 8, 0],
  ],
  // Frame 1 - wing middle
  [
    [0, 8, 8, 0],
    [8, 2, 2, 8],
    [0, 8, 8, 0],
  ],
  // Frame 2 - wing down
  [
    [0, 0, 8, 0],
    [0, 8, 2, 8],
    [8, 2, 2, 8],
  ],
]

// Pixel art letters and numbers (5x5 each)
const PIXEL_LETTERS: Record<string, number[][]> = {
  A: [[0,1,1,1,0],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  B: [[1,1,1,1,0],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,1,1,1,0]],
  C: [[0,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[0,1,1,1,1]],
  D: [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  E: [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,1,1,1,1]],
  F: [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0]],
  G: [[1,1,1,1,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,1,1,1,1]],
  H: [[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  I: [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[1,1,1,1,1]],
  J: [[0,0,0,0,1],[0,0,0,0,1],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  K: [[1,0,0,0,1],[1,0,0,1,0],[1,1,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  L: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  M: [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  N: [[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1]],
  O: [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  P: [[1,1,1,1,0],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0]],
  Q: [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,1,0],[0,1,1,0,1]],
  R: [[1,1,1,1,0],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,1,0],[1,0,0,0,1]],
  S: [[0,1,1,1,1],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[1,1,1,1,0]],
  T: [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  U: [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  V: [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0]],
  W: [[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,1,0,1,1],[1,0,0,0,1]],
  X: [[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,1,0,1,0],[1,0,0,0,1]],
  Y: [[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  Z: [[1,1,1,1,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,1,1,1,1]],
  '0': [[0,1,1,1,0],[1,0,0,1,1],[1,0,1,0,1],[1,1,0,0,1],[0,1,1,1,0]],
  '1': [[0,0,1,0,0],[0,1,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0]],
  '2': [[0,1,1,1,0],[1,0,0,0,1],[0,0,1,1,0],[0,1,0,0,0],[1,1,1,1,1]],
  '3': [[1,1,1,1,0],[0,0,0,0,1],[0,1,1,1,0],[0,0,0,0,1],[1,1,1,1,0]],
  '4': [[1,0,0,1,0],[1,0,0,1,0],[1,1,1,1,1],[0,0,0,1,0],[0,0,0,1,0]],
  '5': [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[0,0,0,0,1],[1,1,1,1,0]],
  '6': [[0,1,1,1,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,1],[0,1,1,1,0]],
  '7': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,1,0,0]],
  '8': [[0,1,1,1,0],[1,0,0,0,1],[0,1,1,1,0],[1,0,0,0,1],[0,1,1,1,0]],
  '9': [[0,1,1,1,0],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,1,1,1,0]],
  ':': [[0,0,0,0,0],[0,0,1,0,0],[0,0,0,0,0],[0,0,1,0,0],[0,0,0,0,0]],
  '!': [[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,0,0,0],[0,0,1,0,0]],
  '*': [[0,0,0,0,0],[0,1,0,1,0],[0,0,1,0,0],[0,1,0,1,0],[0,0,0,0,0]],
}

export function FlappyBird({ onGameStart, onGameEnd, onGameQuit, isTaskRunning, taskStatus, idleMessage, hasResults, onViewResults }: FlappyBirdProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const gameLoopRef = useRef<number | null>(null)
  const [gameState, setGameState] = useState<GameState>('idle')
  const gameStateRef = useRef<GameState>('idle')
  const [_score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('flappybird_highscore')
    return saved ? parseInt(saved, 10) : 0
  })
  const highScoreRef = useRef(highScore)
  const hasResultsRef = useRef(hasResults)

  // Keep refs in sync with state
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    highScoreRef.current = highScore
  }, [highScore])

  useEffect(() => {
    hasResultsRef.current = hasResults
  }, [hasResults])

  // Get theme colors
  const getThemeColors = useCallback(() => {
    const root = document.documentElement
    const isDark = root.classList.contains('dark')
    return { isDark }
  }, [])

  const birdRef = useRef<Bird>({
    x: 80,
    y: 200,
    velocity: 0,
    width: BIRD_SIZE,
    height: BIRD_SIZE
  })
  const pipesRef = useRef<Pipe[]>([])
  const scoreRef = useRef(0)
  const flapTimeRef = useRef(0) // Track when last flap happened
  const scrollOffsetRef = useRef(0) // Track background scroll
  const lastFrameTimeRef = useRef(0) // Track last frame time for delta time

  const resetGame = useCallback(() => {
    birdRef.current = {
      x: 80,
      y: 200,
      velocity: 0,
      width: BIRD_SIZE,
      height: BIRD_SIZE
    }
    pipesRef.current = []
    scoreRef.current = 0
    setScore(0)
  }, [])

  const jump = useCallback(() => {
    if (gameStateRef.current === 'idle') {
      gameStateRef.current = 'playing'
      setGameState('playing')
      onGameStart?.()
      resetGame()
    }
    if (gameStateRef.current === 'playing') {
      birdRef.current.velocity = JUMP_STRENGTH
      flapTimeRef.current = Date.now() // Trigger flap animation
    }
  }, [onGameStart, resetGame])

  const restart = useCallback(() => {
    resetGame()
    gameStateRef.current = 'playing'
    setGameState('playing')
    onGameStart?.()
  }, [resetGame, onGameStart])

  const endGame = useCallback(() => {
    gameStateRef.current = 'gameover'
    setGameState('gameover')
    const finalScore = scoreRef.current
    if (finalScore > highScoreRef.current) {
      highScoreRef.current = finalScore
      setHighScore(finalScore)
      localStorage.setItem('flappybird_highscore', String(finalScore))
    }
    onGameEnd?.(finalScore)
  }, [onGameEnd])

  const quitGame = useCallback(() => {
    resetGame()
    gameStateRef.current = 'idle'
    setGameState('idle')
    onGameQuit?.()
  }, [resetGame, onGameQuit])

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture keys when user is typing in form elements
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        if (gameStateRef.current === 'gameover') {
          restart()
        } else {
          jump()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [jump, restart])

  // Draw pixel art text
  const drawPixelText = useCallback((ctx: CanvasRenderingContext2D, text: string, x: number, y: number, pixelSize: number, color: string) => {
    ctx.fillStyle = color
    const letters = text.split('')
    let offsetX = 0

    letters.forEach((letter) => {
      const sprite = PIXEL_LETTERS[letter]
      if (sprite) {
        sprite.forEach((row, rowIndex) => {
          row.forEach((pixel, colIndex) => {
            if (pixel) {
              ctx.fillRect(
                x + offsetX + colIndex * pixelSize,
                y + rowIndex * pixelSize,
                pixelSize,
                pixelSize
              )
            }
          })
        })
        offsetX += 6 * pixelSize // 5 pixels + 1 spacing
      } else if (letter === ' ') {
        offsetX += 4 * pixelSize
      }
    })
  }, [])

  // Draw pixel bird with animated wing (colorful like original Flappy Bird)
  const drawPixelBird = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, _isDark: boolean) => {
    // 0=transparent, 1=body yellow, 2=wing orange, 3=eye white, 4=eye pupil, 5=beak orange, 6=beak red, 7=body dark yellow, 8=outline
    const colors = [
      'transparent',  // 0
      '#F8E858',      // 1 - body yellow
      '#F8A830',      // 2 - wing orange
      '#FFFFFF',      // 3 - eye white
      '#000000',      // 4 - eye pupil
      '#FA8132',      // 5 - beak orange
      '#DC4D32',      // 6 - beak red
      '#D8B828',      // 7 - body darker yellow
      '#543818',      // 8 - outline brown
    ]

    const pixelSize = PIXEL_SIZE
    const startX = x - (BIRD_BODY[0].length * pixelSize) / 2
    const startY = y - (BIRD_BODY.length * pixelSize) / 2

    // Draw body
    BIRD_BODY.forEach((row, rowIndex) => {
      row.forEach((pixel, colIndex) => {
        if (pixel > 0) {
          ctx.fillStyle = colors[pixel]
          ctx.fillRect(
            startX + colIndex * pixelSize,
            startY + rowIndex * pixelSize,
            pixelSize,
            pixelSize
          )
        }
      })
    })

    // Draw animated wing based on flap timing
    const timeSinceFlap = Date.now() - flapTimeRef.current
    let wingFrame: number

    if (timeSinceFlap < 100) {
      wingFrame = 0 // Wing up (just clicked)
    } else if (timeSinceFlap < 200) {
      wingFrame = 1 // Wing middle (returning)
    } else {
      wingFrame = 2 // Wing down (resting/gliding)
    }

    const wing = WING_FRAMES[wingFrame]
    const wingStartX = startX - 1 * pixelSize // Wing extends left of bird body
    const wingStartY = startY + 4 * pixelSize // Wing at middle of body

    wing.forEach((row, rowIndex) => {
      row.forEach((pixel, colIndex) => {
        if (pixel > 0) {
          ctx.fillStyle = colors[pixel]
          ctx.fillRect(
            wingStartX + colIndex * pixelSize,
            wingStartY + rowIndex * pixelSize,
            pixelSize,
            pixelSize
          )
        }
      })
    })
  }, [])

  // Draw pixel pipe (green like original Flappy Bird)
  const drawPixelPipe = useCallback((ctx: CanvasRenderingContext2D, x: number, topHeight: number, canvasHeight: number, isDark: boolean) => {
    const pipeBody = isDark ? '#4a7a4a' : '#73BF2E'
    const pipeLight = isDark ? '#5a9a5a' : '#8ED43F'
    const pipeDark = isDark ? '#3a5a3a' : '#5A9A1E'
    const pipeRim = isDark ? '#2a4a2a' : '#4A8A1E'
    const pixelSize = PIXEL_SIZE
    const capHeight = pixelSize * 5
    const capExtend = pixelSize * 3

    // Helper to draw a pipe body (solid rectangles, no gaps)
    const drawPipeBody = (startY: number, endY: number) => {
      const height = endY - startY
      // Left highlight
      ctx.fillStyle = pipeLight
      ctx.fillRect(x, startY, pixelSize * 2, height)
      // Center
      ctx.fillStyle = pipeBody
      ctx.fillRect(x + pixelSize * 2, startY, PIPE_WIDTH - pixelSize * 4, height)
      // Right shadow
      ctx.fillStyle = pipeDark
      ctx.fillRect(x + PIPE_WIDTH - pixelSize * 2, startY, pixelSize * 2, height)
    }

    // Helper to draw a pipe cap (solid rectangles with rim)
    const drawPipeCap = (capY: number, rimAtTop: boolean) => {
      const capX = x - capExtend
      const capW = PIPE_WIDTH + capExtend * 2
      const rimY = rimAtTop ? capY : capY + capHeight - pixelSize
      const bodyY = rimAtTop ? capY + pixelSize : capY
      const bodyH = capHeight - pixelSize

      // Draw rim (single row)
      ctx.fillStyle = pipeRim
      ctx.fillRect(capX, rimY, capW, pixelSize)

      // Draw cap body (solid)
      ctx.fillStyle = pipeLight
      ctx.fillRect(capX, bodyY, pixelSize * 2, bodyH)
      ctx.fillStyle = pipeBody
      ctx.fillRect(capX + pixelSize * 2, bodyY, capW - pixelSize * 4, bodyH)
      ctx.fillStyle = pipeDark
      ctx.fillRect(capX + capW - pixelSize * 2, bodyY, pixelSize * 2, bodyH)
    }

    // TOP PIPE
    drawPipeBody(0, topHeight - capHeight)
    drawPipeCap(topHeight - capHeight, false)

    // BOTTOM PIPE
    const bottomStart = topHeight + PIPE_GAP
    drawPipeCap(bottomStart, true)
    drawPipeBody(bottomStart + capHeight, canvasHeight + pixelSize)
  }, [])

  // Background elements ref
  const backgroundRef = useRef({
    clouds: [
      { x: 50, y: 40, size: 1 },
      { x: 180, y: 70, size: 0.7 },
      { x: 320, y: 30, size: 1.2 },
      { x: 250, y: 90, size: 0.8 },
    ],
    grass: Array.from({ length: 80 }, (_, i) => ({
      x: i * 6,
      h: 8 + Math.random() * 12,
    })),
  })

  // Draw background
  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, isDark: boolean, scrollOffset: number) => {
    const pixelSize = PIXEL_SIZE

    // Sky gradient
    const skyTop = isDark ? '#1a1a2e' : '#87CEEB'
    const skyBottom = isDark ? '#2a2a3e' : '#E0F4FF'
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight)
    gradient.addColorStop(0, skyTop)
    gradient.addColorStop(1, skyBottom)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)

    // Draw clouds
    const cloudColor = isDark ? 'rgba(80, 80, 100, 0.3)' : 'rgba(255, 255, 255, 0.7)'
    const cloudHighlight = isDark ? 'rgba(100, 100, 120, 0.3)' : 'rgba(255, 255, 255, 0.9)'
    backgroundRef.current.clouds.forEach(cloud => {
      const cx = ((cloud.x - scrollOffset * 0.15) % (canvasWidth + 100) + canvasWidth + 100) % (canvasWidth + 100) - 50
      const cy = cloud.y
      const s = cloud.size
      // Pixel cloud shape
      ctx.fillStyle = cloudHighlight
      ctx.fillRect(cx + 10 * s, cy, 20 * s, pixelSize * 2)
      ctx.fillStyle = cloudColor
      ctx.fillRect(cx, cy + pixelSize * 2, 40 * s, pixelSize * 3)
      ctx.fillRect(cx + 5 * s, cy + pixelSize * 5, 30 * s, pixelSize * 2)
    })

    // Draw rolling hills
    const hillColorBack = isDark ? '#3a4a3a' : '#5A9A5A'
    const hillColorFront = isDark ? '#4a5a4a' : '#7DBD7D'

    // Back hills (slower parallax, darker)
    ctx.fillStyle = hillColorBack
    ctx.beginPath()
    ctx.moveTo(0, canvasHeight)
    for (let x = 0; x <= canvasWidth; x += 2) {
      const hillY = canvasHeight - 60 + Math.sin((x + scrollOffset * 0.2) * 0.015) * 20 + Math.sin((x + scrollOffset * 0.2) * 0.03) * 10
      ctx.lineTo(x, hillY)
    }
    ctx.lineTo(canvasWidth, canvasHeight)
    ctx.closePath()
    ctx.fill()

    // Front hills (faster parallax, lighter)
    ctx.fillStyle = hillColorFront
    ctx.beginPath()
    ctx.moveTo(0, canvasHeight)
    for (let x = 0; x <= canvasWidth; x += 2) {
      const hillY = canvasHeight - 40 + Math.sin((x + scrollOffset * 0.5) * 0.02) * 15 + Math.sin((x + scrollOffset * 0.5) * 0.008) * 25
      ctx.lineTo(x, hillY)
    }
    ctx.lineTo(canvasWidth, canvasHeight)
    ctx.closePath()
    ctx.fill()
  }, [])

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Disable image smoothing for crisp pixels
    ctx.imageSmoothingEnabled = false

    const gameLoop = (timestamp: number) => {
      // Initialize timestamp on first frame
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp
      }
      // Calculate delta time (capped to prevent huge jumps)
      const deltaTime = Math.min((timestamp - lastFrameTimeRef.current) / 1000, 0.1)
      lastFrameTimeRef.current = timestamp

      const bird = birdRef.current
      const pipes = pipesRef.current
      const currentGameState = gameStateRef.current
      const { isDark } = getThemeColors()

      // Update scroll offset when playing
      if (currentGameState === 'playing') {
        scrollOffsetRef.current += PIPE_SPEED * deltaTime
      }

      // Draw background (with parallax scrolling)
      drawBackground(ctx, canvas.width, canvas.height, isDark, scrollOffsetRef.current)

      if (currentGameState === 'playing') {
        // Update bird with delta time
        bird.velocity += GRAVITY * deltaTime
        bird.y += bird.velocity

        // Generate pipes
        if (pipes.length === 0 || pipes[pipes.length - 1].x < canvas.width - PIPE_SPACING) {
          const minHeight = 60
          const maxHeight = canvas.height - PIPE_GAP - 60
          const topHeight = Math.random() * (maxHeight - minHeight) + minHeight
          pipes.push({ x: canvas.width, topHeight, passed: false })
        }

        let gameEnded = false

        // Update pipes with delta time
        for (let i = pipes.length - 1; i >= 0; i--) {
          pipes[i].x -= PIPE_SPEED * deltaTime

          if (pipes[i].x + PIPE_WIDTH < 0) {
            pipes.splice(i, 1)
            continue
          }

          const pipe = pipes[i]
          const birdRight = bird.x + bird.width
          const birdBottom = bird.y + bird.height

          if (!gameEnded && birdRight > pipe.x && bird.x < pipe.x + PIPE_WIDTH) {
            if (bird.y < pipe.topHeight) {
              endGame()
              gameEnded = true
            } else if (birdBottom > pipe.topHeight + PIPE_GAP) {
              endGame()
              gameEnded = true
            }
          }

          if (!gameEnded && !pipe.passed && pipe.x + PIPE_WIDTH < bird.x) {
            pipe.passed = true
            scoreRef.current += 1
            setScore(scoreRef.current)
          }
        }

        if (!gameEnded && (bird.y < 0 || bird.y + bird.height > canvas.height)) {
          endGame()
        }
      }

      // Draw pipes (pixel art style)
      pipes.forEach(pipe => {
        drawPixelPipe(ctx, pipe.x, pipe.topHeight, canvas.height, isDark)
      })

      // Draw bird (pixel art style) - only when not idle
      if (currentGameState !== 'idle') {
        ctx.save()
        ctx.translate(bird.x + bird.width / 2, bird.y + bird.height / 2)
        const rotation = Math.min(Math.max(bird.velocity * 3, -25), 70) * Math.PI / 180
        ctx.rotate(rotation)
        drawPixelBird(ctx, 0, 0, isDark)
        ctx.restore()
      }

      // Draw score (pixel art)
      if (currentGameState !== 'idle') {
        const scoreStr = String(scoreRef.current)
        const scorePixelSize = 3
        const scoreWidth = scoreStr.length * 6 * scorePixelSize
        // Shadow
        drawPixelText(ctx, scoreStr, canvas.width / 2 - scoreWidth / 2 + 2, 20 + 2, scorePixelSize, 'rgba(0,0,0,0.5)')
        // Text
        drawPixelText(ctx, scoreStr, canvas.width / 2 - scoreWidth / 2, 20, scorePixelSize, '#FFFFFF')
      }

      // Draw "GAME OVER" pixel art with score (centered)
      if (currentGameState === 'gameover') {
        // Semi-transparent overlay
        ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.3)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        const textColor = '#FFFFFF'
        const shadowColor = '#000000'
        const goldColor = '#FFD700'

        // GAME OVER text (large)
        const bigPixel = 4
        const gameTextWidth = 4 * 6 * bigPixel
        const overTextWidth = 4 * 6 * bigPixel
        drawPixelText(ctx, 'GAME', canvas.width / 2 - gameTextWidth / 2 + 2, canvas.height / 2 - 80 + 2, bigPixel, shadowColor)
        drawPixelText(ctx, 'GAME', canvas.width / 2 - gameTextWidth / 2, canvas.height / 2 - 80, bigPixel, textColor)
        drawPixelText(ctx, 'OVER', canvas.width / 2 - overTextWidth / 2 + 2, canvas.height / 2 - 45 + 2, bigPixel, shadowColor)
        drawPixelText(ctx, 'OVER', canvas.width / 2 - overTextWidth / 2, canvas.height / 2 - 45, bigPixel, textColor)

        // Score display (medium)
        const medPixel = 2
        const scoreStr = String(scoreRef.current)
        const scoreLabel = 'SCORE:' + scoreStr
        const scoreLabelWidth = scoreLabel.length * 6 * medPixel
        drawPixelText(ctx, scoreLabel, canvas.width / 2 - scoreLabelWidth / 2 + 1, canvas.height / 2 + 10 + 1, medPixel, shadowColor)
        drawPixelText(ctx, scoreLabel, canvas.width / 2 - scoreLabelWidth / 2, canvas.height / 2 + 10, medPixel, textColor)

        // Best score
        const isNewBest = scoreRef.current >= highScoreRef.current && scoreRef.current > 0
        const bestLabel = isNewBest ? '*NEW BEST*' : 'BEST:' + String(highScoreRef.current)
        const bestLabelWidth = bestLabel.length * 6 * medPixel
        const bestColor = isNewBest ? goldColor : '#FFFFFF'
        drawPixelText(ctx, bestLabel, canvas.width / 2 - bestLabelWidth / 2 + 1, canvas.height / 2 + 35 + 1, medPixel, shadowColor)
        drawPixelText(ctx, bestLabel, canvas.width / 2 - bestLabelWidth / 2, canvas.height / 2 + 35, medPixel, bestColor)

        // Tap to restart hint
        const smallPixel = 2
        const tapLabel = 'TAP TO RESTART'
        const tapLabelWidth = tapLabel.length * 6 * smallPixel
        drawPixelText(ctx, tapLabel, canvas.width / 2 - tapLabelWidth / 2 + 1, canvas.height / 2 + 70 + 1, smallPixel, shadowColor)
        drawPixelText(ctx, tapLabel, canvas.width / 2 - tapLabelWidth / 2, canvas.height / 2 + 70, smallPixel, 'rgba(255,255,255,0.6)')
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current)
      }
    }
  }, [endGame, getThemeColors, drawPixelBird, drawPixelPipe, drawPixelText, drawBackground])

  const handleCanvasClick = useCallback(() => {
    if (gameStateRef.current === 'gameover') {
      restart()
    } else {
      jump()
    }
  }, [restart, jump])

  return (
    <div ref={containerRef} className="relative flex flex-col items-center justify-center h-full w-full">
      <canvas
        ref={canvasRef}
        width={400}
        height={500}
        onClick={handleCanvasClick}
        className={cn(
          "rounded-xl cursor-pointer border border-border/30 bg-muted/20 backdrop-blur-sm transition-opacity duration-300",
          gameState === 'idle' && "opacity-30"
        )}
        style={{ imageRendering: 'pixelated' }}
      />

      {/* Idle state overlay - blends into background */}
      {gameState === 'idle' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
        >
          <div className="text-center space-y-2" style={{ marginTop: '-30px' }}>
            {isTaskRunning && (
              <div className="flex items-center justify-center gap-2 mb-4">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
                <p className="text-muted-foreground text-sm">{taskStatus || t('playground.generating')}</p>
              </div>
            )}
            {idleMessage && !isTaskRunning && (
              <>
                <p className="text-muted-foreground text-sm">{idleMessage.title}</p>
                <p className="text-xs text-muted-foreground/60">{idleMessage.subtitle}</p>
              </>
            )}
            <p className="text-xs text-muted-foreground/30 mt-4">
              {t('playground.flappyBird.clickToStart')}
            </p>
          </div>
        </div>
      )}


      {/* Task running indicator */}
      {isTaskRunning && (
        <div className="absolute top-4 right-4">
          <Badge variant="secondary" className="gap-2 px-3 py-1.5 bg-background/80 backdrop-blur-sm border border-border/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            {taskStatus || t('playground.generating')}
          </Badge>
        </div>
      )}

      {/* Results available notification - show in all states */}
      {hasResults && !isTaskRunning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <Badge
            variant="default"
            className="gap-2 px-4 py-2 cursor-pointer hover:opacity-90 transition-opacity shadow-lg"
            onClick={onViewResults}
          >
            {t('playground.flappyBird.viewResults')}
          </Badge>
        </div>
      )}

      {/* Quit button - show during playing and gameover */}
      {gameState !== 'idle' && (
        <div className="absolute top-4 left-4">
          <Badge
            variant="secondary"
            className="px-3 py-1.5 cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors bg-background/80 backdrop-blur-sm border border-border/50"
            onClick={(e) => {
              e.stopPropagation()
              quitGame()
            }}
          >
            {t('playground.flappyBird.quit')}
          </Badge>
        </div>
      )}
    </div>
  )
}
