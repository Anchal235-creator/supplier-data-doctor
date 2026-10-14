import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Dashboard from './pages/Dashboard.jsx'
import SupplierImport from './pages/SupplierImport.jsx'
import DataReview from './pages/DataReview.jsx'
import ProductCatalog from './pages/ProductCatalog.jsx'
import AttributeManagement from './pages/AttributeManagement.jsx'
import WooCommerceSync from './pages/WooCommerceSync.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="supplier-import" element={<SupplierImport />} />
          <Route path="data-review" element={<DataReview />} />
          <Route path="products" element={<ProductCatalog />} />
          <Route path="attributes" element={<AttributeManagement />} />
          <Route path="sync" element={<WooCommerceSync />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
