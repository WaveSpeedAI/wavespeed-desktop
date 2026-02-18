import { useTranslation } from 'react-i18next'
import { getScoreColor, getScoreLabel } from '@/lib/smartGenerateUtils'

interface ScoreGaugeProps {
  score: number
  size?: number
  className?: string
}

export function ScoreGauge({ score, size = 80, className }: ScoreGaugeProps) {
  const { t } = useTranslation()
  const color = getScoreColor(score)
  const labelKey = getScoreLabel(score)

  const radius = (size - 8) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const center = size / 2

  return (
    <div className={className} style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          className="text-muted/20"
        />
        {/* Score arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground leading-tight">{t(labelKey)}</span>
      </div>
    </div>
  )
}
