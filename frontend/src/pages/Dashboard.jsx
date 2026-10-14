import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  Boxes,
  CheckCheck,
  ClipboardCheck,
  FileInput,
  Package,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import Card from '../components/Card.jsx'
import WorkflowSteps from '../components/WorkflowSteps.jsx'
import Button from '../components/Button.jsx'
import Notification from '../components/Notification.jsx'
import { getDashboard } from '../services/api.js'

const workflowSteps = [
  { label: 'Import', icon: FileInput },
  { label: 'Map', icon: Boxes },
  { label: 'Validate', icon: ShieldCheck },
  { label: 'Review', icon: ClipboardCheck },
  { label: 'Approve', icon: CheckCheck },
  { label: 'Sync', icon: ArrowDownToLine },
]

function EmptyPanel({ icon: Icon, title, description }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-5 py-7 text-center">
      <span className="grid size-9 place-items-center rounded-lg bg-slate-50 text-slate-500"><Icon size={17} aria-hidden="true" /></span>
      <p className="mt-3 text-xs font-semibold text-slate-700">{title}</p>
      <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">{description}</p>
    </div>
  )
}

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  function retryDashboard() {
    setLoading(true)
    setError('')
    setRefreshKey((current) => current + 1)
  }

  useEffect(() => {
    const controller = new AbortController()
    getDashboard({ signal: controller.signal }).then((result) => {
      setDashboard(result)
      setError('')
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [refreshKey])

  const products = dashboard?.products
  const quality = dashboard?.quality
  const wooStatus = dashboard?.woocommerce?.status
  const importStatus = dashboard?.latest_import?.status
  const metrics = [
    { label: 'Total products', value: products ? products.total : loading ? 'Loading' : 'No data', note: products?.total === 0 ? 'No product records yet' : 'Persisted catalog records', icon: Package, accent: 'from-teal-700 to-teal-500' },
    { label: 'Requiring review', value: products ? products.requiring_review : loading ? 'Loading' : 'No data', note: 'Pending human review', icon: ClipboardCheck, accent: 'from-violet-600 to-violet-400' },
    { label: 'Approved products', value: products ? products.approved : loading ? 'Loading' : 'No data', note: 'Approval decisions recorded', icon: BadgeCheck, accent: 'from-emerald-600 to-teal-500' },
    { label: 'Synced to WooCommerce', value: products ? products.synchronized : loading ? 'Loading' : 'No data', note: wooStatus === 'connected' ? 'Successful store updates' : wooStatus === 'not_configured' ? 'Store not configured' : 'Connection not verified', icon: ArrowDownToLine, accent: 'from-slate-700 to-violet-500' },
  ]
  const workflowStatuses = !dashboard?.latest_import
    ? workflowSteps.map(() => 'Not started')
    : importStatus === 'previewed'
      ? ['In progress', 'Not started', 'Not started', 'Not started', 'Not started', 'Not started']
      : importStatus === 'mapped'
        ? ['Completed', 'In progress', 'Not started', 'Not started', 'Not started', 'Not started']
        : (() => {
            const total = products?.total || 0
            const pending = products?.requiring_review || 0
            const approved = products?.approved || 0
            const rejected = products?.rejected || 0
            const synced = products?.synchronized || 0
            const reviewComplete = total > 0 && pending === 0
            const approvalComplete = total > 0 && approved + rejected === total
            const syncComplete = approved > 0 && synced >= approved
            return [
              'Completed',
              'Completed',
              'Completed',
              reviewComplete ? 'Completed' : 'In progress',
              approvalComplete ? 'Completed' : approved ? 'In progress' : 'Not started',
              syncComplete ? 'Completed' : dashboard?.woocommerce?.failed_syncs && approved > synced ? 'Failed' : approved && wooStatus === 'connected' ? 'In progress' : 'Not started',
            ]
          })()
  const assessedText = quality?.assessed
    ? `${quality.completeness_average ?? 0}% average completeness`
    : 'Not assessed yet'
  const qualityFindings = [
    { label: 'Missing required fields', value: quality?.assessed ? quality.missing_required_fields : 'No data', tone: quality?.missing_required_fields ? 'danger' : 'success', to: '/data-review?severity=error' },
    { label: 'Invalid prices', value: quality?.assessed ? quality.invalid_prices : 'No data', tone: quality?.invalid_prices ? 'danger' : 'success', to: '/data-review?severity=error' },
    { label: 'Duplicate SKUs', value: quality?.assessed ? quality.duplicate_skus : 'No data', tone: quality?.duplicate_skus ? 'warning' : 'success', to: '/data-review' },
    { label: 'Missing configured attributes', value: quality?.assessed ? quality.missing_attributes : 'No data', tone: quality?.missing_attributes ? 'warning' : 'success', to: '/attributes' },
  ]

  return (
    <>
      <PageHeader
        eyebrow="PRODUCT DATA WORKSPACE"
        title="Messy supplier data. Meet store-ready products."
        description="Turn inconsistent spreadsheets into accurate, validated product listings—all from one workspace."
        action={<div className="flex flex-wrap gap-2"><Button as={NavLink} to="/products" variant="secondary">View product catalog<ArrowRight size={14} aria-hidden="true" /></Button><Button as={NavLink} to="/supplier-import" className="bg-gradient-to-r from-teal-800 via-teal-700 to-violet-700 hover:brightness-105"><FileInput size={16} aria-hidden="true" />Import supplier data</Button></div>}
      />

      {error && <div className="mb-5"><Notification tone="warning" title="Dashboard data unavailable">{error} <button className="ml-2 font-semibold underline" onClick={retryDashboard}>Retry</button></Notification></div>}

      <section className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white shadow-[0_22px_60px_rgba(15,23,42,0.18)]" aria-label="Workspace command summary">
        <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="p-6 sm:p-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-100"><Sparkles size={12} /> Data readiness console</div>
            <h2 className="font-display mt-5 max-w-2xl text-2xl font-semibold text-white sm:text-3xl">From raw data to retail-ready.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Import, standardize, validate, and approve every product before it reaches your store.</p>
            <div className="mt-5 flex flex-wrap gap-2"><Button as={NavLink} to="/supplier-import" variant="light"><FileInput size={15} />Start import</Button><Button as={NavLink} to="/data-review" variant="secondary" className="border-white/15 bg-white/10 text-white hover:bg-white/15">Review issues<ArrowRight size={14} /></Button></div>
          </div>
          <div className="border-t border-white/10 bg-white/[0.04] p-6 sm:p-7 lg:border-l lg:border-t-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Current health</p>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2.5"><span className="text-xs text-slate-300">Latest import</span><StatusBadge tone={dashboard?.latest_import ? 'info' : 'neutral'}>{loading ? 'Loading' : dashboard?.latest_import ? dashboard.latest_import.status.replace('_', ' ') : 'Not started'}</StatusBadge></div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2.5"><span className="text-xs text-slate-300">Quality score</span><span className="text-xs font-semibold text-white">{loading ? 'Loading' : assessedText}</span></div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2.5"><span className="text-xs text-slate-300">Store sync</span><StatusBadge tone={wooStatus === 'connected' ? 'success' : wooStatus === 'not_configured' ? 'warning' : 'neutral'}>{loading ? 'Loading' : wooStatus?.replaceAll('_', ' ') || 'Unavailable'}</StatusBadge></div>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Product data summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, note, icon: Icon, accent }) => (
          <Card as="article" key={label} className="overflow-hidden p-0">
            <div className={`h-1 bg-gradient-to-r ${accent}`} />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold text-slate-600">{label}</span><span className="grid size-8 place-items-center rounded-md bg-slate-50 text-slate-600"><Icon size={16} aria-hidden="true" /></span></div>
              <p className={`mt-4 font-semibold tracking-tight text-slate-950 ${String(value).length > 12 ? 'text-sm' : 'text-2xl'}`} aria-live="polite">{value}</p>
              <p className="mt-1.5 text-[10px] text-slate-500">{note}</p>
            </div>
          </Card>
        ))}
      </section>

      <Card aria-labelledby="workflow-heading" className="mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="workflow-heading" className="text-sm font-semibold text-slate-900">Product data workflow</h2><p className="mt-1 text-[11px] text-slate-500">A clear path from supplier file to store-ready product.</p></div><StatusBadge tone={loading ? 'neutral' : dashboard?.latest_import ? 'success' : 'neutral'}>{loading ? 'Loading workflow' : dashboard?.latest_import ? `Latest import: ${dashboard.latest_import.status.replace('_', ' ')}` : 'No workflow started'}</StatusBadge></div>
        <WorkflowSteps steps={workflowSteps} statuses={workflowStatuses} />
      </Card>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card aria-labelledby="activity-heading" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 id="activity-heading" className="text-sm font-semibold text-slate-900">Recent activity</h2><p className="mt-1 text-[10px] text-slate-500">Imports, reviews, and sync events</p></div><Sparkles size={16} className="text-slate-400" aria-hidden="true" /></div>
          {loading ? <EmptyPanel icon={Boxes} title="Loading activity" description="Fetching recent saved workflow events." /> : dashboard?.activity?.length ? <ol className="divide-y divide-slate-100 px-5">{dashboard.activity.map((event, index) => <li key={`${event.created_at}-${index}`} className="flex items-start justify-between gap-4 py-3"><div><p className="text-xs font-semibold text-slate-700">{event.event}</p><p className="mt-1 text-[10px] text-slate-500">{event.detail}</p></div><time className="shrink-0 text-[10px] text-slate-400" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></li>)}</ol> : <EmptyPanel icon={Boxes} title="Nothing here yet" description="Activity will appear after supplier data is added to the workspace." />}
        </Card>

        <Card aria-labelledby="quality-heading" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 id="quality-heading" className="text-sm font-semibold text-slate-900">Supplier data quality</h2><p className="mt-1 text-[10px] text-slate-500">Completeness and validation overview</p></div><ShieldCheck size={17} className="text-slate-400" aria-hidden="true" /></div>
          <div className="px-5 py-4">
            <div className="mb-4 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2.5"><span className="text-xs font-semibold text-slate-600">Overall assessment</span><StatusBadge tone={quality?.assessed ? 'success' : 'neutral'}>{loading ? 'Loading' : assessedText}</StatusBadge></div>
            <div className="grid gap-2">
              {qualityFindings.map((finding) => <NavLink key={finding.label} to={finding.to} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2.5 transition hover:border-teal-200 hover:bg-teal-50/40"><span className="flex items-center gap-2 text-[11px] font-medium text-slate-600">{finding.label === 'Invalid prices' && <TriangleAlert size={13} className="text-slate-400" aria-hidden="true" />}{finding.label}</span><span className="inline-flex items-center gap-2"><StatusBadge tone={finding.tone}>{finding.value}</StatusBadge><ArrowRight size={13} className="text-slate-400" /></span></NavLink>)}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-3"><p className="text-[11px] leading-5 text-teal-950"><span className="font-semibold">Every product, ready for the right shelf.</span> Start by importing a supplier spreadsheet.</p><NavLink to="/supplier-import" className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-teal-900 hover:text-teal-700">Supplier Import <ArrowRight size={14} /></NavLink></div>
        <blockquote className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11px] italic leading-5 text-slate-600">Clean product data is the foundation of every great shopping experience.<footer className="mt-1 not-italic text-[10px] text-slate-400">Supplier Data Doctor</footer></blockquote>
      </div>
    </>
  )
}
