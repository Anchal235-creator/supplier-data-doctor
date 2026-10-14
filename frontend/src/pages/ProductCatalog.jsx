import { useEffect, useState } from 'react'
import { Image, LoaderCircle, PackagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import Button from '../components/Button.jsx'
import FormField from '../components/FormField.jsx'
import Notification from '../components/Notification.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { createProduct, deleteProduct, getAttributes, getProducts, updateProduct } from '../services/api.js'

const EMPTY_PRODUCT = { sku: '', name: '', regular_price: '', category: '', description: '', image_url: '', attributes: {} }

export default function ProductCatalog() {
  const [data, setData] = useState(null)
  const [attributes, setAttributes] = useState([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [approvalStatus, setApprovalStatus] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const pageSize = 25

  useEffect(() => {
    const controller = new AbortController()
    getProducts({ search, category, approvalStatus, page, pageSize, signal: controller.signal }).then((result) => {
      setData(result)
      setError('')
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [search, category, approvalStatus, page, refreshKey])

  useEffect(() => {
    getAttributes().then(setAttributes).catch(() => setAttributes([]))
  }, [])

  function refreshCatalog() {
    setLoading(true)
    setError('')
    setRefreshKey((current) => current + 1)
  }

  async function saveProduct(values) {
    setBusy(true)
    setError('')
    try {
      if (editor?.id) await updateProduct(editor.id, values)
      else await createProduct(values)
      setEditor(null)
      refreshCatalog()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeProduct(product) {
    if (!window.confirm(`Delete ${product.name || product.sku || `product ${product.id}`}? This cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteProduct(product.id)
      refreshCatalog()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))

  return <>
    <PageHeader eyebrow="PRODUCT CATALOG" title="One reliable source of product truth." description="Keep product information, attributes, prices, and approval status organized in one catalog." action={<Button onClick={() => setEditor({ ...EMPTY_PRODUCT })}><Plus size={15} />Add product</Button>} />
    {error && <div className="mb-4"><Notification tone="warning" title="Catalog action failed">{error}</Notification></div>}
    {editor && <ProductEditor key={editor.id || 'new'} product={editor} attributes={attributes} busy={busy} onCancel={() => setEditor(null)} onSave={saveProduct} />}

    <section aria-label="Catalog filters" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.035)]">
      <form className="flex min-w-56 flex-1 items-center gap-2" role="search" onSubmit={(event) => { event.preventDefault(); setLoading(true); setPage(1); setSearch(query.trim()) }}><label className="sr-only" htmlFor="catalog-search">Search SKU or product name</label><div className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 focus-within:border-teal-700 focus-within:ring-2 focus-within:ring-teal-700/10"><Search size={15} className="shrink-0 text-slate-400" /><input id="catalog-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU or product name" className="min-w-0 flex-1 border-0 text-xs outline-none" /></div><Button type="submit" variant="secondary">Search</Button></form>
      <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="catalog-category">Filter category</label><select id="catalog-category" value={category} onChange={(event) => { setLoading(true); setPage(1); setCategory(event.target.value) }} className="min-h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10"><option value="">All categories</option>{(data?.categories || []).map((item) => <option key={item} value={item}>{item}</option>)}</select><label className="sr-only" htmlFor="catalog-status">Filter approval status</label><select id="catalog-status" value={approvalStatus} onChange={(event) => { setLoading(true); setPage(1); setApprovalStatus(event.target.value) }} className="min-h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10"><option value="">All approval states</option><option value="pending_review">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
    </section>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      {loading ? <div className="flex min-h-64 items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle size={16} className="animate-spin" />Loading saved catalog records</div> : error && !data ? <div className="p-10 text-center text-xs text-slate-500">Catalog records could not be loaded.</div> : data?.items?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left"><thead className="bg-slate-50/80"><tr>{['Product', 'SKU', 'Category', 'Price', 'Completeness', 'Approval', 'WooCommerce', 'Actions'].map((label) => <th key={label} scope="col" className="border-b border-slate-200 px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</th>)}</tr></thead><tbody>{data.items.map((product) => <tr key={product.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"><td className="px-3 py-3.5"><div className="flex items-center gap-3"><ProductThumbnail src={product.image_url} /><div><p className="max-w-64 truncate text-xs font-semibold text-slate-900">{product.name || 'Missing product name'}</p><p className="mt-1 text-[10px] font-medium text-slate-400">{product.validation_status.replaceAll('_', ' ')}</p></div></div></td><td className="px-3 py-3.5 text-xs font-semibold text-slate-800">{product.sku || '—'}</td><td className="px-3 py-3.5 text-xs text-slate-600">{product.category ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700">{product.category}</span> : '—'}</td><td className="px-3 py-3.5 text-xs text-slate-700">{product.regular_price || '—'}</td><td className="px-3 py-3.5 text-xs text-slate-600">{product.completeness == null ? 'Not assessed' : <span className="font-semibold text-slate-800">{product.completeness}%</span>}</td><td className="px-3 py-3.5"><StatusBadge tone={product.approval_status === 'approved' ? 'success' : product.approval_status === 'rejected' ? 'danger' : 'neutral'}>{product.approval_status.replaceAll('_', ' ')}</StatusBadge></td><td className="px-3 py-3.5">{product.woocommerce_product_id ? <StatusBadge tone="success">#{product.woocommerce_product_id}</StatusBadge> : <StatusBadge>Not synced</StatusBadge>}</td><td className="px-3 py-3.5"><div className="flex gap-1"><Button variant="secondary" className="min-h-8 px-2" aria-label={`Edit ${product.name || product.sku}`} title="Edit product" onClick={() => setEditor(product)}><Pencil size={13} /></Button><Button variant="danger" className="min-h-8 px-2" aria-label={`Delete ${product.name || product.sku}`} title="Delete product" disabled={busy} onClick={() => removeProduct(product)}><Trash2 size={13} /></Button></div></td></tr>)}</tbody></table></div> : <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center"><PackagePlus size={22} className="text-slate-400" /><p className="mt-3 text-xs font-semibold text-slate-700">{search || category || approvalStatus ? 'No matching products' : 'Your catalog is empty'}</p><p className="mt-1 max-w-md text-[11px] leading-5 text-slate-500">{search || category || approvalStatus ? 'Change the search or filters to see other saved records.' : 'Imported or manually created products will appear here after they are saved.'}</p></div>}
      {data?.total > 0 && <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[10px] text-slate-500"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => current - 1) }}>Previous</Button><span className="self-center">Page {page} of {totalPages}</span><Button variant="secondary" disabled={page >= totalPages} onClick={() => { setLoading(true); setPage((current) => current + 1) }}>Next</Button></div></footer>}
    </section>
  </>
}

function ProductThumbnail({ src }) {
  const [failed, setFailed] = useState(false)
  return src && !failed
    ? <img src={src} alt="" loading="lazy" className="size-9 rounded-md border border-slate-200 object-cover" onError={() => setFailed(true)} />
    : <span className="grid size-9 place-items-center rounded-md border border-slate-200 bg-slate-50 text-slate-400"><Image size={15} aria-hidden="true" /></span>
}

function ProductEditor({ product, attributes, busy, onCancel, onSave }) {
  const [draft, setDraft] = useState({ ...EMPTY_PRODUCT, ...product, attributes: { ...(product.attributes || {}) } })
  const [formError, setFormError] = useState('')

  async function submit(event) {
    event.preventDefault()
    const values = { ...draft, regular_price: String(draft.regular_price || '').trim() }
    if (!values.sku.trim() || !values.name.trim() || !values.regular_price) {
      setFormError('SKU, product name, and regular price are required.')
      return
    }
    setFormError('')
    await onSave(values)
  }

  const applicableAttributes = attributes.filter((attribute) => attribute.active && (!attribute.category || attribute.category.toLowerCase() === String(draft.category || '').toLowerCase()))
  return <form onSubmit={submit} className="mb-4 rounded-lg border border-teal-200 bg-white p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-800">{product.id ? 'Edit product' : 'Add product'}</h2><p className="mt-1 text-[10px] text-slate-500">Saving changes persists the record and reruns validation.</p></div><Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button></div>{formError && <p role="alert" className="mb-3 text-xs text-rose-700">{formError}</p>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[['sku', 'SKU'], ['name', 'Product name'], ['regular_price', 'Regular price'], ['category', 'Category'], ['image_url', 'Image URL']].map(([key, label]) => <FormField key={key} id={`catalog-${key}`} label={label} required={['sku', 'name', 'regular_price'].includes(key)} value={draft[key] || ''} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />)}{applicableAttributes.map((attribute) => <FormField key={attribute.id} id={`catalog-attribute-${attribute.key}`} label={`${attribute.name}${attribute.required ? ' (required)' : ''}`} type={attribute.data_type} options={attribute.allowed_values} value={draft.attributes[attribute.key] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, attributes: { ...current.attributes, [attribute.key]: event.target.value } }))} />)}</div><label htmlFor="catalog-description" className="mt-3 block text-xs font-medium text-slate-700">Description</label><textarea id="catalog-description" rows="3" value={draft.description || ''} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-200 p-3 text-xs outline-none focus:border-teal-700" /><div className="mt-4 flex justify-end"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</Button></div></form>
}
