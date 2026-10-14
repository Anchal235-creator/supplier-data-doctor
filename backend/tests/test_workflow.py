from io import BytesIO
import asyncio
from contextlib import closing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import pandas as pd
from fastapi.testclient import TestClient

from app import database, routes
from app.config import Settings
from app.main import app
from app.services.woocommerce import WooCommerceClient, WooCommerceError


class WorkflowApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.database_path = str(Path(self.temp_directory.name) / "test.db")
        self.original_database_path = database.settings.database_path
        database.settings.database_path = self.database_path
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        database.settings.database_path = self.original_database_path
        self.temp_directory.cleanup()

    @staticmethod
    def configured_woocommerce() -> Settings:
        return Settings(
            woocommerce_store_url="https://shop.example.test",
            woocommerce_consumer_key="ck_test_only",
            woocommerce_consumer_secret="cs_test_only",
        )

    def create_approved_product(self, sku: str = "SYNC-1") -> dict:
        response = self.client.post(
            "/api/products",
            json={"sku": sku, "name": "Approved tile", "regular_price": "19.95", "category": "Construction tiles"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        product = response.json()
        approved = self.client.put(
            f"/api/products/{product['id']}/review", json={"status": "approved"}
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        return approved.json()

    def test_health_reports_running(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_csv_import_mapping_validation_and_persistence(self) -> None:
        content = (
            b"Product_Code,Item_Name,Rate,Tile_Size,Finish\n"
            b"T-100,Porcelain tile,24.50,600 x 600 mm,Matte\n"
            b"T-100,Duplicate tile,-2,300 x 600 mm,Polished\n"
            b"T-102,, ,600 x 600 mm,Matte\n"
            b"T-103,Valid sample,17.00,300 x 300 mm,Textured\n"
        )
        preview = self.client.post(
            "/api/import/preview",
            files={"file": ("supplier.csv", content, "text/csv")},
        )
        self.assertEqual(preview.status_code, 201, preview.text)
        preview_body = preview.json()
        self.assertEqual(preview_body["row_count"], 4)
        self.assertEqual(preview_body["mappings"]["Product_Code"], "sku")
        self.assertEqual(preview_body["mappings"]["Item_Name"], "name")

        import_id = preview_body["import_id"]
        incomplete_mapping = self.client.put(
            f"/api/import/{import_id}/mapping",
            json={"mappings": {"Product_Code": "sku"}},
        )
        self.assertEqual(incomplete_mapping.status_code, 200)
        incomplete = self.client.post(f"/api/import/{import_id}/process")
        self.assertEqual(incomplete.status_code, 422)

        mapping = self.client.put(
            f"/api/import/{import_id}/mapping",
            json={
                "mappings": {
                    "Product_Code": "sku",
                    "Item_Name": "name",
                    "Rate": "regular_price",
                    "Tile_Size": "dimensions",
                    "Finish": "surface_finish",
                }
            },
        )
        self.assertEqual(mapping.status_code, 200, mapping.text)
        processed = self.client.post(f"/api/import/{import_id}/process")
        self.assertEqual(processed.status_code, 200, processed.text)
        self.assertEqual(processed.json()["total_rows"], 4)
        self.assertEqual(processed.json()["rows_with_errors"], 3)

        products = self.client.get("/api/products").json()
        self.assertEqual(products["total"], 4)
        duplicate = next(item for item in products["items"] if item["source_row"] == 3)
        issue_codes = {issue["code"] for issue in duplicate["issues"]}
        self.assertIn("duplicate_sku", issue_codes)
        self.assertIn("invalid_price", issue_codes)

        blocked = self.client.put(
            f"/api/products/{duplicate['id']}/review", json={"status": "approved"}
        )
        self.assertEqual(blocked.status_code, 409)

        valid = next(item for item in products["items"] if item["sku"] == "T-103")
        approved = self.client.put(
            f"/api/products/{valid['id']}/review", json={"status": "approved"}
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["approval_status"], "approved")

        self.client.__exit__(None, None, None)
        self.client.__enter__()
        persisted = self.client.get(f"/api/products/{valid['id']}")
        self.assertEqual(persisted.status_code, 200)
        self.assertEqual(persisted.json()["approval_status"], "approved")

    def test_xlsx_preview_and_unsupported_file(self) -> None:
        buffer = BytesIO()
        pd.DataFrame(
            [{"Product_Code": "T-200", "Item_Name": "Stone tile", "Rate": 31.5}]
        ).to_excel(buffer, index=False)
        response = self.client.post(
            "/api/import/preview",
            files={
                "file": (
                    "supplier.xlsx",
                    buffer.getvalue(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["row_count"], 1)

        unsupported = self.client.post(
            "/api/import/preview", files={"file": ("supplier.txt", b"data", "text/plain")}
        )
        self.assertEqual(unsupported.status_code, 422)

    def test_downloadable_tile_sample_runs_through_real_import_validation(self) -> None:
        sample_path = Path(__file__).resolve().parents[2] / "frontend" / "public" / "sample-tile-supplier.csv"
        content = sample_path.read_bytes()
        preview = self.client.post(
            "/api/import/preview",
            files={"file": (sample_path.name, content, "text/csv")},
        )
        self.assertEqual(preview.status_code, 201, preview.text)
        preview_body = preview.json()
        self.assertEqual(preview_body["row_count"], 18)
        self.assertEqual(preview_body["mappings"]["Coverage"], "packaging_information")
        self.assertEqual(preview_body["mappings"]["Category"], "category")
        attribute = self.client.post(
            "/api/attributes",
            json={
                "name": "Dimensions",
                "key": "dimensions",
                "data_type": "text",
                "required": True,
                "category": "Construction tiles",
            },
        )
        self.assertEqual(attribute.status_code, 201, attribute.text)

        processed = self.client.post(f"/api/import/{preview_body['import_id']}/process")
        self.assertEqual(processed.status_code, 200, processed.text)
        self.assertEqual(processed.json()["duplicate_sku_count"], 2)
        result = self.client.get(
            f"/api/validation/issues?import_id={preview_body['import_id']}"
        ).json()
        codes = [issue["code"] for issue in result["issues"]]
        self.assertEqual(codes.count("duplicate_sku"), 2)
        self.assertEqual(codes.count("invalid_price"), 1)
        self.assertGreaterEqual(codes.count("missing_required"), 2)
        self.assertEqual(codes.count("missing_required_attribute"), 1)

        products = self.client.get("/api/products?search=TILE-1001").json()["items"]
        self.assertEqual(len(products), 2)
        deleted = self.client.delete(f"/api/products/{products[0]['id']}")
        self.assertEqual(deleted.status_code, 204)
        remaining = self.client.get(f"/api/products/{products[1]['id']}").json()
        self.assertNotIn("duplicate_sku", {issue["code"] for issue in remaining["issues"]})

    def test_attributes_affect_validation_and_sync_requires_credentials(self) -> None:
        attribute = self.client.post(
            "/api/attributes",
            json={
                "name": "Surface finish",
                "key": "surface_finish",
                "data_type": "select",
                "required": True,
                "category": "Construction tiles",
                "allowed_values": ["Matte", "Polished"],
            },
        )
        self.assertEqual(attribute.status_code, 201, attribute.text)

        created = self.client.post(
            "/api/products",
            json={"sku": "ATTR-1", "name": "Tile", "regular_price": "12.00", "category": "Construction tiles"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        self.client.post("/api/validation/run")
        product = self.client.get(f"/api/products/{created.json()['id']}").json()
        self.assertIn("missing_required_attribute", {issue["code"] for issue in product["issues"]})

        connection_status = self.client.get("/api/woocommerce/status")
        self.assertFalse(connection_status.json()["configured"])
        connection_test = self.client.post("/api/woocommerce/test-connection")
        self.assertEqual(connection_test.status_code, 503)
        sync_response = self.client.post("/api/woocommerce/sync", json={})
        self.assertEqual(sync_response.status_code, 503)

    def test_attribute_key_rename_migrates_values_and_rules_are_category_scoped(self) -> None:
        attribute = self.client.post(
            "/api/attributes",
            json={
                "name": "Surface finish",
                "key": "surface_finish",
                "data_type": "select",
                "required": True,
                "category": "Construction tiles",
                "allowed_values": ["Matte", "Polished"],
            },
        ).json()
        tile = self.client.post(
            "/api/products",
            json={
                "sku": "KEY-1",
                "name": "Tile",
                "regular_price": "10",
                "category": "Construction tiles",
                "attributes": {"surface_finish": "Matte"},
            },
        ).json()
        other = self.client.post(
            "/api/products",
            json={
                "sku": "KEY-2",
                "name": "Other item",
                "regular_price": "12",
                "category": "Other category",
            },
        ).json()
        self.assertNotIn(
            "missing_required_attribute",
            {issue["code"] for issue in other["issues"]},
        )

        updated = self.client.put(
            f"/api/attributes/{attribute['id']}",
            json={
                **attribute,
                "key": "finish",
            },
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        migrated = self.client.get(f"/api/products/{tile['id']}").json()
        self.assertEqual(migrated["attributes"]["finish"], "Matte")
        self.assertNotIn("surface_finish", migrated["attributes"])
        self.assertEqual(migrated["validation_status"], "valid")

    def test_sync_history_migration_and_product_delete_preserve_history(self) -> None:
        product = self.client.post(
            "/api/products",
            json={"sku": "HISTORY-1", "name": "History tile", "regular_price": "5.00"},
        ).json()
        with closing(database.connect()) as connection:
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("DROP TABLE sync_history")
            connection.execute(
                """CREATE TABLE sync_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
                    operation TEXT NOT NULL,
                    status TEXT NOT NULL,
                    woocommerce_product_id INTEGER,
                    error_message TEXT NOT NULL DEFAULT '',
                    attempted_at TEXT NOT NULL
                )"""
            )
            connection.execute(
                """INSERT INTO sync_history (
                    product_id, operation, status, error_message, attempted_at
                ) VALUES (?, 'created', 'failed', 'test failure', '2026-01-01T00:00:00+00:00')""",
                (product["id"],),
            )
            connection.commit()

        database.initialize_database()
        with closing(database.connect()) as connection:
            foreign_keys = connection.execute("PRAGMA foreign_key_list(sync_history)").fetchall()
        self.assertTrue(any(row["on_delete"].upper() == "SET NULL" for row in foreign_keys))

        deleted = self.client.delete(f"/api/products/{product['id']}")
        self.assertEqual(deleted.status_code, 204)
        history = self.client.get("/api/woocommerce/sync-history").json()
        self.assertEqual(len(history), 1)
        self.assertIsNone(history[0]["product_id"])
        self.assertEqual(history[0]["error_message"], "test failure")

    def test_woocommerce_connection_success_and_safe_failure(self) -> None:
        captured_requests = []

        def success_handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=[])

        success_client = WooCommerceClient(
            self.configured_woocommerce(), transport=httpx.MockTransport(success_handler)
        )
        asyncio.run(success_client.test_connection())
        self.assertEqual(captured_requests[0].method, "GET")
        self.assertEqual(captured_requests[0].url.path, "/wp-json/wc/v3/products")
        self.assertEqual(captured_requests[0].url.params["per_page"], "1")
        self.assertTrue(captured_requests[0].headers.get("authorization", "").startswith("Basic "))

        failure_client = WooCommerceClient(
            self.configured_woocommerce(),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(401, json={"message": "private upstream detail"})
            ),
        )
        with self.assertRaises(WooCommerceError) as raised:
            asyncio.run(failure_client.test_connection())
        self.assertIn("HTTP 401", str(raised.exception))
        self.assertNotIn("ck_test_only", str(raised.exception))
        self.assertNotIn("cs_test_only", str(raised.exception))
        self.assertNotIn("private upstream detail", str(raised.exception))

    def test_woocommerce_test_connection_endpoint_statuses(self) -> None:
        with (
            patch("app.routes.settings", self.configured_woocommerce()),
            patch("app.routes.woocommerce_test_status", "not_tested"),
            patch("app.routes.WooCommerceClient") as client_factory,
        ):
            client_factory.return_value.test_connection = AsyncMock(return_value=None)
            before = self.client.get("/api/woocommerce/status").json()
            self.assertEqual(before["status"], "not_tested")
            success = self.client.post("/api/woocommerce/test-connection")
            self.assertEqual(success.status_code, 200, success.text)
            self.assertEqual(success.json()["status"], "connected")
            self.assertEqual(self.client.get("/api/woocommerce/status").json()["status"], "connected")

        with (
            patch("app.routes.settings", self.configured_woocommerce()),
            patch("app.routes.woocommerce_test_status", "not_tested"),
            patch("app.routes.WooCommerceClient") as client_factory,
        ):
            client_factory.return_value.test_connection = AsyncMock(
                side_effect=WooCommerceError("WooCommerce returned HTTP 401. Check API permissions and store settings.")
            )
            failure = self.client.post("/api/woocommerce/test-connection")
            self.assertEqual(failure.status_code, 502)
            self.assertEqual(self.client.get("/api/woocommerce/status").json()["status"], "failed")

    def test_woocommerce_sync_maps_fields_and_updates_by_sku_or_saved_id(self) -> None:
        calls: list[tuple[str, str, dict | None]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = None
            if request.content:
                import json
                payload = json.loads(request.content.decode("utf-8"))
            calls.append((request.method, request.url.path, payload))
            if request.url.path.endswith("/products/categories"):
                return httpx.Response(200, json=[{"id": 9, "name": "Construction tiles"}])
            if request.method == "GET" and request.url.params.get("sku") == "SYNC-1":
                return httpx.Response(200, json=[{"id": 77}])
            if request.method in {"PUT", "POST"}:
                return httpx.Response(200 if request.method == "PUT" else 201, json={"id": 77})
            return httpx.Response(200, json=[])

        client = WooCommerceClient(
            self.configured_woocommerce(), transport=httpx.MockTransport(handler)
        )
        product = {
            "id": 1,
            "name": "Approved tile",
            "sku": "SYNC-1",
            "regular_price": "19.95",
            "description": "Tile description",
            "image_url": "https://images.example.test/tile.jpg",
            "category": "Construction tiles",
            "attributes": {"dimensions": "600 x 600 mm", "surface_finish": "Matte"},
            "woocommerce_product_id": None,
        }
        definitions = [
            {"key": "dimensions", "name": "Dimensions"},
            {"key": "surface_finish", "name": "Surface Finish"},
        ]
        first_result = asyncio.run(client.sync_product(product, definitions))
        self.assertEqual(first_result, (77, "updated"))
        first_put = next(call for call in calls if call[0] == "PUT")
        self.assertEqual(first_put[1], "/wp-json/wc/v3/products/77")
        self.assertEqual(first_put[2]["categories"], [{"id": 9}])
        self.assertEqual(first_put[2]["regular_price"], "19.95")
        self.assertEqual(first_put[2]["images"], [{"src": product["image_url"]}])
        self.assertEqual(
            first_put[2]["attributes"],
            [
                {"name": "Dimensions", "options": ["600 x 600 mm"], "visible": True},
                {"name": "Surface Finish", "options": ["Matte"], "visible": True},
            ],
        )

        product["woocommerce_product_id"] = first_result[0]
        previous_lookup_count = sum(method == "GET" and path.endswith("/products") for method, path, _ in calls)
        second_result = asyncio.run(client.sync_product(product, definitions))
        self.assertEqual(second_result, (77, "updated"))
        current_lookup_count = sum(method == "GET" and path.endswith("/products") for method, path, _ in calls)
        self.assertEqual(current_lookup_count, previous_lookup_count)
        self.assertEqual(sum(method == "PUT" and path.endswith("/products/77") for method, path, _ in calls), 2)

    def test_unapproved_product_is_not_sent_to_woocommerce(self) -> None:
        pending = self.client.post(
            "/api/products",
            json={"sku": "PENDING-1", "name": "Pending tile", "regular_price": "8.00"},
        ).json()
        with (
            patch("app.routes.settings", self.configured_woocommerce()),
            patch("app.routes.woocommerce_test_status", "connected"),
            patch("app.routes.WooCommerceClient") as client_factory,
        ):
            client_factory.return_value.sync_product = AsyncMock()
            response = self.client.post("/api/woocommerce/sync", json={"product_ids": [pending["id"]]})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["results"][0]["status"], "skipped")
            client_factory.return_value.sync_product.assert_not_awaited()
            skipped_history = self.client.get("/api/woocommerce/sync-history").json()
            self.assertEqual(len(skipped_history), 1)
            self.assertEqual(skipped_history[0]["status"], "skipped")
            self.assertIn("Only approved products", skipped_history[0]["error_message"])

    def test_sync_success_failure_history_and_retry_are_persisted(self) -> None:
        successful_product = self.create_approved_product("SYNC-OK")
        retry_product = self.create_approved_product("SYNC-RETRY")
        with (
            patch("app.routes.settings", self.configured_woocommerce()),
            patch("app.routes.woocommerce_test_status", "connected"),
            patch("app.routes.WooCommerceClient") as client_factory,
        ):
            client_factory.return_value.sync_product = AsyncMock(return_value=(501, "created"))
            response = self.client.post(
                "/api/woocommerce/sync", json={"product_ids": [successful_product["id"]]}
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["succeeded"], 1)
            saved = self.client.get(f"/api/products/{successful_product['id']}").json()
            self.assertEqual(saved["woocommerce_product_id"], 501)
            successful_history = self.client.get("/api/woocommerce/sync-history").json()
            successful_record = next(item for item in successful_history if item["product_id"] == successful_product["id"])
            self.assertEqual(successful_record["status"], "success")

        with (
            patch("app.routes.settings", self.configured_woocommerce()),
            patch("app.routes.woocommerce_test_status", "connected"),
            patch("app.routes.WooCommerceClient") as client_factory,
        ):
            client_factory.return_value.sync_product = AsyncMock(
                side_effect=[WooCommerceError("WooCommerce returned HTTP 503. Check API permissions and store settings."), (502, "created")]
            )
            failed = self.client.post(
                "/api/woocommerce/sync", json={"product_ids": [retry_product["id"]]}
            )
            self.assertEqual(failed.json()["failed"], 1)
            history = self.client.get("/api/woocommerce/sync-history").json()
            failed_record = next(item for item in history if item["product_id"] == retry_product["id"])
            self.assertEqual(failed_record["status"], "failed")
            retried = self.client.post(f"/api/woocommerce/retry/{failed_record['id']}")
            self.assertEqual(retried.status_code, 200, retried.text)
            self.assertEqual(retried.json()["status"], "success")
            saved_after_retry = self.client.get(f"/api/products/{retry_product['id']}").json()
            self.assertEqual(saved_after_retry["woocommerce_product_id"], 502)
            retry_history = self.client.get("/api/woocommerce/sync-history").json()
            matching_history = [item for item in retry_history if item["product_id"] == retry_product["id"]]
            self.assertEqual(len(matching_history), 2)
            self.assertEqual({item["status"] for item in matching_history}, {"failed", "success"})

    def test_sync_all_uses_every_valid_approved_product_and_status_count(self) -> None:
        first = self.create_approved_product("SYNC-ALL-1")
        second = self.create_approved_product("SYNC-ALL-2")
        with (
            patch("app.routes.settings", self.configured_woocommerce()),
            patch("app.routes.woocommerce_test_status", "connected"),
            patch("app.routes.WooCommerceClient") as client_factory,
        ):
            client_factory.return_value.sync_product = AsyncMock(
                side_effect=[(601, "created"), (602, "created")]
            )
            status = self.client.get("/api/woocommerce/status").json()
            self.assertEqual(status["eligible_products"], 2)
            response = self.client.post("/api/woocommerce/sync", json={})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["attempted"], 2)
            self.assertEqual(response.json()["succeeded"], 2)
            self.assertEqual(
                {self.client.get(f"/api/products/{product_id}").json()["woocommerce_product_id"] for product_id in (first["id"], second["id"])},
                {601, 602},
            )


if __name__ == "__main__":
    unittest.main()