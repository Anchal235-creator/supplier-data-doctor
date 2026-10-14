export default function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#006B63]">{eyebrow}</p>}
        <h1 className="font-display text-[28px] font-semibold leading-tight text-slate-950 sm:text-[32px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-600">{description}</p>}
      </div>
      {action}
    </div>
  )
}
