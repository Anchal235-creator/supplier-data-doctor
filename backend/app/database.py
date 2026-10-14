import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from typing import Any

from app.config import Settings

settings = Settings()


def connect() -> sqlite3.Connection:
    settings.database_file.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.database_file, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    with closing(connect()) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS imports (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                status TEXT NOT NULL,
                row_count INTEGER NOT NULL,
                columns_json TEXT NOT NULL,
                rows_json TEXT NOT NULL,
                mappings_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
                source_row INTEGER,
                raw_json TEXT NOT NULL DEFAULT '{}',
                sku TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                regular_price TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                image_url TEXT NOT NULL DEFAULT '',
                attributes_json TEXT NOT NULL DEFAULT '{}',
                issues_json TEXT NOT NULL DEFAULT '[]',
                completeness REAL,
                validation_status TEXT NOT NULL DEFAULT 'unassessed',
                review_status TEXT NOT NULL DEFAULT 'pending_review',
                woocommerce_product_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
            CREATE INDEX IF NOT EXISTS idx_products_import_id ON products(import_id);
            CREATE INDEX IF NOT EXISTS idx_products_review_status ON products(review_status);

            CREATE TABLE IF NOT EXISTS attributes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                data_type TEXT NOT NULL,
                required INTEGER NOT NULL DEFAULT 0,
                category TEXT NOT NULL DEFAULT '',
                allowed_values_json TEXT NOT NULL DEFAULT '[]',
                validation_rules_json TEXT NOT NULL DEFAULT '{}',
                unit TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event TEXT NOT NULL,
                detail TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                operation TEXT NOT NULL,
                status TEXT NOT NULL,
                woocommerce_product_id INTEGER,
                error_message TEXT NOT NULL DEFAULT '',
                attempted_at TEXT NOT NULL
            );
            """
        )
        _migrate_sync_history_delete_behavior(connection)


def _migrate_sync_history_delete_behavior(connection: sqlite3.Connection) -> None:
    foreign_keys = connection.execute("PRAGMA foreign_key_list(sync_history)").fetchall()
    product_reference = next(
        (row for row in foreign_keys if row["table"] == "products" and row["from"] == "product_id"),
        None,
    )
    if product_reference is None or product_reference["on_delete"].upper() != "CASCADE":
        return

    connection.execute("PRAGMA foreign_keys = OFF")
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """CREATE TABLE sync_history_migrated (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                operation TEXT NOT NULL,
                status TEXT NOT NULL,
                woocommerce_product_id INTEGER,
                error_message TEXT NOT NULL DEFAULT '',
                attempted_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """INSERT INTO sync_history_migrated (
                id, product_id, operation, status, woocommerce_product_id, error_message, attempted_at
            ) SELECT id, product_id, operation, status, woocommerce_product_id, error_message, attempted_at
              FROM sync_history"""
        )
        connection.execute("DROP TABLE sync_history")
        connection.execute("ALTER TABLE sync_history_migrated RENAME TO sync_history")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys = ON")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def record_activity(event: str, detail: str) -> None:
    with closing(connect()) as connection, connection:
        connection.execute(
            "INSERT INTO activity (event, detail, created_at) VALUES (?, ?, ?)",
            (event, detail, utc_now()),
        )


def decode_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def encode_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), default=str)