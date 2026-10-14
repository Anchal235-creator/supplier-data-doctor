import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Boxes,
  Check,
  ChevronDown,
  CircuitBoard,
  TriangleAlert,
} from 'lucide-react'
import { getHealth } from './services/api.js'
import { navigation } from './navigation.js'

function App() {
  const location = useLocation()
  return (
    <div className="min-h-screen bg-[#F6F8FB] text-[#172033]">
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r border-slate-800/40 bg-[#10172A] text-white lg:flex">
        <NavLink to="/dashboard" className="flex h-[72px] items-center gap-3 border-b border-white/10 px-6" aria-label="Supplier Data Doctor dashboard">
          <span className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-teal-300 via-teal-500 to-violet-500 text-slate-950 shadow-lg shadow-teal-950/30"><Boxes size={20} /></span>
          <span><span className="block text-[15px] font-semibold tracking-tight">Supplier Data Doctor</span><span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-teal-100/80">Ops workspace</span></span>
        </NavLink>
        <div className="mx-4 mt-6 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <span className="grid size-8 place-items-center rounded-md bg-teal-300/15 text-teal-100"><CircuitBoard size={15} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white">Supplier workspace</span><span className="mt-0.5 block text-[10px] text-slate-400">Product operations</span></span>
          <ChevronDown size={14} className="text-slate-500" />
        </div>
        <p className="mb-2 mt-8 px-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Workspace</p>
        <nav className="flex flex-col gap-1 px-3" aria-label="Primary navigation">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/dashboard'} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm font-semibold transition-colors ${isActive ? 'border-teal-200/70 bg-teal-50 text-teal-950 shadow-sm' : 'border-transparent text-slate-300 hover:bg-white/10 hover:text-white'}`}>
              <Icon size={17} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 p-4">
          <div className="rounded-lg border border-teal-300/20 bg-gradient-to-br from-teal-300/10 to-violet-400/10 p-3">
            <p className="text-[11px] font-semibold text-teal-50">Demo-ready data pipeline</p>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">Import, validate, approve, and sync without losing the source truth.</p>
          </div>
          <div className="mt-3 flex items-center gap-3 px-2 pt-2">
            <span className="grid size-8 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-slate-200">SD</span>
            <span><span className="block text-xs font-medium text-slate-200">Hackathon workspace</span><span className="mt-0.5 block text-[10px] text-slate-500">Local preview</span></span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-[5] flex h-[60px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur sm:px-8">
          <span className="text-xs text-slate-500">Supplier Data Doctor <span className="mx-2 text-slate-300">/</span> <span className="font-semibold text-slate-800">{pageTitle(location.pathname)}</span></span>
          <div className="flex items-center gap-3"><BackendStatus /></div>
        </header>
        <div className="border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Primary navigation">
            {navigation.map(({ label, path, icon: Icon }) => <NavLink key={path} to={path} end={path === '/dashboard'} className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold ${isActive ? 'bg-teal-50 text-teal-900' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={15} aria-hidden="true" /><span>{label}</span></NavLink>)}
          </nav>
        </div>
        <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10"><Outlet /></main>
      </div>
    </div>
  )
}

function BackendStatus() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    const controller = new AbortController()
    getHealth({ signal: controller.signal }).then(() => setStatus('online')).catch((error) => {
      if (error.name !== 'AbortError') setStatus('offline')
    })
    return () => controller.abort()
  }, [])

  const label = status === 'online' ? 'API available' : status === 'offline' ? 'API unavailable' : 'Checking API'
  const style = status === 'online' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : status === 'offline' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-100 text-slate-600'
  const Icon = status === 'offline' ? TriangleAlert : Check

  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${style}`} aria-live="polite"><Icon size={12} />{label}</span>
}

export default App

function pageTitle(path) {
  return navigation.find((item) => item.path === path)?.label || 'Dashboard'
}
