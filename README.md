# Supplier Data Doctor

Supplier Data Doctor transforms inconsistent supplier product spreadsheets into reviewable, validated product records. This hackathon build supports CSV/XLSX preview, deterministic column mapping, persisted products and attribute definitions, data-quality review, approval, catalog editing, and a server-side WooCommerce sync workflow.

## Stack and local storage

- Frontend: React, Vite, Tailwind CSS v4, React Router, Lucide React.
- Backend: FastAPI, Pydantic, HTTPX, pandas, openpyxl.
- Local persistence: SQLite at `backend/data/supplier_data_doctor.db`.
- Supabase: not connected. The env example reserves its server-side URL/key for a later PostgreSQL migration; the current app persists locally in SQLite.

## Requirements

- Node.js 20.19+ or 22.12+
- Python 3.10+

## Start the backend

From the repository root in PowerShell:

```powershell
cd backend
if (-not (Test-Path .venv)) { py -3 -m venv .venv }
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uvicorn app.main:app --reload
```

The API runs at `http://localhost:8000`; verify it at `http://localhost:8000/health`. SQLite tables are initialized on startup. Keep this terminal running while using the frontend.

## Start the frontend

In a second PowerShell terminal at the repository root:

```powershell
cd frontend
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). `VITE_API_BASE_URL` defaults to `http://localhost:8000`.

## Import and review flow

1. On Supplier Import, download `frontend/public/sample-tile-supplier.csv`. It is synthetic demo data and is not loaded automatically.
2. Upload a CSV or XLSX file (10 MB maximum, 10,000 rows maximum).
3. Review suggested mappings; SKU, Product Name, and Regular Price must be mapped to continue.
4. Save the mapping to persist and validate the actual rows.
5. Correct blocking issues in Data Review, rerun validation, and approve eligible products.

Validation checks required core fields, non-negative prices, duplicate SKUs, malformed HTTP(S) image URLs, and active category-scoped attribute rules. Blocking errors prevent approval; warnings require explicit confirmation.

## WooCommerce setup

Place credentials only in the untracked `backend/.env` file:

```dotenv
WOOCOMMERCE_STORE_URL=https://your-store.example
WOOCOMMERCE_CONSUMER_KEY=your-consumer-key
WOOCOMMERCE_CONSUMER_SECRET=your-consumer-secret
```

Use a real HTTPS store URL and WooCommerce REST API keys with product read/write access. Run the connection test before syncing. Sync sends only approved, validated products and uses SKU lookup to avoid duplicate creates. No live WooCommerce store was available for testing here.

## Tests

Backend API/workflow tests (run from `backend/`):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Frontend checks (run from `frontend/`):

```powershell
npm run build
npm run lint
```

## Security and integrations

Local `.env` files, virtual environments, build output, and SQLite database files are gitignored. WooCommerce consumer secrets and any Supabase service-role key must remain on the backend and are never exposed to frontend code. No Supabase project is configured by this implementation.