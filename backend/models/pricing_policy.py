from typing import List, Optional 
from pydantic import BaseModel, Field
from datetime import date

class QuantityTier(BaseModel):
    """Quantity-based discount tier definition."""
    min_qty: int = Field(..., description="Minimum order quantity for tier")
    max_qty: Optional[int] = Field(None, description="Maximum order quantity for tier (None = unlimited)")
    discount_pct: float = Field(..., description="Discount percentage for this tier")

class InventoryDiscretion(BaseModel):
    """Discretionary discount rules based on inventory age."""
    age_threshold_days: int = Field(..., description="Days threshold after which extra discount is available")
    extra_discount_pct: float = Field(..., description="Extra discount percentage permitted for aged inventory")

class PricingPolicy(BaseModel):
    """Hidden, seller-only pricing policy per SKU."""
    sku: str = Field(..., description="Unique SKU identifier")
    cost_price: float = Field(..., description="Cost price in INR")
    floor_price: float = Field(..., description="Absolute absolute minimum floor price in INR")
    margin_floor_pct: float = Field(..., description="Minimum required margin percentage over cost price")
    quantity_tiers: List[QuantityTier] = Field(default_factory=list, description="Volume discount tiers")
    inventory_age_days: int = Field(..., description="Number of days item has been in stock")
    expiry_date: Optional[date] = Field(None, description="ISO format date string for perishable or clearance products")
    inventory_discretion: Optional[InventoryDiscretion] = Field(None, description="Aged inventory discretion rule")
    urgency_flex_pct: float = Field(..., description="Discretionary flex margin for urgent closing")
    max_total_discount_pct: float = Field(..., description="Absolute maximum total combined discount percentage allowed")
