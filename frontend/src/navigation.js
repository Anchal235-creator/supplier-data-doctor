import {
  ArrowDownToLine,
  Check,
  FileInput,
  LayoutDashboard,
  Package,
  Settings2,
} from 'lucide-react'

export const navigation = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Supplier Import', path: '/supplier-import', icon: FileInput },
  { label: 'Data Review', path: '/data-review', icon: Check },
  { label: 'Product Catalog', path: '/products', icon: Package },
  { label: 'Attribute Management', path: '/attributes', icon: Settings2 },
  { label: 'WooCommerce Sync', path: '/sync', icon: ArrowDownToLine },
]