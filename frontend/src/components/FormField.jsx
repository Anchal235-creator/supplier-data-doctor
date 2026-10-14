export default function FormField({ id, label, helpText, error, required = false, options = [], ...inputProps }) {
  const descriptionId = `${id}-description`
  const isSelect = inputProps.type === 'select' || inputProps.type === 'boolean'
  const selectOptions = inputProps.type === 'boolean' ? ['true', 'false'] : options
  if (isSelect) delete inputProps.type
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-700" aria-hidden="true">*</span>}</label>
      {isSelect ? <select id={id} required={required} aria-invalid={Boolean(error)} aria-describedby={helpText || error ? descriptionId : undefined} className="min-h-10 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" {...inputProps}><option value="">Select a value</option>{selectOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input id={id} required={required} aria-invalid={Boolean(error)} aria-describedby={helpText || error ? descriptionId : undefined} className="min-h-10 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" {...inputProps} />}
      {(error || helpText) && <p id={descriptionId} className={`text-[10px] leading-4 ${error ? 'text-rose-700' : 'text-slate-500'}`}>{error || helpText}</p>}
    </div>
  )
}
