from contextlib import closing
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from app.config import Settings
from app.database import connect, decode_json, encode_json, record_activity, utc_now
from app.schemas import (
    AttributeInput,
    BulkApproveRequest,
    MappingUpdate,
    ProductInput,
    ProductUpdate,
    ReviewUpdate,
    WooSyncRequest,
)
from app.services.imports import ImportFileError, STANDARD_FIELDS, parse_supplier_file
from app.services.validation import validate_product
from app.services.woocommerce import WooCommerceClient, WooCommerceError

router = APIRouter(prefix="/api")
settings = Settings()
MAX_PAGE_SIZE = 100
MAX_UPLOAD_BYTES = settings.max_upload_size_mb * 1024 * 1024
woocommerce_test_status = "not_tested"


def _product_dict(row: Any) -> dict[str, Any]:
    product = dict(row)
    product["raw"] = decode_json(product.pop("raw_json", "{}"), {})
    product["attributes"] = decode_json(product.pop("attributes_json", "{}"), {})
    product["issues"] = decode_json(product.pop("issues_json", "[]"), [])
    product["approval_status"] = product.pop("review_status")
    return product


def _attribute_dict(row: Any) -> dict[str, Any]:
    attribute = dict(row)
    attribute["allowed_values"] = decode_json(attribute.pop("allowed_values_json", "[]"), [])
    attribute["validation_rules"] = decode_json(
        attribute.pop("validation_rules_json", "{}"), {}
    )
    attribute["required"] = bool(attribute["required"])
    attribute["active"] = bool(attribute["active"])
    return attribute


def _load_attributes(connection: Any, *, active_only: bool = True) -> list[dict[str, Any]]:
    query = "SELECT * FROM attributes"
    if active_only:
        query += " WHERE active = 1"
    query += " ORDER BY name COLLATE NOCASE"
    return [_attribute_dict(row) for row in connection.execute(query).fetchall()]


def _duplicate_skus(connection: Any) -> set[str]:
    rows = connection.execute(
        "SELECT lower(trim(sku)) AS normalized_sku FROM products "
        "WHERE trim(sku) != '' GROUP BY lower(trim(sku)) HAVING COUNT(*) > 1"
    ).fetchall()
    return {row["normalized_sku"] for row in rows}


def _revalidate_product(
    connection: Any,
    row: Any,
    definitions: list[dict[str, Any]],
    duplicate_skus: set[str] | None = None,
) -> dict[str, Any]:
    product = _product_dict(row)
    known_duplicates = duplicate_skus if duplicate_skus is not None else _duplicate_skus(connection)
    result = validate_product(
        product,
        definitions,
        duplicate_sku=product["sku"].strip().lower() in known_duplicates,
    )
    review_status = product["approval_status"]
    if review_status == "approved" and result["validation_status"] == "needs_attention":
        review_status = "pending_review"
    connection.execute(
        "UPDATE products SET regular_price = ?, issues_json = ?, completeness = ?, "
        "validation_status = ?, review_status = ?, updated_at = ? WHERE id = ?",
        (
            product["regular_price"],
            encode_json(result["issues"]),
            result["completeness"],
            result["validation_status"],
            review_status,
            utc_now(),
            product["id"],
        ),
    )
    return result


def _get_product(connection: Any, product_id: int) -> Any:
    row = connection.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return row


def _insert_product(
    connection: Any,
    product: dict[str, Any],
    *,
    import_id: str | None = None,
    source_row: int | None = None,
    raw: dict[str, Any] | None = None,
) -> int:
    now = utc_now()
    cursor = connection.execute(
        """INSERT INTO products (
            import_id, source_row, raw_json, sku, name, regular_price, category,
            description, image_url, attributes_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            import_id,
            source_row,
            encode_json(raw or {}),
            str(product.get("sku") or "").strip(),
            str(product.get("name") or "").strip(),
            str(product.get("regular_price") or "").strip(),
            str(product.get("category") or "").strip(),
            str(product.get("description") or "").strip(),
            str(product.get("image_url") or "").strip(),
            encode_json(product.get("attributes") or {}),
            now,
            now,
        ),
    )
    return int(cursor.lastrowid)


def _make_mapped_product(raw: dict[str, Any], mappings: dict[str, str | None]) -> dict[str, Any]:
    product: dict[str, Any] = {
        "sku": "",
        "name": "",
        "regular_price": "",
        "category": "",
        "description": "",
        "image_url": "",
        "attributes": {},
    }
    product_fields = {"sku", "name", "regular_price", "category", "description", "image_url"}
    for source_column, target in mappings.items():
        if not target:
            continue
        value = str(raw.get(source_column, "") or "").strip()
        if target.startswith("attribute:"):
            product["attributes"][target.removeprefix("attribute:")] = value
        elif target in product_fields:
            product[target] = value
        else:
            product["attributes"][target] = value
    return product


def _import_record(connection: Any, import_id: str) -> Any:
    row = connection.execute("SELECT * FROM imports WHERE id = ?", (import_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Import not found.")
    return row


@router.get("/dashboard")
def dashboard_summary() -> dict[str, Any]:
    with closing(connect()) as connection:
        total = connection.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        pending = connection.execute(
            "SELECT COUNT(*) FROM products WHERE review_status = 'pending_review'"
        ).fetchone()[0]
        rejected = connection.execute(
            "SELECT COUNT(*) FROM products WHERE review_status = 'rejected'"
        ).fetchone()[0]
        approved = connection.execute(
            "SELECT COUNT(*) FROM products WHERE review_status = 'approved'"
        ).fetchone()[0]
        synced = connection.execute(
            "SELECT COUNT(*) FROM products WHERE woocommerce_product_id IS NOT NULL"
        ).fetchone()[0]
        failed_syncs = connection.execute(
            "SELECT COUNT(*) FROM sync_history WHERE status = 'failed'"
        ).fetchone()[0]
        assessed = connection.execute(
            "SELECT COUNT(*) FROM products WHERE validation_status != 'unassessed'"
        ).fetchone()[0]
        completeness_average = connection.execute(
            "SELECT AVG(completeness) FROM products WHERE completeness IS NOT NULL"
        ).fetchone()[0]
        imports_count = connection.execute("SELECT COUNT(*) FROM imports").fetchone()[0]
        rows = connection.execute(
            "SELECT issues_json FROM products WHERE validation_status != 'unassessed'"
        ).fetchall()
        issue_counts = {
            "missing_required_fields": 0,
            "invalid_prices": 0,
            "duplicate_skus": 0,
            "missing_attributes": 0,
            "invalid_attributes": 0,
        }
        issue_keys = {
            "missing_required": "missing_required_fields",
            "missing_required_attribute": "missing_attributes",
            "invalid_price": "invalid_prices",
            "duplicate_sku": "duplicate_skus",
            "invalid_attribute": "invalid_attributes",
        }
        for row in rows:
            for issue in decode_json(row["issues_json"], []):
                metric = issue_keys.get(issue.get("code"))
                if metric:
                    issue_counts[metric] += 1
        activity = [dict(row) for row in connection.execute(
            "SELECT event, detail, created_at FROM activity ORDER BY id DESC LIMIT 8"
        ).fetchall()]
        latest_import = connection.execute(
            "SELECT id, filename, status, row_count, created_at FROM imports ORDER BY created_at DESC LIMIT 1"
        ).fetchone()

    latest_import_value = dict(latest_import) if latest_import else None
    sync_configured = settings.woocommerce_configured
    return {
        "products": {
            "total": total,
            "requiring_review": pending,
            "rejected": rejected,
            "approved": approved,
            "synchronized": synced,
        },
        "quality": {
            "assessed": assessed > 0,
            "completeness_average": round(completeness_average) if completeness_average is not None else None,
            **issue_counts,
        },
        "woocommerce": {
            "status": "not_configured" if not sync_configured else woocommerce_test_status,
            "configured": sync_configured,
            "failed_syncs": failed_syncs,
        },
        "imports_count": imports_count,
        "latest_import": latest_import_value,
        "activity": activity,
    }


@router.get("/imports")
def list_imports() -> list[dict[str, Any]]:
    with closing(connect()) as connection:
        rows = connection.execute(
            "SELECT id, filename, status, row_count, created_at FROM imports ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@router.post("/import/preview", status_code=status.HTTP_201_CREATED)
async def preview_import(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Choose a CSV or XLSX file.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.max_upload_size_mb} MB upload limit.",
        )
    try:
        parsed = parse_supplier_file(filename, content)
    except ImportFileError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    import_id = str(uuid4())
    created_at = utc_now()
    with closing(connect()) as connection, connection:
        connection.execute(
            """INSERT INTO imports (
                id, filename, status, row_count, columns_json, rows_json, mappings_json, created_at
            ) VALUES (?, ?, 'previewed', ?, ?, ?, ?, ?)""",
            (
                import_id,
                filename,
                parsed["row_count"],
                encode_json(parsed["columns"]),
                encode_json(parsed["rows"]),
                encode_json(parsed["mappings"]),
                created_at,
            ),
        )
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Supplier file parsed", f"{filename}: {parsed['row_count']} rows", created_at),
        )

    return {
        "import_id": import_id,
        "filename": filename,
        "row_count": parsed["row_count"],
        "column_count": len(parsed["columns"]),
        "columns": parsed["column_details"],
        "preview_rows": parsed["preview_rows"],
        "mappings": parsed["mappings"],
        "status": "previewed",
    }


@router.get("/import/{import_id}")
def get_import(import_id: str) -> dict[str, Any]:
    with closing(connect()) as connection:
        row = _import_record(connection, import_id)
        mappings = decode_json(row["mappings_json"], {})
        rows = decode_json(row["rows_json"], [])
        columns = decode_json(row["columns_json"], [])
    return {
        "import_id": row["id"],
        "filename": row["filename"],
        "status": row["status"],
        "row_count": row["row_count"],
        "column_count": len(columns),
        "columns": [
            {
                "name": column,
                "sample_values": [item.get(column, "") for item in rows[:3]],
                "suggested_field": mappings.get(column),
                "match_status": "suggested" if mappings.get(column) else "unmapped",
            }
            for column in columns
        ],
        "preview_rows": rows[:8],
        "mappings": mappings,
    }


@router.put("/import/{import_id}/mapping")
def update_import_mapping(import_id: str, body: MappingUpdate) -> dict[str, Any]:
    with closing(connect()) as connection, connection:
        record = _import_record(connection, import_id)
        columns = set(decode_json(record["columns_json"], []))
        definitions = _load_attributes(connection, active_only=False)
        allowed_targets = set(STANDARD_FIELDS)
        allowed_targets.update(f"attribute:{item['key']}" for item in definitions)
        invalid_columns = set(body.mappings) - columns
        if invalid_columns:
            raise HTTPException(status_code=422, detail="Mapping contains a column not present in this file.")
        invalid_targets = {
            target for target in body.mappings.values() if target and target not in allowed_targets
        }
        if invalid_targets:
            raise HTTPException(status_code=422, detail="Mapping contains an unsupported product field.")
        selected_targets = [target for target in body.mappings.values() if target]
        if len(selected_targets) != len(set(selected_targets)):
            raise HTTPException(status_code=422, detail="Each product field can be mapped from only one supplier column.")
        if record["status"] == "processed":
            raise HTTPException(status_code=409, detail="This import has already been processed.")

        connection.execute(
            "UPDATE imports SET mappings_json = ?, status = 'mapped' WHERE id = ?",
            (encode_json(body.mappings), import_id),
        )
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Column mapping saved", record["filename"], utc_now()),
        )
    return {"import_id": import_id, "mappings": body.mappings, "status": "mapped"}


@router.post("/import/{import_id}/process")
def process_import(import_id: str) -> dict[str, Any]:
    with closing(connect()) as connection, connection:
        record = _import_record(connection, import_id)
        if record["status"] == "processed":
            raise HTTPException(status_code=409, detail="This import has already been processed.")
        mappings = decode_json(record["mappings_json"], {})
        required_fields = {"sku", "name", "regular_price"}
        if not required_fields.issubset(set(mappings.values())):
            raise HTTPException(
                status_code=422,
                detail="Map SKU, Product Name, and Regular Price before processing.",
            )

        rows = decode_json(record["rows_json"], [])
        for index, raw in enumerate(rows, start=2):
            _insert_product(
                connection,
                _make_mapped_product(raw, mappings),
                import_id=import_id,
                source_row=index,
                raw=raw,
            )

        definitions = _load_attributes(connection)
        product_rows = connection.execute(
            "SELECT * FROM products WHERE import_id = ? ORDER BY source_row", (import_id,)
        ).fetchall()
        duplicate_skus = _duplicate_skus(connection)
        for row in product_rows:
            _revalidate_product(connection, row, definitions, duplicate_skus)

        connection.execute(
            "UPDATE imports SET status = 'processed' WHERE id = ?", (import_id,)
        )
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Supplier import validated", f"{record['filename']}: {len(product_rows)} products", utc_now()),
        )
        valid_count = connection.execute(
            "SELECT COUNT(*) FROM products WHERE import_id = ? AND validation_status = 'valid'",
            (import_id,),
        ).fetchone()[0]
        warning_count = connection.execute(
            "SELECT COUNT(*) FROM products WHERE import_id = ? AND validation_status = 'valid_with_warnings'",
            (import_id,),
        ).fetchone()[0]
        attention_count = connection.execute(
            "SELECT COUNT(*) FROM products WHERE import_id = ? AND validation_status = 'needs_attention'",
            (import_id,),
        ).fetchone()[0]
        issue_count = sum(
            len(decode_json(row["issues_json"], []))
            for row in connection.execute(
                "SELECT issues_json FROM products WHERE import_id = ?", (import_id,)
            ).fetchall()
        )
        duplicate_sku_count = sum(
            sum(issue.get("code") == "duplicate_sku" for issue in decode_json(row["issues_json"], []))
            for row in connection.execute(
                "SELECT issues_json FROM products WHERE import_id = ?", (import_id,)
            ).fetchall()
        )

    return {
        "import_id": import_id,
        "filename": record["filename"],
        "total_rows": len(rows),
        "valid_rows": valid_count,
        "rows_with_warnings": warning_count,
        "rows_with_errors": attention_count,
        "issue_count": issue_count,
        "duplicate_sku_count": duplicate_sku_count,
        "status": "processed",
    }


@router.get("/products")
def list_products(
    search: str = Query(default="", max_length=100),
    category: str = Query(default="", max_length=150),
    approval_status: str = Query(default="", max_length=30),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=MAX_PAGE_SIZE),
) -> dict[str, Any]:
    clauses: list[str] = []
    params: list[Any] = []
    if search.strip():
        pattern = f"%{search.strip()}%"
        clauses.append("(sku LIKE ? OR name LIKE ?)")
        params.extend([pattern, pattern])
    if category:
        clauses.append("category = ?")
        params.append(category)
    if approval_status:
        clauses.append("review_status = ?")
        params.append(approval_status)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""

    with closing(connect()) as connection:
        total = connection.execute(f"SELECT COUNT(*) FROM products{where}", params).fetchone()[0]
        rows = connection.execute(
            f"SELECT * FROM products{where} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            [*params, page_size, (page - 1) * page_size],
        ).fetchall()
        categories = [row[0] for row in connection.execute(
            "SELECT DISTINCT category FROM products WHERE category != '' ORDER BY category"
        ).fetchall()]
    return {
        "items": [_product_dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "categories": categories,
    }


@router.get("/products/{product_id}")
def get_product(product_id: int) -> dict[str, Any]:
    with closing(connect()) as connection:
        return _product_dict(_get_product(connection, product_id))


@router.post("/products", status_code=status.HTTP_201_CREATED)
def create_product(body: ProductInput) -> dict[str, Any]:
    values = body.model_dump()
    with closing(connect()) as connection, connection:
        product_id = _insert_product(connection, values)
        row = _get_product(connection, product_id)
        _revalidate_product(
            connection, row, _load_attributes(connection), _duplicate_skus(connection)
        )
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Product created", values["name"] or "Unnamed product", utc_now()),
        )
        result = _product_dict(_get_product(connection, product_id))
    return result


@router.put("/products/{product_id}")
def update_product(product_id: int, body: ProductUpdate) -> dict[str, Any]:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Provide at least one product field to update.")
    with closing(connect()) as connection, connection:
        current = _product_dict(_get_product(connection, product_id))
        old_sku = current["sku"].strip().lower()
        for key, value in changes.items():
            if value is None:
                continue
            current[key] = value.strip() if isinstance(value, str) else value
        connection.execute(
            """UPDATE products SET sku = ?, name = ?, regular_price = ?, category = ?,
                description = ?, image_url = ?, attributes_json = ?, updated_at = ? WHERE id = ?""",
            (
                current["sku"], current["name"], current["regular_price"], current["category"],
                current["description"], current["image_url"], encode_json(current["attributes"]),
                utc_now(), product_id,
            ),
        )
        new_sku = current["sku"].strip().lower()
        affected_skus = {sku for sku in (old_sku, new_sku) if sku}
        if affected_skus:
            placeholders = ",".join("?" for _ in affected_skus)
            affected_rows = connection.execute(
                f"SELECT * FROM products WHERE lower(trim(sku)) IN ({placeholders})",
                list(affected_skus),
            ).fetchall()
        else:
            affected_rows = [_get_product(connection, product_id)]
        definitions = _load_attributes(connection)
        duplicate_skus = _duplicate_skus(connection)
        for affected_row in affected_rows:
            _revalidate_product(connection, affected_row, definitions, duplicate_skus)
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Product updated", current["name"] or f"Product {product_id}", utc_now()),
        )
        result = _product_dict(_get_product(connection, product_id))
    return result


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int) -> None:
    with closing(connect()) as connection, connection:
        product = _get_product(connection, product_id)
        deleted_sku = product["sku"].strip().lower()
        connection.execute("DELETE FROM products WHERE id = ?", (product_id,))
        if deleted_sku:
            definitions = _load_attributes(connection)
            duplicate_skus = _duplicate_skus(connection)
            remaining = connection.execute(
                "SELECT * FROM products WHERE lower(trim(sku)) = ?", (deleted_sku,)
            ).fetchall()
            for row in remaining:
                _revalidate_product(connection, row, definitions, duplicate_skus)
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Product deleted", product["name"] or product["sku"], utc_now()),
        )


@router.post("/validation/run")
def run_validation(import_id: str | None = None) -> dict[str, Any]:
    with closing(connect()) as connection, connection:
        definitions = _load_attributes(connection)
        if import_id:
            _import_record(connection, import_id)
            rows = connection.execute(
                "SELECT * FROM products WHERE import_id = ? ORDER BY source_row", (import_id,)
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM products ORDER BY id").fetchall()
        duplicate_skus = _duplicate_skus(connection)
        for row in rows:
            _revalidate_product(connection, row, definitions, duplicate_skus)
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Validation completed", f"{len(rows)} products checked", utc_now()),
        )
        summary = connection.execute(
            """SELECT
                SUM(CASE WHEN validation_status = 'valid' THEN 1 ELSE 0 END) AS valid,
                SUM(CASE WHEN validation_status = 'valid_with_warnings' THEN 1 ELSE 0 END) AS warnings,
                SUM(CASE WHEN validation_status = 'needs_attention' THEN 1 ELSE 0 END) AS errors
                FROM products WHERE (? IS NULL OR import_id = ?)""",
            (import_id, import_id),
        ).fetchone()
    return {
        "validated": len(rows),
        "valid": summary["valid"] or 0,
        "warnings": summary["warnings"] or 0,
        "errors": summary["errors"] or 0,
    }


@router.get("/validation/issues")
def list_validation_issues(
    import_id: str | None = None,
    severity: str | None = Query(default=None, pattern="^(error|warning)$"),
) -> dict[str, Any]:
    query = "SELECT * FROM products"
    clauses: list[str] = []
    params: list[Any] = []
    if import_id:
        clauses.append("import_id = ?")
        params.append(import_id)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY source_row, id"
    with closing(connect()) as connection:
        rows = connection.execute(query, params).fetchall()
    items = []
    summary = {"products": len(rows), "errors": 0, "warnings": 0, "ready": 0}
    for row in rows:
        product = _product_dict(row)
        if product["validation_status"] in {"valid", "valid_with_warnings"}:
            summary["ready"] += 1
        for issue in product["issues"]:
            summary["errors" if issue["severity"] == "error" else "warnings"] += 1
            if severity and issue["severity"] != severity:
                continue
            items.append(
                {
                    **issue,
                    "product_id": product["id"],
                    "source_row": product["source_row"],
                    "sku": product["sku"],
                    "name": product["name"],
                    "approval_status": product["approval_status"],
                    "validation_status": product["validation_status"],
                }
            )
    return {"summary": summary, "issues": items, "products": [_product_dict(row) for row in rows]}


@router.put("/products/{product_id}/review")
def update_review(product_id: int, body: ReviewUpdate) -> dict[str, Any]:
    with closing(connect()) as connection, connection:
        row = _get_product(connection, product_id)
        product = _product_dict(row)
        if body.status == "approved":
            if product["validation_status"] == "unassessed":
                raise HTTPException(status_code=409, detail="Run validation before approving this product.")
            blocking_issues = [issue for issue in product["issues"] if issue["severity"] == "error"]
            if blocking_issues:
                raise HTTPException(status_code=409, detail="Resolve blocking validation errors before approval.")
            if product["issues"] and not body.confirm_warnings:
                raise HTTPException(status_code=409, detail="Confirm the remaining warnings before approval.")
        connection.execute(
            "UPDATE products SET review_status = ?, updated_at = ? WHERE id = ?",
            (body.status, utc_now(), product_id),
        )
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            (f"Product {body.status}", product["name"] or product["sku"], utc_now()),
        )
        result = _product_dict(_get_product(connection, product_id))
    return result


@router.post("/products/approve")
def approve_products(body: BulkApproveRequest) -> dict[str, Any]:
    approved: list[int] = []
    skipped: list[dict[str, Any]] = []
    with closing(connect()) as connection, connection:
        for product_id in body.product_ids:
            row = connection.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
            if row is None:
                skipped.append({"product_id": product_id, "reason": "Product not found."})
                continue
            product = _product_dict(row)
            if product["validation_status"] == "unassessed":
                skipped.append({"product_id": product_id, "reason": "Run validation first."})
                continue
            if any(issue["severity"] == "error" for issue in product["issues"]):
                skipped.append({"product_id": product_id, "reason": "Blocking validation errors remain."})
                continue
            if product["issues"] and not body.confirm_warnings:
                skipped.append({"product_id": product_id, "reason": "Confirm warnings before approval."})
                continue
            connection.execute(
                "UPDATE products SET review_status = 'approved', updated_at = ? WHERE id = ?",
                (utc_now(), product_id),
            )
            approved.append(product_id)
        if approved:
            connection.execute(
                "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
                ("Products approved", f"{len(approved)} products", utc_now()),
            )
    return {"approved_product_ids": approved, "skipped": skipped}


def _save_attribute(connection: Any, values: dict[str, Any], attribute_id: int | None = None) -> int:
    now = utc_now()
    args = (
        values["key"], values["name"], values["data_type"], int(values["required"]),
        values["category"], encode_json(values["allowed_values"]),
        encode_json(values["validation_rules"]), values["unit"], int(values["active"]), now,
    )
    if attribute_id is None:
        cursor = connection.execute(
            """INSERT INTO attributes (
                key, name, data_type, required, category, allowed_values_json,
                validation_rules_json, unit, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (*args[:-1], now, now),
        )
        return int(cursor.lastrowid)
    connection.execute(
        """UPDATE attributes SET key = ?, name = ?, data_type = ?, required = ?, category = ?,
            allowed_values_json = ?, validation_rules_json = ?, unit = ?, active = ?, updated_at = ?
            WHERE id = ?""",
        (*args, attribute_id),
    )
    return attribute_id


@router.get("/attributes")
def list_attributes() -> list[dict[str, Any]]:
    with closing(connect()) as connection:
        rows = connection.execute("SELECT * FROM attributes ORDER BY name COLLATE NOCASE").fetchall()
    return [_attribute_dict(row) for row in rows]


@router.post("/attributes", status_code=status.HTTP_201_CREATED)
def create_attribute(body: AttributeInput) -> dict[str, Any]:
    values = body.model_dump()
    with closing(connect()) as connection, connection:
        try:
            attribute_id = _save_attribute(connection, values)
        except Exception as error:
            if "UNIQUE constraint failed" in str(error):
                raise HTTPException(status_code=409, detail="An attribute with this key already exists.") from error
            raise
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Attribute created", values["name"], utc_now()),
        )
        row = connection.execute("SELECT * FROM attributes WHERE id = ?", (attribute_id,)).fetchone()
    return _attribute_dict(row)


@router.put("/attributes/{attribute_id}")
def update_attribute(attribute_id: int, body: AttributeInput) -> dict[str, Any]:
    values = body.model_dump()
    with closing(connect()) as connection, connection:
        existing = connection.execute(
            "SELECT key FROM attributes WHERE id = ?", (attribute_id,)
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Attribute not found.")
        old_key = existing["key"]
        try:
            _save_attribute(connection, values, attribute_id)
        except Exception as error:
            if "UNIQUE constraint failed" in str(error):
                raise HTTPException(status_code=409, detail="An attribute with this key already exists.") from error
            raise
        if old_key != values["key"]:
            rows = connection.execute("SELECT id, attributes_json FROM products").fetchall()
            for row in rows:
                product_attributes = decode_json(row["attributes_json"], {})
                if old_key not in product_attributes:
                    continue
                product_attributes.setdefault(values["key"], product_attributes[old_key])
                product_attributes.pop(old_key, None)
                connection.execute(
                    "UPDATE products SET attributes_json = ?, updated_at = ? WHERE id = ?",
                    (encode_json(product_attributes), utc_now(), row["id"]),
                )
        definitions = _load_attributes(connection)
        duplicate_skus = _duplicate_skus(connection)
        for product_row in connection.execute("SELECT * FROM products").fetchall():
            _revalidate_product(connection, product_row, definitions, duplicate_skus)
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Attribute updated", values["name"], utc_now()),
        )
        row = connection.execute("SELECT * FROM attributes WHERE id = ?", (attribute_id,)).fetchone()
    return _attribute_dict(row)


@router.delete("/attributes/{attribute_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attribute(attribute_id: int) -> None:
    with closing(connect()) as connection, connection:
        row = connection.execute("SELECT name FROM attributes WHERE id = ?", (attribute_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Attribute not found.")
        connection.execute("DELETE FROM attributes WHERE id = ?", (attribute_id,))
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("Attribute deleted", row["name"], utc_now()),
        )


@router.get("/woocommerce/status")
def woocommerce_status() -> dict[str, Any]:
    with closing(connect()) as connection:
        eligible_products = connection.execute(
            """SELECT COUNT(*) FROM products
               WHERE review_status = 'approved'
                 AND validation_status IN ('valid', 'valid_with_warnings')"""
        ).fetchone()[0]
    if not settings.woocommerce_configured:
        return {
            "configured": False,
            "status": "not_configured",
            "message": "Configure the store URL and REST API keys in backend/.env.",
            "eligible_products": eligible_products,
        }
    return {
        "configured": True,
        "status": woocommerce_test_status,
        "message": "Connection verified by a live API test." if woocommerce_test_status == "connected" else "Connection has not been verified.",
        "eligible_products": eligible_products,
    }


@router.post("/woocommerce/test-connection")
async def test_woocommerce_connection() -> dict[str, Any]:
    global woocommerce_test_status
    if not settings.woocommerce_configured:
        woocommerce_test_status = "not_configured"
        raise HTTPException(status_code=503, detail="WooCommerce credentials are not configured on the backend.")
    try:
        await WooCommerceClient(settings).test_connection()
    except WooCommerceError as error:
        woocommerce_test_status = "failed"
        record_activity("WooCommerce connection test failed", str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error
    woocommerce_test_status = "connected"
    record_activity("WooCommerce connection tested", "Store API responded successfully")
    return {"configured": True, "status": "connected", "message": "WooCommerce connection verified."}


async def _sync_product(product_id: int) -> dict[str, Any]:
    if not settings.woocommerce_configured:
        raise HTTPException(status_code=503, detail="WooCommerce credentials are not configured on the backend.")
    if woocommerce_test_status != "connected":
        raise HTTPException(status_code=409, detail="Test the WooCommerce connection successfully before syncing products.")
    with closing(connect()) as connection:
        row = _get_product(connection, product_id)
        product = _product_dict(row)
        definitions = _load_attributes(connection)
        if product["approval_status"] != "approved":
            raise HTTPException(status_code=409, detail="Only approved products can be synchronized.")
        if product["validation_status"] == "unassessed" or any(
            issue["severity"] == "error" for issue in product["issues"]
        ):
            raise HTTPException(status_code=409, detail="Product must pass validation before synchronization.")
    operation = "updated" if product["woocommerce_product_id"] else "created"
    try:
        woocommerce_id, operation = await WooCommerceClient(settings).sync_product(product, definitions)
        error_message = ""
        sync_status = "success"
    except WooCommerceError as error:
        woocommerce_id = None
        error_message = str(error)
        operation = error.operation or operation
        sync_status = "failed"

    with closing(connect()) as connection, connection:
        connection.execute(
            "INSERT INTO sync_history (product_id, operation, status, woocommerce_product_id, error_message, attempted_at) VALUES (?, ?, ?, ?, ?, ?)",
            (product_id, operation, sync_status, woocommerce_id, error_message, utc_now()),
        )
        if woocommerce_id:
            connection.execute(
                "UPDATE products SET woocommerce_product_id = ?, updated_at = ? WHERE id = ?",
                (woocommerce_id, utc_now(), product_id),
            )
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("WooCommerce sync " + sync_status, product["name"] or product["sku"], utc_now()),
        )
    return {
        "product_id": product_id,
        "operation": operation,
        "status": sync_status,
        "woocommerce_product_id": woocommerce_id,
        "error": error_message,
    }


def _record_skipped_sync(product_id: int, reason: str) -> None:
    with closing(connect()) as connection, connection:
        row = _get_product(connection, product_id)
        cursor = connection.execute(
            """INSERT INTO sync_history (
                product_id, operation, status, error_message, attempted_at
            ) VALUES (?, 'skipped', 'skipped', ?, ?)""",
            (product_id, reason, utc_now()),
        )
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            ("WooCommerce sync skipped", row["name"] or row["sku"], utc_now()),
        )


@router.post("/woocommerce/sync")
async def sync_woocommerce(body: WooSyncRequest) -> dict[str, Any]:
    if not settings.woocommerce_configured:
        raise HTTPException(status_code=503, detail="WooCommerce credentials are not configured on the backend.")
    with closing(connect()) as connection:
        if body.product_ids:
            products = connection.execute(
                f"SELECT id FROM products WHERE id IN ({','.join('?' for _ in body.product_ids)}) ORDER BY id",
                body.product_ids,
            ).fetchall()
        else:
            products = connection.execute(
                "SELECT id FROM products WHERE review_status = 'approved' ORDER BY id"
            ).fetchall()
    results = []
    for row in products:
        try:
            results.append(await _sync_product(row["id"]))
        except HTTPException as error:
            _record_skipped_sync(row["id"], str(error.detail))
            results.append({"product_id": row["id"], "status": "skipped", "error": error.detail})
    return {
        "attempted": len(results),
        "succeeded": sum(result["status"] == "success" for result in results),
        "failed": sum(result["status"] == "failed" for result in results),
        "results": results,
    }


@router.get("/woocommerce/sync-history")
def sync_history() -> list[dict[str, Any]]:
    with closing(connect()) as connection:
        rows = connection.execute(
            """SELECT sync_history.*, products.sku, products.name FROM sync_history
               LEFT JOIN products ON products.id = sync_history.product_id
               ORDER BY attempted_at DESC LIMIT 200"""
        ).fetchall()
    return [dict(row) for row in rows]


@router.post("/woocommerce/retry/{sync_id}")
async def retry_sync(sync_id: int) -> dict[str, Any]:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT product_id, status FROM sync_history WHERE id = ?", (sync_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Sync record not found.")
    if row["status"] != "failed":
        raise HTTPException(status_code=409, detail="Only failed synchronization attempts can be retried.")
    return await _sync_product(row["product_id"])