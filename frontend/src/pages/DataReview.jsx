import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ListChecks, LoaderCircle, RefreshCw, Save, X } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import ModuleEmptyState from '../components/ModuleEmptyState.jsx'
import Button from '../components/Button.jsx'
import FormField from '../components/FormField.jsx'
import Notification from '../components/Notification.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { approveProducts, getAttributes, getValidationIssues, runValidation, updateProduct, updateProductReview } from '../services/api.js'

export default function DataReview() {
  const [searchParams] = useSearchParams()
  const importId = searchParams.get('import_id') || ''
  const severityParam = searchParams.get('severity') || ''
  const [data, setData] = useState(null)
  const [attributeDefinitions, setAttributeDefinitions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [severity, setSeverity] = useState(['error', 'warning'].includes(severityParam) ? severityParam : '')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getValidationIssues({ importId, severity, signal: controller.signal }),
      getAttributes({ signal: controller.signal }),
    ]).then(([issues, attributes]) => {
      setData(issues)
      setAttributeDefinitions(attributes)
      setError('')
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [importId, severity, refreshKey])

  function refreshReview() {
    setLoading(true)
    setError('')
    setRefreshKey((current) => current + 1)
  }

  const matchingIssueProducts = useMemo(() => new Set((data?.issues || []).map((issue) => issue.product_id)), [data])
  const filteredProducts = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return (data?.products || []).filter((product) => {
      const matchesSearch = !normalized || `${product.sku} ${product.name}`.toLowerCase().includes(normalized)
      return matchesSearch && (!severity || matchingIssueProducts.has(product.id))
    })
  }, [data, matchingIssueProducts, search, severity])

  async function revalidate() {
    setBusy(true)
    setError('')
    try {
      await runValidation(importId || undefined)
      refreshReview()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function reviewProduct(product, status) {
    let confirmWarnings = false
    if (status === 'approved' && product.issues.some((issue) => issue.severity === 'warning')) {
      confirmWarnings = window.confirm('This product has validation warnings. Approve it anyway?')
      if (!confirmWarnings) return
    }
    setBusy(true)
    setError('')
    try {
      await updateProductReview(product.id, status, confirmWarnings)
      setSelected((current) => current.filter((id) => id !== product.id))
      refreshReview()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function approveSelected() {
    const warningProducts = filteredProducts.filter((product) => selected.includes(product.id) && product.issues.some((issue) => issue.severity === 'warning'))
    const confirmWarnings = warningProducts.length > 0 && window.confirm(`Approve ${selected.length} selected products with ${warningProducts.length} product(s) that have warnings?`)
    if (warningProducts.length && !confirmWarnings) return
    setBusy(true)
    setError('')
    try {
      const result = await approveProducts(selected, confirmWarnings)
      setSelected([])
      refreshReview()
      if (result.skipped.length) setError(`${result.approved_product_ids.length} approved; ${result.skipped.length} skipped. ${result.skipped[0].reason}`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const counts = data?.summary
  const eligible = filteredProducts.filter((product) => product.validation_status !== 'unassessed' && !product.issues.some((issue) => issue.severity === 'error') && product.approval_status !== 'approved' && product.approval_status !== 'rejected')

  return <>
    <PageHeader eyebrow="DATA REVIEW" title="Catch data problems before they reach your customers." description="Identify missing fields, invalid prices, and duplicate SKUs. Correct issues and approve eligible products." action={<Button variant="secondary" disabled={busy || loading} onClick={revalidate}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Run validation</Button>} />
    {error && <div className="mb-4"><Notification tone="warning" title="Review action needs attention">{error}</Notification></div>}
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Blocking errors', counts?.errors, 'danger'],
      ['Warnings', counts?.warnings, 'warning'],
      ['Products ready', counts?.ready, 'success'],
      ['Products in view', counts?.products, 'info'],
    ].map(([label, value, tone]) => <section key={label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.035)]"><div><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{loading ? 'Loading' : value ?? 0}</p></div><StatusBadge tone={tone}>{label.split(' ')[0]}</StatusBadge></section>)}</div>
    {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle size={16} className="animate-spin" />Loading saved product issues</div> : !data?.products?.length ? <ModuleEmptyState icon={ListChecks} title="No products to review" description="Imported products will appear here with their persisted validation results." /> : <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.035)]"><div className="flex flex-wrap gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SKU or product name" aria-label="Search products to review" className="min-h-9 w-56 rounded-md border border-slate-200 px-3 text-xs outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" /><select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filter validation severity" className="min-h-9 rounded-md border border-slate-200 bg-white px-3 text-xs outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10"><option value="">All issues</option><option value="error">Blocking errors</option><option value="warning">Warnings</option></select></div><div className="flex items-center gap-2"><StatusBadge tone={eligible.length ? 'info' : 'neutral'}>{eligible.length} eligible</StatusBadge><Button disabled={!selected.length || busy} onClick={approveSelected}><Check size={14} />Approve selected ({selected.length})</Button></div></div>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]"><div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left"><thead className="bg-slate-50/80"><tr>{['', 'Row', 'SKU', 'Product', 'Issues', 'Quality', 'Approval', 'Actions'].map((label) => <th key={label} scope="col" className="border-b border-slate-200 px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</th>)}</tr></thead><tbody>{filteredProducts.map((product) => {
        const blocking = product.issues.some((issue) => issue.severity === 'error')
        const canApprove = product.validation_status !== 'unassessed' && !blocking && product.approval_status !== 'approved' && product.approval_status !== 'rejected'
        return <tr key={product.id} className={`border-b border-slate-100 align-top transition-colors last:border-0 hover:bg-slate-50/70 ${blocking ? 'bg-rose-50/20' : product.issues.length ? 'bg-amber-50/20' : ''}`}><td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${product.sku || product.name}`} checked={selected.includes(product.id)} disabled={!canApprove} onChange={(event) => setSelected((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} /></td><td className="px-3 py-3 text-xs text-slate-500">{product.source_row || '—'}</td><td className="px-3 py-3 text-xs font-semibold text-slate-800">{product.sku || 'Missing'}</td><td className="max-w-56 px-3 py-3 text-xs text-slate-700"><span className="font-medium">{product.name || 'Missing product name'}</span></td><td className="max-w-80 px-3 py-3"><div className="flex flex-wrap gap-1">{product.issues.length ? product.issues.map((issue, index) => <StatusBadge key={`${issue.code}-${index}`} tone={issue.severity === 'error' ? 'danger' : 'warning'}>{issue.field}: {issue.message}</StatusBadge>) : <StatusBadge tone="success">No issues</StatusBadge>}</div></td><td className="px-3 py-3 text-xs text-slate-600">{product.completeness == null ? 'Not assessed' : <span className="font-semibold text-slate-800">{product.completeness}%</span>}</td><td className="px-3 py-3"><StatusBadge tone={product.approval_status === 'approved' ? 'success' : product.approval_status === 'rejected' ? 'danger' : 'neutral'}>{product.approval_status.replace('_', ' ')}</StatusBadge></td><td className="px-3 py-3"><div className="flex flex-wrap gap-1.5"><Button variant="secondary" className="min-h-8 px-2.5" onClick={() => setEditingId(editingId === product.id ? null : product.id)}>{editingId === product.id ? 'Close editor' : 'Correct'}</Button><Button className="min-h-8 px-2.5" disabled={busy || !canApprove} onClick={() => reviewProduct(product, 'approved')}><Check size={13} />Approve</Button><Button variant="quiet" className="min-h-8 px-2.5" disabled={busy || product.approval_status === 'rejected'} onClick={() => reviewProduct(product, 'rejected')}><X size={13} />Reject</Button></div></td></tr>
      })}</tbody></table></div></section>
      {filteredProducts.length === 0 && <p className="py-12 text-center text-xs text-slate-500">No products match this search.</p>}
      {filteredProducts.filter((product) => product.id === editingId).map((product) => <ProductCorrection key={product.id} product={product} attributeDefinitions={attributeDefinitions} busy={busy} onCancel={() => setEditingId(null)} onSave={async (changes) => { setBusy(true); setError(''); try { await updateProduct(product.id, changes); setEditingId(null); refreshReview() } catch (requestError) { setError(requestError.message) } finally { setBusy(false) } }} />)}
    </>}
  </>
}

function ProductCorrection({ product, attributeDefinitions, busy, onCancel, onSave }) {
  const [draft, setDraft] = useState({ ...product, attributes: { ...product.attributes } })
  function update(field, value) { setDraft((current) => ({ ...current, [field]: value })) }
  function updateAttribute(key, value) { setDraft((current) => ({ ...current, attributes: { ...current.attributes, [key]: value } })) }
  async function submit(event) {
    event.preventDefault()
    await onSave({ sku: draft.sku, name: draft.name, regular_price: draft.regular_price, category: draft.category, description: draft.description, image_url: draft.image_url, attributes: draft.attributes })
  }
  const definitions = attributeDefinitions.filter((attribute) => attribute.active && (!attribute.category || attribute.category.toLowerCase() === String(draft.category || '').toLowerCase()))
  const attributeKeys = new Set(definitions.map((attribute) => attribute.key))
  const additionalAttributes = Object.entries(draft.attributes).filter(([key]) => !attributeKeys.has(key))
  return <form onSubmit={submit} className="mt-4 rounded-lg border border-teal-200 bg-white p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-800">Correct product · {product.sku || `Row ${product.source_row}`}</h2><p className="mt-1 text-[10px] text-slate-500">Saving changes reruns validation. Supplier source values remain stored separately.</p></div><Button type="button" variant="quiet" onClick={onCancel}><X size={14} />Close</Button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><FormField id={`sku-${product.id}`} label="SKU" value={draft.sku} onChange={(event) => update('sku', event.target.value)} /><FormField id={`name-${product.id}`} label="Product name" value={draft.name} onChange={(event) => update('name', event.target.value)} /><FormField id={`price-${product.id}`} label="Regular price" inputMode="decimal" value={draft.regular_price} onChange={(event) => update('regular_price', event.target.value)} /><FormField id={`category-${product.id}`} label="Category" value={draft.category} onChange={(event) => update('category', event.target.value)} /><FormField id={`image-${product.id}`} label="Image URL" value={draft.image_url} onChange={(event) => update('image_url', event.target.value)} />{definitions.map((attribute) => <FormField key={attribute.key} id={`attribute-${product.id}-${attribute.key}`} label={`${attribute.name}${attribute.required ? ' (required)' : ''}`} type={attribute.data_type} options={attribute.allowed_values} helpText={attribute.unit || undefined} value={draft.attributes[attribute.key] ?? ''} onChange={(event) => updateAttribute(attribute.key, event.target.value)} />)}{additionalAttributes.map(([key, value]) => <FormField key={key} id={`attribute-${product.id}-${key}`} label={key.replaceAll('_', ' ')} value={value} onChange={(event) => updateAttribute(key, event.target.value)} />)}</div><label className="mt-3 block text-xs font-medium text-slate-700" htmlFor={`description-${product.id}`}>Description</label><textarea id={`description-${product.id}`} rows="3" value={draft.description} onChange={(event) => update('description', event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 p-3 text-xs outline-none focus:border-teal-700" /><div className="mt-4 flex justify-end"><Button type="submit" disabled={busy}><Save size={14} />Save and revalidate</Button></div></form>
}
