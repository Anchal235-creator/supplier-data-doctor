import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Pencil, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import Button from '../components/Button.jsx'
import FormField from '../components/FormField.jsx'
import Notification from '../components/Notification.jsx'
import { createAttribute, deleteAttribute, getAttributes, updateAttribute } from '../services/api.js'

const EMPTY_ATTRIBUTE = { name: '', key: '', data_type: 'text', required: false, category: 'Construction tiles', allowed_values: [], validation_rules: {}, unit: '', active: true }

export default function AttributeManagement() {
  const [attributes, setAttributes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getAttributes({ signal: controller.signal }).then((result) => {
      setAttributes(result)
      setError('')
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [refreshKey])

  function refreshAttributes() {
    setLoading(true)
    setError('')
    setRefreshKey((current) => current + 1)
  }

  async function save(values) {
    setSaving(true)
    setError('')
    try {
      if (editor?.id) await updateAttribute(editor.id, values)
      else await createAttribute(values)
      setEditor(null)
      refreshAttributes()
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  async function remove(attribute) {
    if (!window.confirm(`Delete the “${attribute.name}” attribute definition?`)) return
    setSaving(true)
    setError('')
    try { await deleteAttribute(attribute.id); refreshAttributes() } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  async function createTileTemplate() {
    const template = [
      { name: 'Dimensions', key: 'dimensions', data_type: 'text', required: true, unit: 'mm' },
      { name: 'Surface Finish', key: 'surface_finish', data_type: 'text' },
      { name: 'Color', key: 'color', data_type: 'text' },
      { name: 'Material', key: 'material', data_type: 'text' },
      { name: 'Water Absorption', key: 'water_absorption', data_type: 'number', unit: '%' },
      { name: 'Packaging Information', key: 'packaging_information', data_type: 'text' },
    ]
    setCreatingTemplate(true)
    setError('')
    try {
      for (const item of template) {
        await createAttribute({ ...EMPTY_ATTRIBUTE, ...item, category: 'Construction tiles' })
      }
      refreshAttributes()
    } catch (requestError) {
      setError(requestError.message)
      refreshAttributes()
    } finally {
      setCreatingTemplate(false)
    }
  }

  return <>
    <PageHeader eyebrow="ATTRIBUTE MANAGEMENT" title="Define your standard. Enforce your quality." description="Configure product-specific fields and validation rules to keep catalog data consistent." action={<div className="flex flex-wrap gap-2">{attributes.length === 0 && <Button variant="secondary" disabled={creatingTemplate || loading} onClick={createTileTemplate}><SlidersHorizontal size={14} />{creatingTemplate ? 'Creating template…' : 'Create tile starter attributes'}</Button>}<Button onClick={() => setEditor({ ...EMPTY_ATTRIBUTE })}><Plus size={15} />Add attribute</Button></div>} />
    {error && <div className="mb-4"><Notification tone="warning" title="Attribute action failed">{error}</Notification></div>}
    {editor && <AttributeForm attribute={editor} saving={saving} onCancel={() => setEditor(null)} onSave={save} />}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-800">Configured attributes</h2><p className="mt-1 text-[11px] text-slate-500">Active rules are used during product validation.</p></div><StatusBadge tone="info">{loading ? 'Loading' : `${attributes.length} configured`}</StatusBadge></div>
      {loading ? <div className="flex min-h-36 items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle size={15} className="animate-spin" />Loading saved attributes</div> : attributes.length ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead className="bg-slate-50/80"><tr>{['Name', 'Key', 'Type', 'Category', 'Requirement', 'Rules', 'Status', 'Actions'].map((label) => <th key={label} scope="col" className="border-b border-slate-200 px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</th>)}</tr></thead><tbody>{attributes.map((attribute) => <tr key={attribute.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"><td className="px-3 py-3.5 text-xs font-semibold text-slate-800">{attribute.name}</td><td className="px-3 py-3.5 font-mono text-[10px] text-slate-500">{attribute.key}</td><td className="px-3 py-3.5 text-[10px] text-slate-600"><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-medium">{attribute.data_type.replace('_', ' ')}{attribute.unit ? ` · ${attribute.unit}` : ''}</span></td><td className="px-3 py-3.5 text-xs text-slate-600">{attribute.category || 'All categories'}</td><td className="px-3 py-3.5"><StatusBadge tone={attribute.required ? 'warning' : 'neutral'}>{attribute.required ? 'Required' : 'Optional'}</StatusBadge></td><td className="max-w-64 px-3 py-3.5 text-[10px] leading-4 text-slate-500">{attribute.data_type.includes('select') ? attribute.allowed_values.join(', ') : Object.keys(attribute.validation_rules).length ? JSON.stringify(attribute.validation_rules) : 'No constraints'}</td><td className="px-3 py-3.5"><StatusBadge tone={attribute.active ? 'success' : 'neutral'}>{attribute.active ? 'Active' : 'Inactive'}</StatusBadge></td><td className="px-3 py-3.5"><div className="flex gap-1"><Button variant="secondary" className="min-h-8 px-2" aria-label={`Edit ${attribute.name}`} title="Edit attribute" onClick={() => setEditor(attribute)}><Pencil size={13} /></Button><Button variant="danger" className="min-h-8 px-2" aria-label={`Delete ${attribute.name}`} title="Delete attribute" disabled={saving} onClick={() => remove(attribute)}><Trash2 size={13} /></Button></div></td></tr>)}</tbody></table></div> : <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center"><SlidersHorizontal size={21} className="text-slate-400" /><h3 className="mt-3 text-xs font-semibold text-slate-700">No attributes configured</h3><p className="mt-1 max-w-md text-[11px] leading-5 text-slate-500">Create definitions such as tile dimensions, finish, color, material, water absorption, or packaging. Thresholds and allowed values are set by your team.</p></div>}
    </section>
  </>
}

function AttributeForm({ attribute, saving, onCancel, onSave }) {
  const [draft, setDraft] = useState({ ...EMPTY_ATTRIBUTE, ...attribute, validation_rules: { ...(attribute.validation_rules || {}) }, allowed_values: attribute.allowed_values || [] })
  const [allowedText, setAllowedText] = useState((attribute.allowed_values || []).join(', '))
  const [minimum, setMinimum] = useState(attribute.validation_rules?.min ?? '')
  const [maximum, setMaximum] = useState(attribute.validation_rules?.max ?? '')
  const [message, setMessage] = useState('')

  function changeName(value) {
    setDraft((current) => ({ ...current, name: value, key: current.id ? current.key : value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') }))
  }

  async function submit(event) {
    event.preventDefault()
    const allowedValues = allowedText.split(',').map((item) => item.trim()).filter(Boolean)
    const validationRules = {}
    if (minimum !== '') validationRules.min = Number(minimum)
    if (maximum !== '') validationRules.max = Number(maximum)
    if (Object.values(validationRules).some((value) => !Number.isFinite(value))) { setMessage('Numeric bounds must be valid numbers.'); return }
    setMessage('')
    await onSave({ ...draft, allowed_values: allowedValues, validation_rules: validationRules })
  }

  return <form onSubmit={submit} className="mb-4 rounded-lg border border-teal-200 bg-white p-5"><div className="mb-4 flex items-start justify-between"><div><h2 className="text-sm font-semibold text-slate-800">{attribute.id ? 'Edit attribute' : 'New attribute definition'}</h2><p className="mt-1 text-[10px] text-slate-500">Rules are persisted and used by subsequent validation runs.</p></div><Button type="button" variant="quiet" onClick={onCancel}><X size={14} />Cancel</Button></div>{message && <p role="alert" className="mb-3 text-xs text-rose-700">{message}</p>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><FormField id="attribute-name" label="Name" required value={draft.name} onChange={(event) => changeName(event.target.value)} /><FormField id="attribute-key" label="Unique key" required pattern="[a-z][a-z0-9_]*" helpText="Lowercase letters, numbers, and underscores." value={draft.key} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))} /><div className="grid gap-1.5"><label htmlFor="attribute-type" className="text-xs font-medium text-slate-700">Data type</label><select id="attribute-type" value={draft.data_type} onChange={(event) => setDraft((current) => ({ ...current, data_type: event.target.value }))} className="min-h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">{['text', 'number', 'boolean', 'select', 'multi_select'].map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}</select></div><FormField id="attribute-category" label="Applicable category" placeholder="Blank applies to all categories" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} /><FormField id="attribute-unit" label="Unit" placeholder="e.g. mm, %" value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} /><label className="flex min-h-10 items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={draft.required} onChange={(event) => setDraft((current) => ({ ...current, required: event.target.checked }))} />Required for products in category</label></div>{['select', 'multi_select'].includes(draft.data_type) && <FormField id="attribute-options" label="Allowed values" required helpText="Enter comma-separated exact values." value={allowedText} onChange={(event) => setAllowedText(event.target.value)} />}{draft.data_type === 'number' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><FormField id="attribute-min" label="Minimum (optional)" type="number" step="any" value={minimum} onChange={(event) => setMinimum(event.target.value)} /><FormField id="attribute-max" label="Maximum (optional)" type="number" step="any" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></div>}<div className="mt-3"><label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} />Active validation rule</label></div><div className="mt-4 flex justify-end"><Button type="submit" disabled={saving}><Check size={14} />{saving ? 'Saving…' : 'Save attribute'}</Button></div></form>
}
