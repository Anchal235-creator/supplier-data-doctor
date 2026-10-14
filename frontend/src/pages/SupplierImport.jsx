import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet, FileText, HardDriveUpload, LoaderCircle, Upload } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import Button from '../components/Button.jsx'
import Notification from '../components/Notification.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { getAttributes, previewImport, processImport, updateImportMapping } from '../services/api.js'

const FILE_LIMIT_BYTES = 10 * 1024 * 1024
const BASE_FIELDS = [
  ['sku', 'SKU'], ['name', 'Product Name'], ['regular_price', 'Regular Price'],
  ['category', 'Category'], ['description', 'Description'], ['image_url', 'Product Image URL'],
  ['dimensions', 'Dimensions'], ['surface_finish', 'Surface Finish'], ['color', 'Color'],
  ['material', 'Material'], ['water_absorption', 'Water Absorption'], ['packaging_information', 'Packaging Information'],
]

export default function SupplierImport() {
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [attributes, setAttributes] = useState([])
  const [mapping, setMapping] = useState({})
  const [stage, setStage] = useState('upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const fields = [...BASE_FIELDS, ...attributes.map((attribute) => [`attribute:${attribute.key}`, attribute.name])]
  const selectedFields = Object.values(mapping).filter(Boolean)
  const missingRequired = ['sku', 'name', 'regular_price'].filter((field) => !selectedFields.includes(field))
  const duplicateFields = new Set(selectedFields.filter((field, index) => selectedFields.indexOf(field) !== index))
  const canProcess = missingRequired.length === 0 && duplicateFields.size === 0 && !busy

  async function selectFile(selectedFile) {
    if (!selectedFile) return
    setError('')
    const extension = selectedFile.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'xlsx'].includes(extension)) {
      setError('Choose a CSV or XLSX file.')
      return
    }
    if (selectedFile.size > FILE_LIMIT_BYTES) {
      setError('The selected file exceeds the 10 MB limit.')
      return
    }
    if (inputRef.current) inputRef.current.value = ''
    setFile(selectedFile)
    setPreview(null)
    setStage('upload')
    setBusy(true)
    try {
      const result = await previewImport(selectedFile)
      setPreview(result)
      setMapping(result.mappings || {})
      try {
        setAttributes(await getAttributes())
      } catch {
        setAttributes([])
        setError('The file preview is ready, but saved attribute definitions could not be loaded.')
      }
      setStage('mapping')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveAndProcess() {
    if (!preview || !canProcess) return
    setBusy(true)
    setError('')
    try {
      await updateImportMapping(preview.import_id, mapping)
      setStage('processing')
      const result = await processImport(preview.import_id)
      setPreview({ ...preview, result })
      setStage('complete')
    } catch (requestError) {
      setError(requestError.message)
      setStage('mapping')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setMapping({})
    setStage('upload')
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <PageHeader eyebrow="SUPPLIER IMPORT" title="Every supplier file. One standard." description="Map different spreadsheet formats to a consistent product catalog without losing the original information." action={<a href="/sample-tile-supplier.csv" download className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-900/5 hover:bg-slate-50"><Download size={15} />Download synthetic sample</a>} />
      <ol className="mb-5 grid gap-2 sm:grid-cols-4" aria-label="Import steps">{[['upload', '1', 'Upload'], ['mapping', '2', 'Map columns'], ['processing', '3', 'Validate'], ['complete', '4', 'Review']].map(([key, number, label], index) => { const currentIndex = ['upload', 'mapping', 'processing', 'complete'].indexOf(stage); const done = index < currentIndex; return <li key={key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-semibold ${stage === key ? 'border-teal-200 bg-teal-50 text-teal-900 shadow-sm shadow-teal-900/5' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500'}`}><span className="grid size-5 place-items-center rounded-full bg-white text-[9px] font-bold shadow-sm">{done ? <Check size={11} /> : number}</span>{label}</li> })}</ol>
      {error && <div className="mb-4"><Notification tone="warning" title="Import could not continue">{error}</Notification></div>}

      {stage === 'upload' && <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] sm:p-7">
        <div className="mb-5"><h2 className="text-sm font-semibold text-slate-800">Upload supplier data</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">The backend parses the file and keeps it in the local workspace for mapping and review.</p></div>
        <div onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]) }} className={`flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed px-5 py-10 text-center transition ${dragging ? 'border-teal-500 bg-teal-50 shadow-inner' : 'border-teal-300 bg-gradient-to-b from-teal-50/70 to-white'}`}>
          <span className="grid size-14 place-items-center rounded-xl bg-white text-teal-800 shadow-[0_12px_30px_rgba(15,118,110,0.14)]">{busy ? <LoaderCircle size={22} className="animate-spin" /> : <HardDriveUpload size={23} aria-hidden="true" />}</span>
          <h3 className="mt-4 text-sm font-semibold text-slate-800">{busy ? 'Parsing supplier file…' : 'Drop a supplier file here'}</h3>
          <p className="mt-1.5 max-w-md text-xs leading-5 text-slate-500">CSV and XLSX files, up to 10 MB. File contents stay on your configured backend.</p>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => selectFile(event.target.files?.[0])} aria-label="Select supplier CSV or XLSX file" />
          <Button type="button" disabled={busy} className="mt-4" onClick={() => inputRef.current?.click()}><Upload size={14} />Browse files</Button>
          {file && <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 text-[10px] text-slate-500"><FileText size={13} /><span>{file.name}</span><span>{formatFileSize(file.size)}</span>{error && <Button type="button" variant="quiet" disabled={busy} className="min-h-7 px-2 text-teal-800" onClick={() => selectFile(file)}>Retry preview</Button>}</div>}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-[10px] text-slate-500"><span className="flex items-center gap-2"><FileSpreadsheet size={14} />Supported: .csv, .xlsx</span><span>Maximum size: 10 MB · Maximum rows: 10,000</span></div>
        <div className="mt-4"><Notification tone="info" title="Synthetic sample available">Download the tile CSV to test missing values, duplicate SKUs, and an invalid price through the same import flow.</Notification></div>
      </section>}

      {stage === 'mapping' && preview && <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-start gap-3"><FileText size={18} className="mt-0.5 text-teal-800" /><div><h2 className="text-xs font-semibold text-slate-800">{preview.filename}</h2><p className="mt-1 text-[10px] text-slate-500">{preview.row_count.toLocaleString()} rows · {preview.column_count} columns · {formatFileSize(file?.size || 0)}</p></div></div><StatusBadge tone="success">Preview ready</StatusBadge></div>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-800">Map supplier columns</h2><p className="mt-1 text-[11px] text-slate-500">Suggestions use normalized headers; confirm each required field.</p></div><StatusBadge tone={missingRequired.length ? 'warning' : 'success'}>Required: SKU, Product Name, Regular Price</StatusBadge></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="bg-slate-50/80"><tr>{['Supplier column', 'Sample values', 'Standard product field'].map((label) => <th key={label} className="border-b border-slate-200 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</th>)}</tr></thead><tbody>{preview.columns.map((column) => <tr key={column.name} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"><td className="px-3 py-3 text-xs font-semibold text-slate-800">{column.name}</td><td className="max-w-64 truncate px-3 py-3 text-[10px] text-slate-500">{column.sample_values.filter(Boolean).slice(0, 2).join(' · ') || 'No sample values'}</td><td className="px-3 py-2"><select aria-label={`Map ${column.name}`} value={mapping[column.name] || ''} onChange={(event) => setMapping((current) => ({ ...current, [column.name]: event.target.value || null }))} className="min-h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/10"><option value="">Do not import</option>{fields.map(([key, label]) => <option key={key} value={key}>{label}{['sku', 'name', 'regular_price'].includes(key) ? ' *' : ''}</option>)}</select></td></tr>)}</tbody></table></div>
          {duplicateFields.size > 0 && <p className="mt-3 text-[11px] text-rose-700">A product field can only be mapped from one supplier column.</p>}
          {missingRequired.length > 0 && <p className="mt-3 text-[11px] text-amber-800">Map {missingRequired.map((field) => BASE_FIELDS.find(([key]) => key === field)?.[1]).join(', ')} to continue.</p>}
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xs font-semibold text-slate-800">Data preview</h2><p className="mt-1 text-[10px] text-slate-500">Showing the first {preview.preview_rows.length} of {preview.row_count} rows.</p></div><StatusBadge>{preview.column_count} columns detected</StatusBadge></div><div className="mt-3 overflow-x-auto rounded-md border border-slate-100"><table className="w-full min-w-[560px] text-left"><thead className="bg-slate-50"><tr>{preview.columns.slice(0, 8).map((column) => <th key={column.name} className="border-b border-slate-200 px-2 py-2 text-[10px] font-semibold text-slate-500">{column.name}</th>)}</tr></thead><tbody>{preview.preview_rows.slice(0, 8).map((row, index) => <tr key={index} className="border-b border-slate-100 last:border-0">{preview.columns.slice(0, 8).map((column) => <td key={column.name} className="max-w-48 truncate px-2 py-2 text-[10px] text-slate-600">{row[column.name] || '—'}</td>)}</tr>)}</tbody></table></div></section>
        <div className="flex flex-wrap justify-between gap-3"><Button variant="secondary" onClick={reset}><ArrowLeft size={14} />Choose another file</Button><Button disabled={!canProcess} onClick={saveAndProcess}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save mapping and validate <ArrowRight size={14} /></Button></div>
      </section>}

      {stage === 'processing' && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center"><LoaderCircle size={22} className="mx-auto animate-spin text-teal-800" /><h2 className="mt-4 text-sm font-semibold text-slate-800">Validating supplier products</h2><p className="mt-1 text-xs text-slate-500">Saving mapped rows and checking configured quality rules.</p></div>}

      {stage === 'complete' && preview?.result && <section className="rounded-lg border border-slate-200 bg-white p-6"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check size={18} /></span><div><h2 className="text-sm font-semibold text-slate-800">Import processed</h2><p className="mt-1 text-xs text-slate-500">{preview.result.filename} was parsed, mapped, validated, and saved.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[['Total rows', preview.result.total_rows], ['Valid rows', preview.result.valid_rows], ['Warnings', preview.result.rows_with_warnings], ['Rows with errors', preview.result.rows_with_errors], ['Duplicate SKU rows', preview.result.duplicate_sku_count]].map(([label, value]) => <div key={label} className="rounded-md border border-slate-100 bg-slate-50 p-3"><p className="text-[10px] text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-800">{value}</p></div>)}</div><div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => navigate(`/data-review?import_id=${encodeURIComponent(preview.import_id)}`)}>Review imported products <ArrowRight size={14} /></Button><Button variant="secondary" onClick={reset}>Import another file</Button></div></section>}
    </>
  )
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
