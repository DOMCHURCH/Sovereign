export default function RiskBadge({ tier, size = 'sm' }) {
  if (!tier) return null
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'
  return (
    <span className={`${pad} rounded font-mono font-semibold uppercase tracking-wider badge-${tier}`}>
      {tier}
    </span>
  )
}
