import { ArrowRight } from 'lucide-react'

export default function ModuleEmptyState({ icon: Icon, title, description, action }) {
  return (
    <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-[0_10px_30px_rgba(15,23,42,0.035)]">
      <span className="grid size-11 place-items-center rounded-lg bg-teal-50 text-teal-800"><Icon size={20} aria-hidden="true" /></span>
      <h2 className="mt-4 text-sm font-semibold text-slate-800">{title}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">{description}</p>
      {action && <span className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-slate-400">{action} <ArrowRight size={14} /></span>}
    </section>
  )
}
