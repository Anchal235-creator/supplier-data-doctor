const tones = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
  info: 'border-teal-200 bg-teal-50 text-teal-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
}

export default function StatusBadge({ children, tone = 'neutral' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none ${tones[tone] || tones.neutral}`}>{children}</span>
}
