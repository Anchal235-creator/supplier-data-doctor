const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = {}
  const options = { method, signal, headers }
  if (body instanceof FormData) {
    options.body = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('The backend API could not be reached. Start FastAPI and try again.')
  }

  if (response.status === 204) return null
  if (!response.ok) {
    let message = `The backend API returned HTTP ${response.status}.`
    try {
      const errorBody = await response.json()
      if (typeof errorBody.detail === 'string') message = errorBody.detail
    } catch {
      // Keep the HTTP status message when the response has no JSON body.
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }

  return response.json()
}

export function getHealth(options = {}) {
  return request('/health', options)
}

export function getDashboard(options = {}) {
  return request('/api/dashboard', options)
}

export function getImports(options = {}) {
  return request('/api/imports', options)
}

export function previewImport(file, options = {}) {
  const body = new FormData()
  body.append('file', file)
  return request('/api/import/preview', { ...options, method: 'POST', body })
}

export function getImport(importId, options = {}) {
  return request(`/api/import/${encodeURIComponent(importId)}`, options)
}

export function updateImportMapping(importId, mappings, options = {}) {
  return request(`/api/import/${encodeURIComponent(importId)}/mapping`, {
    ...options,
    method: 'PUT',
    body: { mappings },
  })
}

export function processImport(importId, options = {}) {
  return request(`/api/import/${encodeURIComponent(importId)}/process`, { ...options, method: 'POST' })
}

export function getProducts({ search = '', category = '', approvalStatus = '', page = 1, pageSize = 25, ...options } = {}) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (category) params.set('category', category)
  if (approvalStatus) params.set('approval_status', approvalStatus)
  params.set('page', String(page))
  params.set('page_size', String(pageSize))
  return request(`/api/products?${params}`, options)
}

export function getProduct(productId, options = {}) {
  return request(`/api/products/${productId}`, options)
}

export function createProduct(product, options = {}) {
  return request('/api/products', { ...options, method: 'POST', body: product })
}

export function updateProduct(productId, changes, options = {}) {
  return request(`/api/products/${productId}`, { ...options, method: 'PUT', body: changes })
}

export function deleteProduct(productId, options = {}) {
  return request(`/api/products/${productId}`, { ...options, method: 'DELETE' })
}

export function runValidation(importId, options = {}) {
  const params = new URLSearchParams()
  if (importId) params.set('import_id', importId)
  const query = params.size ? `?${params}` : ''
  return request(`/api/validation/run${query}`, { ...options, method: 'POST' })
}

export function getValidationIssues({ importId = '', severity = '', ...options } = {}) {
  const params = new URLSearchParams()
  if (importId) params.set('import_id', importId)
  if (severity) params.set('severity', severity)
  const query = params.size ? `?${params}` : ''
  return request(`/api/validation/issues${query}`, options)
}

export function updateProductReview(productId, status, confirmWarnings = false, options = {}) {
  return request(`/api/products/${productId}/review`, {
    ...options,
    method: 'PUT',
    body: { status, confirm_warnings: confirmWarnings },
  })
}

export function approveProducts(productIds, confirmWarnings = false, options = {}) {
  return request('/api/products/approve', {
    ...options,
    method: 'POST',
    body: { product_ids: productIds, confirm_warnings: confirmWarnings },
  })
}

export function getAttributes(options = {}) {
  return request('/api/attributes', options)
}

export function createAttribute(attribute, options = {}) {
  return request('/api/attributes', { ...options, method: 'POST', body: attribute })
}

export function updateAttribute(attributeId, attribute, options = {}) {
  return request(`/api/attributes/${attributeId}`, { ...options, method: 'PUT', body: attribute })
}

export function deleteAttribute(attributeId, options = {}) {
  return request(`/api/attributes/${attributeId}`, { ...options, method: 'DELETE' })
}

export function getWooCommerceStatus(options = {}) {
  return request('/api/woocommerce/status', options)
}

export function testWooCommerceConnection(options = {}) {
  return request('/api/woocommerce/test-connection', { ...options, method: 'POST' })
}

export function syncProducts(productIds = undefined, options = {}) {
  return request('/api/woocommerce/sync', {
    ...options,
    method: 'POST',
    body: { product_ids: productIds },
  })
}

export function getSyncHistory(options = {}) {
  return request('/api/woocommerce/sync-history', options)
}

export function retrySync(syncId, options = {}) {
  return request(`/api/woocommerce/retry/${syncId}`, { ...options, method: 'POST' })
}