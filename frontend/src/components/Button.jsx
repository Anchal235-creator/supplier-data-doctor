const variants = {
  primary: 'bg-[#006B63] text-white shadow-sm shadow-teal-900/10 hover:bg-teal-800 focus-visible:outline-teal-700',
  secondary: 'border border-slate-200 bg-white text-[#172033] shadow-sm shadow-slate-900/5 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-teal-700',
  light: 'bg-white text-[#10172A] shadow-sm shadow-black/10 hover:bg-teal-50 focus-visible:outline-white',
  quiet: 'bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:outline-teal-700',
  danger: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 focus-visible:outline-rose-600',
}

export default function Button({ as: Component = 'button', variant = 'primary', className = '', ...props }) {
  return <Component className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 ${variants[variant] || variants.primary} ${className}`} {...props} />
}
