import { useEffect, useState } from 'react'
import { ArrowDownToLine, Check, CircleAlert, LoaderCircle, RefreshCw, Wifi } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import ModuleEmptyState from '../components/ModuleEmptyState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import Button from '../components/Button.jsx'
import Notification from '../components/Notification.jsx'
import { getHealth, getSyncHistory, getWooCommerceStatus, retrySync, syncProducts, testWooCommerceConnection } from '../services/api.js'

export default function WooCommerceSync() {
  const [connection, setConnection] = useState(null)
  const [apiHealth, setApiHealth] = useState('checking')
  const [history, setHistory] = useState([])
  const [eligibleCount, setEligibleCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getHealth({ signal: controller.signal }).then(() => setApiHealth('online')).catch((requestError) => {
      if (requestError.name !== 'AbortError') setApiHealth('offline')
    })
    Promise.all([
      getWooCommerceStatus({ signal: controller.signal }),
      getSyncHistory({ signal: controller.signal }),
    ]).then(([status, syncHistory]) => {
      setConnection(status)
      setHistory(syncHistory)
      setEligibleCount(status.eligible_products || 0)
      setError('')
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [refreshKey])

  function refreshSyncData() {
    setLoading(true)
    setError('')
    setRefreshKey((current) => current + 1)
  }

  async function testConnection() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await testWooCommerceConnection()
      setConnection(result)
      setNotice(result.message)
      refreshSyncData()
    } catch (requestError) {
      setError(requestError.message)
      if (requestError.status === 503) setConnection({ configured: false, status: 'not_configured' })
      else setConnection((current) => ({ ...current, configured: true, status: 'failed' }))
    } finally {
      setBusy(false)
    }
  }

  async function startSync() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await syncProducts()
      setNotice(`${result.succeeded} product(s) synchronized; ${result.failed} failed.`)
      refreshSyncData()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function retry(syncId) {
    setBusy(true)
    setError('')
    try {
      const result = await retrySync(syncId)
      if (result.status === 'failed') setError(result.error)
      else setNotice(`Product ${result.operation} successfully.`)
      refreshSyncData()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const connected = connection?.status === 'connected'
  const failedCount = history.filter((item) => item.status === 'failed').length
  const successCount = history.filter((item) => item.status === 'success').length
  const lastAttempt = history[0]?.attempted_at

  return <>
    <PageHeader eyebrow="WOOCOMMERCE SYNC" title="Publish with confidence." description="Test the store connection, then publish approved, validated products and track confirmed synchronization outcomes." action={<Button disabled={busy || loading || !connected || !eligibleCount} onClick={startSync}><ArrowDownToLine size={15} />{busy ? 'Working…' : `Sync approved products (${eligibleCount})`}</Button>} />
    {error && <div className="mb-4"><Notification tone="warning" title="WooCommerce action failed">{error}</Notification></div>}
    {notice && <div className="mb-4"><Notification tone="success" title="WooCommerce response">{notice}</Notification></div>}
    <section className="mb-4 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"><div className="flex items-start gap-3"><span className={`grid size-9 place-items-center rounded-md ${apiHealth === 'online' ? 'bg-emerald-50 text-emerald-700' : apiHealth === 'offline' ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-500'}`}>{apiHealth === 'offline' ? <CircleAlert size={17} /> : <Check size={17} />}</span><div><h2 className="text-sm font-semibold text-slate-800">Backend health</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">FastAPI must be reachable before store checks or sync attempts can run.</p><div className="mt-3"><StatusBadge tone={apiHealth === 'online' ? 'success' : apiHealth === 'offline' ? 'danger' : 'neutral'}>{apiHealth === 'online' ? 'API available' : apiHealth === 'offline' ? 'API unavailable' : 'Checking API'}</StatusBadge></div></div></div></div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-start gap-3"><span className={`grid size-9 place-items-center rounded-md ${connected ? 'bg-emerald-50 text-emerald-700' : connection?.status === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-500'}`}>{connected ? <Check size={17} /> : connection?.status === 'failed' ? <CircleAlert size={17} /> : <Wifi size={17} />}</span><div><h2 className="text-sm font-semibold text-slate-800">Store connection</h2><p className="mt-1 text-[11px] text-slate-500">Credentials are read only by FastAPI from backend/.env; they are never sent to the browser.</p></div></div><div className="flex items-center gap-2"><StatusBadge tone={connected ? 'success' : connection?.status === 'failed' ? 'danger' : 'warning'}>{loading ? 'Checking' : connection?.status?.replaceAll('_', ' ') || 'Unavailable'}</StatusBadge><Button variant="secondary" disabled={busy || loading} onClick={testConnection}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Test connection</Button></div></div>
      {!connected && <div className="mt-4"><Notification tone={connection?.status === 'not_configured' ? 'info' : 'warning'} title={connection?.status === 'not_configured' ? 'Configuration required' : connection?.status === 'failed' ? 'Connection test failed' : 'Connection has not been verified'}>{connection?.status === 'not_configured' ? 'Set WOOCOMMERCE_STORE_URL, WOOCOMMERCE_CONSUMER_KEY, and WOOCOMMERCE_CONSUMER_SECRET in backend/.env, then restart FastAPI.' : connection?.message || 'Run a live connection test before synchronizing products.'}</Notification></div>}
      <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 xl:grid-cols-4">{[['Last synchronization attempt', lastAttempt ? new Date(lastAttempt).toLocaleString() : 'No sync recorded'], ['Approved products ready', loading ? 'Loading' : eligibleCount], ['Successful sync records', loading ? 'Loading' : successCount], ['Failed records', loading ? 'Loading' : failedCount]].map(([label, value]) => <div key={label} className="rounded-md bg-slate-50 px-3 py-2.5"><dt className="text-[10px] text-slate-500">{label}</dt><dd className="mt-1 text-xs font-semibold text-slate-800">{value}</dd></div>)}</dl>
      </div>
    </section>
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-800">Synchronization history</h2><p className="mt-1 text-[10px] text-slate-500">Persisted attempts and safe error summaries.</p></div><StatusBadge>{history.length} attempts</StatusBadge></div>{loading ? <div className="flex min-h-36 items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle size={15} className="animate-spin" />Loading sync history</div> : history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-slate-50/80"><tr>{['Product', 'Operation', 'Attempted', 'Result', 'WooCommerce ID', 'Details'].map((label) => <th key={label} className="border-b border-slate-200 px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</th>)}</tr></thead><tbody>{history.map((item) => <tr key={item.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"><td className="px-3 py-3 text-xs font-semibold text-slate-800">{item.name || item.sku || `Product ${item.product_id}`}</td><td className="px-3 py-3 text-xs text-slate-600">{item.operation}</td><td className="px-3 py-3 text-[10px] text-slate-500">{new Date(item.attempted_at).toLocaleString()}</td><td className="px-3 py-3"><StatusBadge tone={item.status === 'success' ? 'success' : item.status === 'skipped' ? 'warning' : 'danger'}>{item.status}</StatusBadge></td><td className="px-3 py-3 text-xs text-slate-600">{item.woocommerce_product_id || '—'}</td><td className="px-3 py-3 text-[10px] text-slate-600">{item.error_message || 'Store confirmed response'}{item.status === 'failed' && <button disabled={busy || !connected} onClick={() => retry(item.id)} className="ml-2 inline-flex items-center gap-1 font-semibold text-teal-800 underline disabled:text-slate-400"><RefreshCw size={11} />Retry</button>}</td></tr>)}</tbody></table></div> : <ModuleEmptyState icon={ArrowDownToLine} title="No synchronization attempts" description="A successful connection test and eligible approved products are required before sync can begin." />}</section>
  </>
}
