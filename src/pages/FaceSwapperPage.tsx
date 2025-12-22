import { useState, useRef, useCallback, useContext, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { PageResetContext } from '@/components/layout/Layout'
import { useTranslation } from 'react-i18next'
import { useFaceSwapperWorker, type DetectedFace } from '@/hooks/useFaceSwapperWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  ArrowLeftRight,
  X,
  RefreshCw,
  Undo2,
  Maximize2
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Phase configuration for face swapper
const PHASES_WITHOUT_ENHANCE = [
  { id: 'download', labelKey: 'freeTools.progress.downloading', weight: 0.3 },
  { id: 'detect', labelKey: 'freeTools.faceSwapper.detecting', weight: 0.1 },
  { id: 'embed', labelKey: 'freeTools.faceSwapper.extractingEmbedding', weight: 0.1 },
  { id: 'swap', labelKey: 'freeTools.faceSwapper.swapping', weight: 0.5 }
]

const PHASES_WITH_ENHANCE = [
  { id: 'download', labelKey: 'freeTools.progress.downloading', weight: 0.25 },
  { id: 'detect', labelKey: 'freeTools.faceSwapper.detecting', weight: 0.1 },
  { id: 'embed', labelKey: 'freeTools.faceSwapper.extractingEmbedding', weight: 0.05 },
  { id: 'swap', labelKey: 'freeTools.faceSwapper.swapping', weight: 0.4 },
  { id: 'enhance', labelKey: 'freeTools.faceSwapper.enhancing', weight: 0.2 }
]

export function FaceSwapperPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { resetPage } = useContext(PageResetContext)
  const sourceInputRef = useRef<HTMLInputElement>(null)
  const targetInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const sourceOverlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const targetImageRef = useRef<HTMLImageElement>(null)
  const sourceImageRef = useRef<HTMLImageElement>(null)

  // Source image state (current working source)
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [sourceFaces, setSourceFaces] = useState<DetectedFace[]>([])
  const [selectedSourceFaceIndex, setSelectedSourceFaceIndex] = useState<number | null>(null)

  // Per-target-face source storage
  interface PerFaceSource {
    sourceImage: string
    sourceSize: { width: number; height: number }
    sourceFaces: DetectedFace[]
    selectedSourceFaceIndex: number
  }
  const [perFaceSourceMap, setPerFaceSourceMap] = useState<Map<number, PerFaceSource>>(new Map())

  // Target image state
  const [targetImage, setTargetImage] = useState<string | null>(null)
  const [originalTargetImage, setOriginalTargetImage] = useState<string | null>(null)
  const [targetSize, setTargetSize] = useState<{ width: number; height: number } | null>(null)
  const [targetFaces, setTargetFaces] = useState<DetectedFace[]>([])
  const [selectedFaceIndices, setSelectedFaceIndices] = useState<Set<number>>(new Set())

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)
  const [enableEnhancement, setEnableEnhancement] = useState(true)
  const [resultImage, setResultImage] = useState<string | null>(null)

  // Track swapped faces and their history for reverting
  const [swappedFaces, setSwappedFaces] = useState<Set<number>>(new Set())
  // Map of faceIndex -> resultImage before that face was swapped
  const [swapHistory, setSwapHistory] = useState<Map<number, string | null>>(new Map())

  // UI state
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showBackWarning, setShowBackWarning] = useState(false)

  // Selected target face for the working area
  const [selectedTargetFaceIndex, setSelectedTargetFaceIndex] = useState<number | null>(null)

  // Hover state for face boxes
  const [hoveredFaceIndex, setHoveredFaceIndex] = useState<number | null>(null)
  const [hoveredSourceFaceIndex, setHoveredSourceFaceIndex] = useState<number | null>(null)

  // Drag and drop state
  const [isDraggingTarget, setIsDraggingTarget] = useState(false)
  const [isDraggingSource, setIsDraggingSource] = useState(false)
  const targetDragCounterRef = useRef(0)
  const sourceDragCounterRef = useRef(0)

  // Resize trigger to redraw face boxes
  const [resizeTrigger, setResizeTrigger] = useState(0)

  // Get phases based on enhancement toggle
  const phases = enableEnhancement ? PHASES_WITH_ENHANCE : PHASES_WITHOUT_ENHANCE

  // Multi-phase progress tracking
  const {
    progress,
    startPhase,
    updatePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases
  } = useMultiPhaseProgress({ phases })

  const [error, setError] = useState<string | null>(null)

  // Reset progress when enhancement toggle changes
  useEffect(() => {
    resetProgress()
  }, [enableEnhancement, resetProgress])

  // Listen for window resize to redraw face boxes
  useEffect(() => {
    const handleResize = () => {
      setResizeTrigger(prev => prev + 1)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const { initModels, detectFaces, swapFaces, dispose, hasFailed, retryWorker } = useFaceSwapperWorker({
    onPhase: (phase) => {
      startPhase(phase)
    },
    onProgress: (phase, progressValue, detail) => {
      updatePhase(phase, progressValue, detail)
    },
    onError: (err) => {
      console.error('Worker error:', err)
      setError(err)
      setIsProcessing(false)
      setIsDetecting(false)
    }
  })

  const handleRetry = useCallback(() => {
    setError(null)
    retryWorker()
  }, [retryWorker])

  const handleBack = useCallback(() => {
    if (isProcessing || isDetecting) {
      setShowBackWarning(true)
    } else {
      dispose()
      resetPage(location.pathname)
      navigate('/free-tools')
    }
  }, [isProcessing, isDetecting, dispose, resetPage, location.pathname, navigate])

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false)
    dispose()
    resetPage(location.pathname)
    navigate('/free-tools')
  }, [dispose, resetPage, location.pathname, navigate])

  // Load image and get ImageData
  const loadImageData = useCallback((dataUrl: string): Promise<{ imageData: ImageData; width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, img.width, img.height)
        resolve({ imageData, width: img.width, height: img.height })
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = dataUrl
    })
  }, [])

  // Handle source image selection
  const handleSourceSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      setSourceImage(dataUrl)
      setSourceFaces([])
      setSelectedSourceFaceIndex(null)
      resetProgress()

      // Get dimensions
      const img = new Image()
      img.onload = () => {
        setSourceSize({ width: img.width, height: img.height })
      }
      img.src = dataUrl

      // Auto-detect faces in source
      try {
        setIsDetecting(true)
        await initModels(enableEnhancement)
        const { imageData } = await loadImageData(dataUrl)
        const faces = await detectFaces(imageData, 'source')

        if (faces.length > 0) {
          // Sort faces by area (largest first)
          const sortedFaces = [...faces].sort((a, b) => {
            const areaA = a.box.width * a.box.height
            const areaB = b.box.width * b.box.height
            return areaB - areaA
          })
          setSourceFaces(sortedFaces)
          // Auto-select first (largest) face
          setSelectedSourceFaceIndex(0)
        } else {
          setError(t('freeTools.faceSwapper.noSourceFace'))
        }
      } catch (err) {
        console.error('Failed to detect source face:', err)
      } finally {
        setIsDetecting(false)
        resetProgress() // Clear any phase progress from detection
      }
    }
    reader.readAsDataURL(file)
  }, [initModels, enableEnhancement, loadImageData, detectFaces, resetProgress, t])

  // Handle target image selection
  const handleTargetSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      setTargetImage(dataUrl)
      setOriginalTargetImage(dataUrl)
      setTargetFaces([])
      setSelectedFaceIndices(new Set())
      setSelectedTargetFaceIndex(null)
      setPerFaceSourceMap(new Map())
      setSourceImage(null)
      setSourceSize(null)
      setSourceFaces([])
      setSelectedSourceFaceIndex(null)
      setResultImage(null)
      setSwappedFaces(new Set())
      setSwapHistory(new Map())
      resetProgress()

      // Get dimensions
      const img = new Image()
      img.onload = () => {
        setTargetSize({ width: img.width, height: img.height })
      }
      img.src = dataUrl

      // Auto-detect faces in target
      try {
        setIsDetecting(true)
        await initModels(enableEnhancement)
        const { imageData } = await loadImageData(dataUrl)
        const faces = await detectFaces(imageData, 'target')

        if (faces.length > 0) {
          // Sort faces by area (largest first)
          const sortedFaces = [...faces].sort((a, b) => {
            const areaA = a.box.width * a.box.height
            const areaB = b.box.width * b.box.height
            return areaB - areaA
          })
          setTargetFaces(sortedFaces)
          // Auto-select first (largest) face
          setSelectedTargetFaceIndex(0)
          setSelectedFaceIndices(new Set([0]))
        } else {
          setError(t('freeTools.faceSwapper.noTargetFaces'))
        }
      } catch (err) {
        console.error('Failed to detect target faces:', err)
      } finally {
        setIsDetecting(false)
        resetProgress() // Clear any phase progress from detection
      }
    }
    reader.readAsDataURL(file)
  }, [initModels, enableEnhancement, loadImageData, detectFaces, resetProgress, t])

  // Drag and drop handlers for target
  const handleTargetDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      targetDragCounterRef.current = 0
      setIsDraggingTarget(false)
      if (isProcessing) return
      const file = e.dataTransfer.files[0]
      if (file) handleTargetSelect(file)
    },
    [handleTargetSelect, isProcessing]
  )

  const handleTargetDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleTargetDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    targetDragCounterRef.current++
    if (targetDragCounterRef.current === 1) {
      setIsDraggingTarget(true)
    }
  }, [])

  const handleTargetDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    targetDragCounterRef.current--
    if (targetDragCounterRef.current === 0) {
      setIsDraggingTarget(false)
    }
  }, [])

  // Drag and drop handlers for source
  const handleSourceDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      sourceDragCounterRef.current = 0
      setIsDraggingSource(false)
      if (isProcessing) return
      const file = e.dataTransfer.files[0]
      if (file) handleSourceSelect(file)
    },
    [handleSourceSelect, isProcessing]
  )

  const handleSourceDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleSourceDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    sourceDragCounterRef.current++
    if (sourceDragCounterRef.current === 1) {
      setIsDraggingSource(true)
    }
  }, [])

  const handleSourceDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    sourceDragCounterRef.current--
    if (sourceDragCounterRef.current === 0) {
      setIsDraggingSource(false)
    }
  }, [])

  // Calculate displayed image area - with object-contain, image may have letterboxing
  const getDisplayedImageArea = (img: HTMLImageElement) => {
    const containerRect = img.getBoundingClientRect()
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight

    if (!naturalWidth || !naturalHeight) {
      return {
        displayWidth: containerRect.width,
        displayHeight: containerRect.height,
        offsetX: 0,
        offsetY: 0
      }
    }

    // Calculate aspect ratios
    const containerAspect = containerRect.width / containerRect.height
    const imageAspect = naturalWidth / naturalHeight

    let displayWidth: number
    let displayHeight: number

    if (imageAspect > containerAspect) {
      // Image is wider - fits width, letterbox top/bottom
      displayWidth = containerRect.width
      displayHeight = containerRect.width / imageAspect
    } else {
      // Image is taller - fits height, pillarbox left/right
      displayHeight = containerRect.height
      displayWidth = containerRect.height * imageAspect
    }

    // Calculate offset (centered)
    const offsetX = (containerRect.width - displayWidth) / 2
    const offsetY = (containerRect.height - displayHeight) / 2

    return {
      displayWidth,
      displayHeight,
      offsetX,
      offsetY
    }
  }

  // Draw face overlay on target image
  useEffect(() => {
    if (!overlayCanvasRef.current || !targetImageRef.current || targetFaces.length === 0) return

    const canvas = overlayCanvasRef.current
    const img = targetImageRef.current
    const ctx = canvas.getContext('2d')!

    // Get image size for overlay
    const imgRect = img.getBoundingClientRect()
    const { displayWidth, displayHeight, offsetX, offsetY } = getDisplayedImageArea(img)

    // Match canvas buffer size to image size
    canvas.width = imgRect.width
    canvas.height = imgRect.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Calculate scale from actual image to displayed size
    const scaleX = displayWidth / (targetSize?.width || 1)
    const scaleY = displayHeight / (targetSize?.height || 1)

    // Draw face boxes
    targetFaces.forEach((face, idx) => {
      const isSelected = selectedFaceIndices.has(idx)
      const isHovered = hoveredFaceIndex === idx
      const box = face.box

      // Scale box coordinates to displayed size and add offset
      const x = box.x * scaleX + offsetX
      const y = box.y * scaleY + offsetY
      const w = box.width * scaleX
      const h = box.height * scaleY

      // Draw box - red for selected, cyan for hovered, blue for unselected
      ctx.strokeStyle = isSelected ? '#ef4444' : isHovered ? '#06b6d4' : '#3b82f6'
      ctx.lineWidth = isHovered ? 3 : 2
      ctx.strokeRect(x, y, w, h)

      // Fill for selected or hovered
      if (isSelected) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'
        ctx.fillRect(x, y, w, h)
      } else if (isHovered) {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.1)'
        ctx.fillRect(x, y, w, h)
      }

      // Draw index badge
      const badgeSize = 20
      ctx.fillStyle = isSelected ? '#ef4444' : isHovered ? '#06b6d4' : '#3b82f6'
      ctx.fillRect(x, y - badgeSize - 2, badgeSize, badgeSize)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(idx + 1), x + badgeSize / 2, y - badgeSize / 2 - 2)
    })
  }, [targetFaces, selectedFaceIndices, targetSize, resizeTrigger, hoveredFaceIndex])

  // Draw face overlay on source image
  useEffect(() => {
    if (!sourceOverlayCanvasRef.current || !sourceImageRef.current || sourceFaces.length === 0) return

    const canvas = sourceOverlayCanvasRef.current
    const img = sourceImageRef.current
    const ctx = canvas.getContext('2d')!

    // Get image size for overlay
    const imgRect = img.getBoundingClientRect()
    const { displayWidth, displayHeight, offsetX, offsetY } = getDisplayedImageArea(img)

    // Match canvas buffer size to image size
    canvas.width = imgRect.width
    canvas.height = imgRect.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Calculate scale from actual image to displayed size
    const scaleX = displayWidth / (sourceSize?.width || 1)
    const scaleY = displayHeight / (sourceSize?.height || 1)

    // Draw face boxes
    sourceFaces.forEach((face, idx) => {
      const isSelected = selectedSourceFaceIndex === idx
      const isHovered = hoveredSourceFaceIndex === idx
      const box = face.box

      // Scale box coordinates to displayed size and add offset
      const x = box.x * scaleX + offsetX
      const y = box.y * scaleY + offsetY
      const w = box.width * scaleX
      const h = box.height * scaleY

      // Draw box - red for selected, cyan for hovered, blue for unselected
      ctx.strokeStyle = isSelected ? '#ef4444' : isHovered ? '#06b6d4' : '#3b82f6'
      ctx.lineWidth = isHovered ? 3 : 2
      ctx.strokeRect(x, y, w, h)

      // Fill for selected or hovered
      if (isSelected) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'
        ctx.fillRect(x, y, w, h)
      } else if (isHovered) {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.1)'
        ctx.fillRect(x, y, w, h)
      }

      // Draw index badge
      const badgeSize = 20
      ctx.fillStyle = isSelected ? '#ef4444' : isHovered ? '#06b6d4' : '#3b82f6'
      ctx.fillRect(x, y - badgeSize - 2, badgeSize, badgeSize)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(idx + 1), x + badgeSize / 2, y - badgeSize / 2 - 2)
    })
  }, [sourceFaces, selectedSourceFaceIndex, sourceSize, sourceImage, resizeTrigger, hoveredSourceFaceIndex])

  // Auto-save source to per-face map when source changes
  useEffect(() => {
    if (selectedTargetFaceIndex !== null && sourceImage && sourceSize && selectedSourceFaceIndex !== null) {
      setPerFaceSourceMap(prev => {
        const newMap = new Map(prev)
        newMap.set(selectedTargetFaceIndex, {
          sourceImage,
          sourceSize,
          sourceFaces,
          selectedSourceFaceIndex
        })
        return newMap
      })
    }
  }, [selectedTargetFaceIndex, sourceImage, sourceSize, sourceFaces, selectedSourceFaceIndex])

  // Handle source face click
  const handleSourceFaceClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sourceOverlayCanvasRef.current || !sourceImageRef.current || !sourceSize) return

    const img = sourceImageRef.current
    const imgRect = img.getBoundingClientRect()
    const { displayWidth, displayHeight, offsetX, offsetY } = getDisplayedImageArea(img)

    const clickX = e.clientX - imgRect.left
    const clickY = e.clientY - imgRect.top

    // Calculate scale
    const scaleX = displayWidth / sourceSize.width
    const scaleY = displayHeight / sourceSize.height

    // Check which face was clicked
    for (let i = 0; i < sourceFaces.length; i++) {
      const face = sourceFaces[i]
      const box = face.box
      const fx = box.x * scaleX + offsetX
      const fy = box.y * scaleY + offsetY
      const fw = box.width * scaleX
      const fh = box.height * scaleY

      if (clickX >= fx && clickX <= fx + fw && clickY >= fy && clickY <= fy + fh) {
        setSelectedSourceFaceIndex(i)
        break
      }
    }
  }, [sourceFaces, sourceSize])

  // Handle target face click
  const handleFaceClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!overlayCanvasRef.current || !targetImageRef.current || !targetSize) return

    const img = targetImageRef.current
    const imgRect = img.getBoundingClientRect()
    const { displayWidth, displayHeight, offsetX, offsetY } = getDisplayedImageArea(img)

    const clickX = e.clientX - imgRect.left
    const clickY = e.clientY - imgRect.top

    // Calculate scale
    const scaleX = displayWidth / targetSize.width
    const scaleY = displayHeight / targetSize.height

    // Check which face was clicked
    for (let i = 0; i < targetFaces.length; i++) {
      const face = targetFaces[i]
      const box = face.box
      const fx = box.x * scaleX + offsetX
      const fy = box.y * scaleY + offsetY
      const fw = box.width * scaleX
      const fh = box.height * scaleY

      if (clickX >= fx && clickX <= fx + fw && clickY >= fy && clickY <= fy + fh) {
        // Select this face for the working area
        if (selectedTargetFaceIndex === i) {
          // Same face clicked - check if it's already in selectedFaceIndices
          if (selectedFaceIndices.has(i)) {
            // Clicking same face again deselects it completely
            setSelectedTargetFaceIndex(null)
            setSelectedFaceIndices(new Set())
          } else {
            // Face was in working area but not selected for swap (e.g., after a swap completed)
            // Re-add it to selectedFaceIndices to allow another swap
            setSelectedFaceIndices(new Set([i]))
          }
        } else {
          // Save current source to map before switching
          if (selectedTargetFaceIndex !== null && sourceImage && sourceSize && selectedSourceFaceIndex !== null) {
            setPerFaceSourceMap(prev => {
              const newMap = new Map(prev)
              newMap.set(selectedTargetFaceIndex, {
                sourceImage,
                sourceSize,
                sourceFaces,
                selectedSourceFaceIndex
              })
              return newMap
            })
          }

          // Switch to new face
          setSelectedTargetFaceIndex(i)
          setSelectedFaceIndices(new Set([i]))

          // Load source for this face if exists, otherwise clear
          const savedSource = perFaceSourceMap.get(i)
          if (savedSource) {
            setSourceImage(savedSource.sourceImage)
            setSourceSize(savedSource.sourceSize)
            setSourceFaces(savedSource.sourceFaces)
            setSelectedSourceFaceIndex(savedSource.selectedSourceFaceIndex)
          } else {
            setSourceImage(null)
            setSourceSize(null)
            setSourceFaces([])
            setSelectedSourceFaceIndex(null)
          }
        }
        break
      }
    }
  }, [targetFaces, targetSize, selectedTargetFaceIndex, selectedFaceIndices, sourceImage, sourceSize, sourceFaces, selectedSourceFaceIndex, perFaceSourceMap])

  // Handle face hover
  const handleFaceHover = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!overlayCanvasRef.current || !targetImageRef.current || !targetSize) {
      setHoveredFaceIndex(null)
      return
    }

    const img = targetImageRef.current
    const imgRect = img.getBoundingClientRect()
    const { displayWidth, displayHeight, offsetX, offsetY } = getDisplayedImageArea(img)

    const hoverX = e.clientX - imgRect.left
    const hoverY = e.clientY - imgRect.top

    const scaleX = displayWidth / targetSize.width
    const scaleY = displayHeight / targetSize.height

    let foundHover = false
    for (let i = 0; i < targetFaces.length; i++) {
      const face = targetFaces[i]
      const box = face.box
      const fx = box.x * scaleX + offsetX
      const fy = box.y * scaleY + offsetY
      const fw = box.width * scaleX
      const fh = box.height * scaleY

      if (hoverX >= fx && hoverX <= fx + fw && hoverY >= fy && hoverY <= fy + fh) {
        setHoveredFaceIndex(i)
        foundHover = true
        break
      }
    }
    if (!foundHover) {
      setHoveredFaceIndex(null)
    }
  }, [targetFaces, targetSize])

  // Handle source face hover
  const handleSourceFaceHover = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sourceOverlayCanvasRef.current || !sourceImageRef.current || !sourceSize) {
      setHoveredSourceFaceIndex(null)
      return
    }

    const img = sourceImageRef.current
    const imgRect = img.getBoundingClientRect()
    const { displayWidth, displayHeight, offsetX, offsetY } = getDisplayedImageArea(img)

    const hoverX = e.clientX - imgRect.left
    const hoverY = e.clientY - imgRect.top

    const scaleX = displayWidth / sourceSize.width
    const scaleY = displayHeight / sourceSize.height

    let foundHover = false
    for (let i = 0; i < sourceFaces.length; i++) {
      const face = sourceFaces[i]
      const box = face.box
      const fx = box.x * scaleX + offsetX
      const fy = box.y * scaleY + offsetY
      const fw = box.width * scaleX
      const fh = box.height * scaleY

      if (hoverX >= fx && hoverX <= fx + fw && hoverY >= fy && hoverY <= fy + fh) {
        setHoveredSourceFaceIndex(i)
        foundHover = true
        break
      }
    }
    if (!foundHover) {
      setHoveredSourceFaceIndex(null)
    }
  }, [sourceFaces, sourceSize])

  // Handle swap
  const handleSwap = async () => {
    if (!sourceImage || !targetImage || selectedSourceFaceIndex === null || selectedFaceIndices.size === 0) return

    const selectedSourceFace = sourceFaces[selectedSourceFaceIndex]
    if (!selectedSourceFace) return

    setIsProcessing(true)
    setError(null)
    resetAndStart('download')

    try {
      // Initialize models
      await initModels(enableEnhancement)

      // Load images - use resultImage if available (for iterative swapping)
      const { imageData: sourceImageData } = await loadImageData(sourceImage)
      const currentTarget = resultImage || targetImage
      const { imageData: targetImageData } = await loadImageData(currentTarget)

      // Get selected faces
      const selectedFaces = targetFaces
        .filter((_, idx) => selectedFaceIndices.has(idx))
        .map(face => ({
          landmarks: face.landmarks,
          box: face.box
        }))

      // Save current state to history before swapping (for revert)
      const prevResult = resultImage
      const faceIdx = selectedTargetFaceIndex!

      // Swap faces
      const { dataUrl } = await swapFaces({
        sourceImage: sourceImageData,
        sourceLandmarks: selectedSourceFace.landmarks,
        targetImage: targetImageData,
        targetFaces: selectedFaces
      })

      // Update history - store the state before this swap
      setSwapHistory(prev => {
        const newHistory = new Map(prev)
        // Only store if this face hasn't been swapped before
        if (!prev.has(faceIdx)) {
          newHistory.set(faceIdx, prevResult)
        }
        return newHistory
      })

      // Mark face as swapped
      setSwappedFaces(prev => new Set(prev).add(faceIdx))

      setResultImage(dataUrl)

      // Keep target face selected so user can swap with different source or adjust parameters
      completeAllPhases()
    } catch (err) {
      console.error('Swap failed:', err)
      setError(err instanceof Error ? err.message : 'Face swap failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!resultImage || !canvasRef.current) return

    // Load result image to canvas for format conversion
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current!
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)

      const mimeType = `image/${downloadFormat}`
      const quality = downloadFormat === 'png' ? undefined : 0.95
      const dataUrl = canvas.toDataURL(mimeType, quality)

      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `face-swap-${Date.now()}.${downloadFormat}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
    img.src = resultImage
  }

  // Revert a swapped face back to original
  const handleRevert = useCallback((faceIndex: number) => {
    if (!swappedFaces.has(faceIndex)) return

    // Get the result image before this face was swapped
    const prevResult = swapHistory.get(faceIndex)

    // Restore to previous state (null means original target image)
    setResultImage(prevResult ?? null)

    // Remove from swapped faces
    setSwappedFaces(prev => {
      const newSet = new Set(prev)
      newSet.delete(faceIndex)
      return newSet
    })

    // Remove from history
    setSwapHistory(prev => {
      const newHistory = new Map(prev)
      newHistory.delete(faceIndex)
      return newHistory
    })
  }, [swappedFaces, swapHistory])

  return (
    <div className="p-8 relative">
      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('freeTools.faceSwapper.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.faceSwapper.description')}
          </p>
        </div>
      </div>

      {/* Download controls - only show when result is available */}
      {resultImage && (
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <Select
            value={downloadFormat}
            onValueChange={(v) => setDownloadFormat(v as 'png' | 'jpeg' | 'webp')}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jpeg">JPEG</SelectItem>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="webp">WebP</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            {t('freeTools.faceSwapper.download')}
          </Button>
        </div>
      )}

      {/* Progress display */}
      <ProcessingProgress
        progress={progress}
        showPhases={true}
        showOverall={true}
        showEta={true}
      />

      {/* Error with retry button */}
      {error && hasFailed() && !isProcessing && (
        <div className="flex items-center justify-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg mb-6">
          <span className="text-sm text-destructive">{error}</span>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.retry')}
          </Button>
        </div>
      )}

      {/* Warning messages (non-fatal) */}
      {error && !hasFailed() && !isProcessing && (
        <div className="flex items-center justify-center gap-3 p-4 bg-warning/10 border border-warning/20 rounded-lg mb-6">
          <span className="text-sm text-warning-foreground">{error}</span>
        </div>
      )}

      {/* Main content - side by side layout */}
      <div className="flex gap-6">
        {/* Left: Target image upload */}
        <div className="flex-1 max-w-2xl">
          <Card
            className={cn(
              'border-2 transition-colors',
              isDraggingTarget
                ? 'border-primary bg-primary/5 border-dashed'
                : targetImage
                  ? 'border-muted'
                  : 'border-dashed border-muted-foreground/25 hover:border-primary/50 cursor-pointer'
            )}
            onClick={() => !targetImage && !isProcessing && targetInputRef.current?.click()}
            onDrop={handleTargetDrop}
            onDragOver={handleTargetDragOver}
            onDragEnter={handleTargetDragEnter}
            onDragLeave={handleTargetDragLeave}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4" />
                  {t('freeTools.faceSwapper.targetTitle')}
                </span>
                <div className="flex items-center gap-2">
                  {targetSize && targetImage && (
                    <span className="text-xs text-muted-foreground">
                      {targetSize.width} x {targetSize.height}
                    </span>
                  )}
                  {targetImage && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreviewImage(resultImage || targetImage)
                        }}
                        title={t('assets.preview')}
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation()
                          targetInputRef.current?.click()
                        }}
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        {t('freeTools.faceSwapper.change')}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {!targetImage ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="p-4 rounded-full bg-muted mb-4">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">{t('freeTools.faceSwapper.selectTarget')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('freeTools.faceSwapper.orDragDrop')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('freeTools.faceSwapper.targetHint')}
                  </p>
                </div>
              ) : (
                <div className="relative bg-muted rounded-lg">
                  <img
                    ref={targetImageRef}
                    src={resultImage || targetImage}
                    alt={resultImage ? "Result" : "Target"}
                    className="w-full max-h-[70vh] object-contain cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewImage(resultImage || targetImage)
                    }}
                  />
                  {/* Face selection overlay - always show for interaction */}
                  {targetFaces.length > 0 && (
                    <canvas
                      ref={overlayCanvasRef}
                      className="absolute inset-0 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleFaceClick(e)
                      }}
                      onMouseMove={handleFaceHover}
                      onMouseLeave={() => setHoveredFaceIndex(null)}
                    />
                  )}
                  {targetFaces.length > 0 && (
                    <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                      <div className="px-2 py-1 bg-black/70 text-white text-xs rounded">
                        {resultImage ? t('freeTools.faceSwapper.clickToSwapMore') : t('freeTools.faceSwapper.clickFaceToSwap')}
                      </div>
                      <div className="px-2 py-1 bg-blue-500/90 text-white text-xs rounded">
                        {targetFaces.length} {targetFaces.length === 1 ? 'face' : 'faces'}
                      </div>
                    </div>
                  )}
                  {isDetecting && targetFaces.length === 0 && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Working area - always reserve space when target image exists */}
        {targetImage && (
          <div className="flex-1 min-w-[400px]">
            {selectedTargetFaceIndex !== null ? (
            <Card className="border-2 border-muted">
              <CardContent className="p-4 space-y-4">
                {/* Source image upload with drag and drop */}
                <div>
                  <div className="text-sm font-medium mb-2">{t('freeTools.faceSwapper.sourceFace')}</div>
                  <div
                    className={cn(
                      "bg-muted rounded-lg cursor-pointer border-2 border-dashed transition-colors overflow-hidden",
                      isDraggingSource
                        ? "border-primary bg-primary/5"
                        : sourceImage
                          ? "border-transparent"
                          : "border-muted-foreground/25 hover:border-primary/50"
                    )}
                    onClick={() => sourceInputRef.current?.click()}
                    onDrop={handleSourceDrop}
                    onDragOver={handleSourceDragOver}
                    onDragEnter={handleSourceDragEnter}
                    onDragLeave={handleSourceDragLeave}
                  >
                    {!sourceImage ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">{t('freeTools.faceSwapper.selectSource')}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t('freeTools.faceSwapper.orDragDrop')}</p>
                      </div>
                    ) : (
                      <div className="relative">
                        <img
                          ref={sourceImageRef}
                          src={sourceImage}
                          alt="Source"
                          className="w-full max-h-[50vh] object-contain"
                          onLoad={() => setResizeTrigger(prev => prev + 1)}
                        />
                        {sourceFaces.length > 0 && (
                          <canvas
                            ref={sourceOverlayCanvasRef}
                            className="absolute inset-0 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSourceFaceClick(e)
                            }}
                            onMouseMove={handleSourceFaceHover}
                            onMouseLeave={() => setHoveredSourceFaceIndex(null)}
                          />
                        )}
                        {isDetecting && sourceFaces.length === 0 && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-white" />
                          </div>
                        )}
                        {sourceFaces.length > 0 && selectedSourceFaceIndex !== null && (
                          <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-red-500/90 text-white text-xs rounded">
                            Face #{selectedSourceFaceIndex + 1}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Enhancement toggle and Swap button */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                    <Switch
                      id="enhance-panel"
                      checked={enableEnhancement}
                      onCheckedChange={setEnableEnhancement}
                      disabled={isProcessing}
                    />
                    <Label htmlFor="enhance-panel" className="text-xs whitespace-nowrap">{t('freeTools.faceSwapper.enhanceFace')}</Label>
                  </div>
                  <Button
                    className="flex-1"
                    onClick={handleSwap}
                    disabled={!sourceImage || selectedSourceFaceIndex === null || isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('freeTools.faceSwapper.swapping')}
                      </>
                    ) : (
                      <>
                        <ArrowLeftRight className="h-4 w-4 mr-2" />
                        {t('freeTools.faceSwapper.swap')}
                      </>
                    )}
                  </Button>
                </div>

                {/* Target and Swapped face previews side by side */}
                <div className="flex gap-4">
                  {/* Target face (original) */}
                  <div className="flex-1">
                    <div className="mb-2">
                      <span className="text-sm font-medium">
                        {t('freeTools.faceSwapper.targetFace')}
                      </span>
                    </div>
                    <div className="bg-muted rounded-lg overflow-hidden flex items-center justify-center p-2 min-h-[180px]">
                      <canvas
                        key={`target-${selectedTargetFaceIndex}`}
                        ref={(canvas) => {
                          if (!canvas || !targetImage || selectedTargetFaceIndex === null) return
                          const face = targetFaces[selectedTargetFaceIndex]
                          if (!face) return
                          const img = new Image()
                          img.onload = () => {
                            const padding = 0.3
                            const padX = face.box.width * padding
                            const padY = face.box.height * padding
                            const cropX = Math.max(0, face.box.x - padX)
                            const cropY = Math.max(0, face.box.y - padY)
                            const cropW = Math.min(img.width - cropX, face.box.width + padX * 2)
                            const cropH = Math.min(img.height - cropY, face.box.height + padY * 2)

                            const maxSize = 160
                            const scale = Math.min(maxSize / cropW, maxSize / cropH, 1)
                            canvas.width = cropW * scale
                            canvas.height = cropH * scale

                            const ctx = canvas.getContext('2d')!
                            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)
                          }
                          // Always use original target image
                          img.src = originalTargetImage || targetImage
                        }}
                        className="mx-auto rounded"
                      />
                    </div>
                    <div className="text-center text-xs text-muted-foreground mt-1">
                      Face #{selectedTargetFaceIndex + 1}
                    </div>
                  </div>

                  {/* Swapped face (result) */}
                  <div className="flex-1">
                    <div className="mb-2">
                      <span className="text-sm font-medium">
                        {t('freeTools.faceSwapper.swappedFace')}
                      </span>
                    </div>
                    <div className="bg-muted rounded-lg overflow-hidden flex items-center justify-center p-2 min-h-[180px]">
                      {resultImage && selectedTargetFaceIndex !== null && swappedFaces.has(selectedTargetFaceIndex) ? (
                        <canvas
                          key={`swapped-${selectedTargetFaceIndex}`}
                          ref={(canvas) => {
                            if (!canvas || !resultImage || selectedTargetFaceIndex === null) return
                            const face = targetFaces[selectedTargetFaceIndex]
                            if (!face) return
                            const img = new Image()
                            img.onload = () => {
                              const padding = 0.3
                              const padX = face.box.width * padding
                              const padY = face.box.height * padding
                              const cropX = Math.max(0, face.box.x - padX)
                              const cropY = Math.max(0, face.box.y - padY)
                              const cropW = Math.min(img.width - cropX, face.box.width + padX * 2)
                              const cropH = Math.min(img.height - cropY, face.box.height + padY * 2)

                              const maxSize = 160
                              const scale = Math.min(maxSize / cropW, maxSize / cropH, 1)
                              canvas.width = cropW * scale
                              canvas.height = cropH * scale

                              const ctx = canvas.getContext('2d')!
                              ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)
                            }
                            img.src = resultImage
                          }}
                          className="mx-auto rounded"
                        />
                      ) : (
                        <div key="placeholder" className="text-xs text-muted-foreground text-center px-2">
                          {t('freeTools.faceSwapper.swappedFacePlaceholder')}
                        </div>
                      )}
                    </div>
                    {selectedTargetFaceIndex !== null && swappedFaces.has(selectedTargetFaceIndex) && (
                      <div className="flex items-center justify-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {t('freeTools.faceSwapper.swapped')}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleRevert(selectedTargetFaceIndex)}
                          disabled={isProcessing}
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          {t('freeTools.faceSwapper.revert')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                {t('freeTools.faceSwapper.clickFaceToSwap')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={sourceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleSourceSelect(file)
          e.target.value = ''
        }}
      />
      <input
        ref={targetInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleTargetSelect(file)
          e.target.value = ''
        }}
      />

      {/* Fullscreen Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent
          className="w-screen h-screen max-w-none max-h-none p-0 border-0 bg-black flex items-center justify-center"
          hideCloseButton
        >
          <DialogTitle className="sr-only">Fullscreen Preview</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
            onClick={() => setPreviewImage(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          {previewImage && (
            <img
              src={previewImage}
              alt="Fullscreen preview"
              className="max-w-full max-h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Back Warning Dialog */}
      <AlertDialog open={showBackWarning} onOpenChange={setShowBackWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('freeTools.backWarning.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('freeTools.backWarning.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('freeTools.backWarning.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBack}>
              {t('freeTools.backWarning.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
