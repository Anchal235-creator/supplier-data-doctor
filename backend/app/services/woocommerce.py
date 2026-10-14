from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import Settings


class WooCommerceError(Exception):
    def __init__(self, message: str, *, operation: str | None = None):
        super().__init__(message)
        self.operation = operation


class WooCommerceClient:
    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.settings = settings
        self.transport = transport
        parsed = urlparse(settings.woocommerce_store_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise WooCommerceError("Configure a valid HTTPS WooCommerce store URL.")
        self.api_root = f"{settings.woocommerce_store_url.rstrip('/')}/wp-json/wc/v3"
        self.api_url = f"{self.api_root}/products"

    async def _request(
        self,
        method: str,
        endpoint: str = "",
        *,
        params: dict[str, str | int] | None = None,
        payload: dict[str, Any] | None = None,
        resource: str = "products",
    ) -> Any:
        try:
            async with httpx.AsyncClient(
                auth=(self.settings.woocommerce_consumer_key, self.settings.woocommerce_consumer_secret),
                timeout=httpx.Timeout(15.0, connect=5.0),
                transport=self.transport,
            ) as client:
                response = await client.request(
                    method,
                    f"{self.api_root}/{resource}{endpoint}",
                    params=params,
                    json=payload,
                )
                response.raise_for_status()
        except httpx.TimeoutException as error:
            raise WooCommerceError("WooCommerce request timed out.") from error
        except httpx.HTTPStatusError as error:
            raise WooCommerceError(
                f"WooCommerce returned HTTP {error.response.status_code}. Check API permissions and store settings."
            ) from error
        except httpx.RequestError as error:
            raise WooCommerceError("Could not reach the WooCommerce store.") from error

        try:
            return response.json()
        except ValueError as error:
            raise WooCommerceError("WooCommerce returned an invalid response.") from error

    async def test_connection(self) -> None:
        result = await self._request("GET", params={"per_page": 1})
        if not isinstance(result, list):
            raise WooCommerceError("WooCommerce returned an unexpected products response.")

    async def sync_product(
        self,
        product: dict[str, Any],
        attribute_definitions: list[dict[str, Any]],
    ) -> tuple[int, str]:
        attributes = product.get("attributes") or {}
        existing_id = product.get("woocommerce_product_id")
        operation = "updated" if existing_id else "created"

        if not existing_id:
            try:
                matches = await self._request("GET", params={"sku": product["sku"], "per_page": 1})
            except WooCommerceError as error:
                error.operation = operation
                raise
            if not isinstance(matches, list):
                raise WooCommerceError(
                    "WooCommerce returned an unexpected SKU lookup response.", operation=operation
                )
            if matches:
                existing_id = matches[0].get("id")
                if existing_id:
                    operation = "updated"

        payload: dict[str, Any] = {
            "name": product["name"],
            "sku": product["sku"],
            "regular_price": product["regular_price"],
            "description": product.get("description", ""),
        }
        if product.get("image_url"):
            payload["images"] = [{"src": product["image_url"]}]
        category = str(product.get("category") or "").strip()
        if category:
            try:
                categories = await self._request(
                    "GET",
                    resource="products/categories",
                    params={"search": category, "per_page": 100},
                )
            except WooCommerceError as error:
                error.operation = operation
                raise
            if not isinstance(categories, list):
                raise WooCommerceError(
                    "WooCommerce returned an unexpected category response.", operation=operation
                )
            category_match = next(
                (
                    item
                    for item in categories
                    if str(item.get("name") or "").strip().casefold() == category.casefold()
                    and isinstance(item.get("id"), int)
                ),
                None,
            )
            if category_match is None:
                raise WooCommerceError(
                    f"WooCommerce category '{category}' was not found. Create it in the store before syncing this product.",
                    operation=operation,
                )
            payload["categories"] = [{"id": category_match["id"]}]

        definitions = {definition["key"]: definition for definition in attribute_definitions}
        mapped_attributes = []
        for key, value in attributes.items():
            if value is None or not str(value).strip():
                continue
            definition = definitions.get(key)
            name = definition["name"] if definition else key.replace("_", " ").title()
            options = [item.strip() for item in str(value).split(",") if item.strip()]
            mapped_attributes.append({"name": name, "options": options, "visible": True})
        if mapped_attributes:
            payload["attributes"] = mapped_attributes

        try:
            if existing_id:
                result = await self._request("PUT", f"/{int(existing_id)}", payload=payload)
            else:
                result = await self._request("POST", payload=payload)
        except WooCommerceError as error:
            error.operation = operation
            raise

        if not isinstance(result, dict) or not isinstance(result.get("id"), int):
            raise WooCommerceError("WooCommerce did not confirm the product operation.", operation=operation)
        return result["id"], operation