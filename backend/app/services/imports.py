from io import BytesIO
from datetime import date, datetime
import re
from typing import Any

import pandas as pd


STANDARD_FIELDS = {
    "sku": "SKU",
    "name": "Product Name",
    "regular_price": "Regular Price",
    "category": "Category",
    "description": "Description",
    "image_url": "Product Image URL",
    "dimensions": "Dimensions",
    "surface_finish": "Surface Finish",
    "color": "Color",
    "material": "Material",
    "water_absorption": "Water Absorption",
    "packaging_information": "Packaging Information",
}

FIELD_ALIASES = {
    "sku": {"sku", "productcode", "itemnumber", "productid", "itemcode", "code"},
    "name": {"productname", "itemname", "producttitle", "name", "title", "product"},
    "regular_price": {"regularprice", "price", "rate", "sellingprice", "retailprice", "cost"},
    "category": {"category", "productcategory", "type", "producttype"},
    "description": {"description", "productdescription", "details", "longdescription"},
    "image_url": {"imageurl", "image", "productimage", "photourl"},
    "dimensions": {"dimensions", "tilesize", "size", "measurements"},
    "surface_finish": {"surfacefinish", "surfacetype", "finish", "texture"},
    "color": {"color", "colour", "shade", "tone"},
    "material": {"material", "composition", "base_material"},
    "water_absorption": {"waterabsorption", "absorption", "waterabsorptionrate"},
    "packaging_information": {"packaginginformation", "packaging", "package", "coverage"},
}

MAX_ROWS = 10000


class ImportFileError(ValueError):
    pass


def normalize_header(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).strip().lower())


def suggest_mapping(columns: list[str]) -> dict[str, str | None]:
    suggestions: dict[str, str | None] = {}
    used_fields: set[str] = set()
    normalized_aliases = {
        alias: field for field, aliases in FIELD_ALIASES.items() for alias in aliases
    }
    for column in columns:
        normalized = normalize_header(column)
        field = normalized_aliases.get(normalized)
        if field in used_fields:
            field = None
        if field:
            used_fields.add(field)
        suggestions[column] = field
    return suggestions


def parse_supplier_file(filename: str, content: bytes) -> dict[str, Any]:
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix not in {"csv", "xlsx"}:
        raise ImportFileError("Unsupported file type. Upload a CSV or XLSX file.")
    if not content:
        raise ImportFileError("The selected file is empty.")

    try:
        if suffix == "csv":
            frame = pd.read_csv(
                BytesIO(content),
                dtype=object,
                keep_default_na=False,
                encoding="utf-8-sig",
                nrows=MAX_ROWS + 1,
            )
        else:
            frame = pd.read_excel(
                BytesIO(content),
                dtype=object,
                keep_default_na=False,
                engine="openpyxl",
                nrows=MAX_ROWS + 1,
            )
    except Exception as error:
        raise ImportFileError("The file could not be read. Check its format and header row.") from error

    if len(frame.columns) == 0:
        raise ImportFileError("No column headers were found in the file.")
    if frame.empty:
        raise ImportFileError("The file has headers but no product rows.")
    if len(frame) > MAX_ROWS:
        raise ImportFileError(f"Files may contain at most {MAX_ROWS:,} rows.")

    columns: list[str] = []
    for index, column in enumerate(frame.columns):
        label = str(column).strip()
        columns.append(label or f"Column {index + 1}")
    frame.columns = columns

    rows: list[dict[str, str]] = []
    for record in frame.to_dict(orient="records"):
        normalized_record: dict[str, str] = {}
        for column, value in record.items():
            column_name = str(column)
            if value is None:
                normalized_record[column_name] = ""
            elif isinstance(value, (list, dict)):
                normalized_record[column_name] = str(value).strip()
            elif pd.isna(value):
                normalized_record[column_name] = ""
            elif isinstance(value, (datetime, date)):
                normalized_record[column_name] = value.isoformat()
            else:
                normalized_record[column_name] = str(value).strip()
        rows.append(normalized_record)

    suggestions = suggest_mapping(columns)
    preview_rows = rows[:8]
    return {
        "columns": columns,
        "row_count": len(rows),
        "rows": rows,
        "preview_rows": preview_rows,
        "mappings": suggestions,
        "column_details": [
            {
                "name": column,
                "sample_values": [row.get(column, "") for row in rows[:3]],
                "suggested_field": suggestions[column],
                "match_status": "suggested" if suggestions[column] else "unmapped",
            }
            for column in columns
        ],
    }