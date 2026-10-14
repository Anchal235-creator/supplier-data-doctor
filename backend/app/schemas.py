from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class MappingUpdate(BaseModel):
    mappings: dict[str, str | None]


class ProductInput(BaseModel):
    sku: str = Field(default="", max_length=100)
    name: str = Field(default="", max_length=255)
    regular_price: str = Field(default="", max_length=50)
    category: str = Field(default="", max_length=150)
    description: str = Field(default="", max_length=10000)
    image_url: str = Field(default="", max_length=2048)
    attributes: dict[str, Any] = Field(default_factory=dict)


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, max_length=255)
    regular_price: str | None = Field(default=None, max_length=50)
    category: str | None = Field(default=None, max_length=150)
    description: str | None = Field(default=None, max_length=10000)
    image_url: str | None = Field(default=None, max_length=2048)
    attributes: dict[str, Any] | None = None


class ReviewUpdate(BaseModel):
    status: Literal["approved", "rejected", "pending_review"]
    confirm_warnings: bool = False


class BulkApproveRequest(BaseModel):
    product_ids: list[int] = Field(min_length=1, max_length=500)
    confirm_warnings: bool = False


class AttributeInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    key: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_]*$")
    data_type: Literal["text", "number", "boolean", "select", "multi_select"]
    required: bool = False
    category: str = Field(default="", max_length=150)
    allowed_values: list[str] = Field(default_factory=list, max_length=100)
    validation_rules: dict[str, float | int | str | bool] = Field(default_factory=dict)
    unit: str = Field(default="", max_length=30)
    active: bool = True

    @field_validator("name", "category", "unit")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("allowed_values")
    @classmethod
    def trim_allowed_values(cls, values: list[str]) -> list[str]:
        return [value.strip() for value in values if value.strip()]

    @model_validator(mode="after")
    def require_options_for_select(self) -> "AttributeInput":
        if self.data_type in {"select", "multi_select"} and not self.allowed_values:
            raise ValueError("Select attributes require at least one allowed value.")
        return self


class WooSyncRequest(BaseModel):
    product_ids: list[int] | None = Field(default=None, max_length=500)