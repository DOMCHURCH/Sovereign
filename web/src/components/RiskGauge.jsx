export default function RiskGauge({ score, size = 80 }) {
  if (score == null) return null

  const r = size * 0.38
  const cx = size / 2
  const cy = size / 2
  const circumference = Math.PI * r  // semicircle
  const filled = (score / 100) * circumference

  const color =
    score <= 25 ? '#22c55e' :
    score <= 50 ? '#eab308' :
    score <= 75 ? '#f97316' : '#ef4444'

  const startAngle = Math.PI
  const endAngle = 0

  const polarToCartesian = (angle) => ({
    x: cx + r * Math.cos(angle),
    y: cy - r * Math.sin(angle),
  })

  const start = polarToCartesian(startAngle)
  const end = polarToCartesian(endAngle)
  const filledEnd = polarToCartesian(startAngle + (score / 100) * Math.PI)

  return (
    <svg width={size} height={size * 0.6} viewBox={`0 0 ${size} ${size * 0.6}`}>
      {/* Track */}
      <path
        d={`M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`}
        fill="none" stroke="#1e1e2e" strokeWidth="6" strokeLinecap="round"
      />
      {/* Filled arc */}
      <path
        d={`M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${filledEnd.x} ${filledEnd.y}`}
        fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
      />
      <text x={cx} y={size * 0.55} textAnchor="middle" fill={color}
            fontSize={size * 0.22} fontWeight="700" fontFamily="JetBrains Mono, monospace">
        {Math.round(score)}
      </text>
    </svg>
  )
}
