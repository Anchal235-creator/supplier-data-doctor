export default function DataTable({ columns, rows = [], emptyTitle, emptyDescription, emptyIcon: EmptyIcon }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="bg-slate-50/80"><tr>{columns.map((column) => <th key={column.key} scope="col" className="border-b border-slate-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{column.label}</th>)}</tr></thead>
          <tbody>
            {rows.length > 0 ? rows.map((row, rowIndex) => <tr key={row.id ?? rowIndex} className="border-b border-slate-100 align-top transition-colors last:border-0 hover:bg-slate-50/70">{columns.map((column) => <td key={column.key} className="px-4 py-4 text-sm text-slate-700">{column.render ? column.render(row) : row[column.key]}</td>)}</tr>) : <tr><td colSpan={columns.length} className="p-0"><div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">{EmptyIcon && <EmptyIcon size={22} className="text-slate-400" aria-hidden="true" />}<p className="mt-3 text-sm font-semibold text-slate-700">{emptyTitle}</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{emptyDescription}</p></div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
