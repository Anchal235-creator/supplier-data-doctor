from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    database_path: str = "data/supplier_data_doctor.db"
    max_upload_size_mb: int = Field(default=10, ge=1, le=50)
    woocommerce_store_url: str = ""
    woocommerce_consumer_key: str = ""
    woocommerce_consumer_secret: str = ""
    supabase_url: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def database_file(self) -> Path:
        configured_path = Path(self.database_path)
        if configured_path.is_absolute():
            return configured_path
        backend_directory = Path(__file__).resolve().parents[1]
        return backend_directory / configured_path

    @property
    def woocommerce_configured(self) -> bool:
        return bool(
            self.woocommerce_store_url
            and self.woocommerce_consumer_key
            and self.woocommerce_consumer_secret
        )