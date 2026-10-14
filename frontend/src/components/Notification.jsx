import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

const styles = {
  info: { icon: Info, className: 'border-teal-100 bg-teal-50/70 text-teal-950' },
  warning: { icon: AlertCircle, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  success: { icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
}

export default function Notification({ tone = 'info', title, children }) {
  const { icon: Icon, className } = styles[tone] || styles.info
  return <div role={tone === 'warning' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg border p-3 ${className}`}><Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><div className="text-[11px] leading-5">{title && <p className="font-semibold">{title}</p>}<div>{children}</div></div></div>
}
