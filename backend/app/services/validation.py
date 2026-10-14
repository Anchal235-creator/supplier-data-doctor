from decimal import Decimal, InvalidOperation
import re
from typing import Any
from urllib.parse import urlparse


BASE_REQUIRED_FIELDS = {
    "sku": "SKU",
    "name": "Product Name",
    "regular_price": "Regular Price",
}


def parse_price(value: Any) -> tuple[str, bool]:
    raw = str(value or "").strip()
    if not raw:
        return "", False
    cleaned = re.sub(r"[\s$£€]", "", raw)
    if "," in cleaned:
        if "." in cleaned or re.fullmatch(r"\d{1,3}(,\d{3})+", cleaned):
            cleaned = cleaned.replace(",", "")
        else:
            return raw, False
    try:
        amount = Decimal(cleaned)
    except InvalidOperation:
        return raw, False
    if not amount.is_finite() or amount < 0:
        return raw, False
    return format(amount.normalize(), "f"), True


def validate_product(
    product: dict[str, Any],
    attribute_definitions: list[dict[str, Any]],
    *,
    duplicate_sku: bool = False,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    attributes = product.get("attributes") or {}

    for key, label in BASE_REQUIRED_FIELDS.items():
        if not str(product.get(key) or "").strip():
            issues.append(
                {
                    "field": key,
                    "severity": "error",
                    "code": "missing_required",
                    "message": f"{label} is required.",
                    "current_value": "",
                }
            )

    if product.get("regular_price"):
        normalized_price, is_valid_price = parse_price(product["regular_price"])
        if not is_valid_price:
            issues.append(
                {
                    "field": "regular_price",
                    "severity": "error",
                    "code": "invalid_price",
                    "message": "Enter a non-negative price using an unambiguous number format.",
                    "current_value": str(product["regular_price"]),
                }
            )
        else:
            product["regular_price"] = normalized_price

    if duplicate_sku and str(product.get("sku") or "").strip():
        issues.append(
            {
                "field": "sku",
                "severity": "error",
                "code": "duplicate_sku",
                "message": "This SKU is used by another product in the catalog.",
                "current_value": str(product.get("sku")),
            }
        )

    image_url = str(product.get("image_url") or "").strip()
    if image_url:
        parsed_url = urlparse(image_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            issues.append(
                {
                    "field": "image_url",
                    "severity": "warning",
                    "code": "invalid_image_url",
                    "message": "Image URL should use a valid HTTP or HTTPS address.",
                    "current_value": image_url,
                }
            )

    required_fields = set(BASE_REQUIRED_FIELDS)
    for definition in attribute_definitions:
        if not definition.get("active", True):
            continue
        applicable_category = str(definition.get("category") or "").strip().casefold()
        product_category = str(product.get("category") or "").strip().casefold()
        if applicable_category and applicable_category != product_category:
            continue
        key = definition["key"]
        value = product.get(key) if key in product else attributes.get(key)
        if definition.get("required"):
            required_fields.add(key)
            if value is None or not str(value).strip():
                issues.append(
                    {
                        "field": key,
                        "severity": "error",
                        "code": "missing_required_attribute",
                        "message": f"{definition['name']} is required.",
                        "current_value": "",
                    }
                )
        if value is None or not str(value).strip():
            continue

        data_type = definition.get("data_type", "text")
        rules = definition.get("validation_rules") or {}
        value_string = str(value).strip()
        validation_message = ""
        if data_type == "number":
            try:
                numeric_value = Decimal(value_string)
                minimum = rules.get("min")
                maximum = rules.get("max")
                if minimum is not None and numeric_value < Decimal(str(minimum)):
                    validation_message = f"{definition['name']} must be at least {minimum}{definition.get('unit') or ''}."
                elif maximum is not None and numeric_value > Decimal(str(maximum)):
                    validation_message = f"{definition['name']} must be no more than {maximum}{definition.get('unit') or ''}."
            except InvalidOperation:
                validation_message = f"{definition['name']} must be a valid number."
        elif data_type == "boolean" and value_string.lower() not in {"true", "false", "yes", "no", "1", "0"}:
            validation_message = f"{definition['name']} must be true or false."
        elif data_type == "select" and value_string not in definition.get("allowed_values", []):
            validation_message = f"{definition['name']} must match one of the configured options."
        elif data_type == "multi_select":
            selected = [item.strip() for item in value_string.split(",") if item.strip()]
            allowed_values = set(definition.get("allowed_values", []))
            if any(item not in allowed_values for item in selected):
                validation_message = f"{definition['name']} contains an unconfigured option."

        if validation_message:
            issues.append(
                {
                    "field": key,
                    "severity": "error",
                    "code": "invalid_attribute",
                    "message": validation_message,
                    "current_value": value_string,
                }
            )

    present_fields = 0
    for key in required_fields:
        value = product.get(key) if key in product else attributes.get(key)
        if value is not None and str(value).strip():
            present_fields += 1
    completeness = round((present_fields / len(required_fields)) * 100) if required_fields else 100
    has_errors = any(issue["severity"] == "error" for issue in issues)
    validation_status = "needs_attention" if has_errors else "valid_with_warnings" if issues else "valid"
    return {
        "issues": issues,
        "completeness": completeness,
        "validation_status": validation_status,
    }