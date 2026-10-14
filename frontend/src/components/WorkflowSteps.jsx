import { ArrowRight } from 'lucide-react'

export default function WorkflowSteps({ steps, activeIndex = -1, statuses = [] }) {
  return (
    <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {steps.map(({ label, icon: Icon }, index) => {
        const state = statuses[index] || (index < activeIndex ? 'Completed' : index === activeIndex ? 'In progress' : 'Not started')
        const isActive = state === 'In progress'
        const isComplete = state === 'Completed'
        const isAttention = state === 'Needs attention' || state === 'Failed'
        return (
          <li key={label} className={`relative flex min-h-[96px] items-center gap-3 rounded-lg border px-3 py-3 transition-colors ${isActive ? 'border-teal-200 bg-teal-50/70 shadow-sm shadow-teal-900/5' : isComplete ? 'border-emerald-100 bg-emerald-50/40' : isAttention ? 'border-rose-200 bg-rose-50/50' : 'border-slate-100 bg-slate-50/70'}`}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-md border bg-white ${isComplete ? 'border-emerald-200 text-emerald-700' : isActive ? 'border-teal-300 text-teal-800 shadow-sm' : isAttention ? 'border-rose-200 text-rose-700' : 'border-slate-200 text-slate-500'}`}><Icon size={16} aria-hidden="true" /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">{label}</span><span className={`mt-1 block text-xs font-medium ${isAttention ? 'text-rose-700' : isComplete ? 'text-emerald-700' : isActive ? 'text-teal-800' : 'text-slate-400'}`}>{state}</span></span>
            {index < steps.length - 1 && <ArrowRight className="absolute -right-[11px] z-[1] hidden size-4 bg-white text-slate-300 xl:block" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
