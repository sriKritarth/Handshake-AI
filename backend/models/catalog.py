from typing import List, Optional
from pydantic import BaseModel, Field

class CatalogItem(BaseModel):
    """Public, buyer-visible catalog item model."""
    sku: str = Field(..., description="Unique Stock Keeping Unit identifier")
    name: str = Field(..., description="Product name")
    category: str = Field(..., description="Product category")
    list_price: float = Field(..., description="Public list price in INR")
    description: str = Field(..., description="Product description")
    bundle_group: Optional[str] = Field(None, description="Bundle group ID if part of a bundle")
    substitute_of: Optional[str] = Field(None, description="SKU identifier of parent product if substitute variant")
    stock_qty: int = Field(..., description="Available inventory quantity")
    tags: List[str] = Field(default_factory=list, description="Product tags")
