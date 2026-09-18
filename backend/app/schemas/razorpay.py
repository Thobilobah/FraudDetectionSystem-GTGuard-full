from pydantic import BaseModel, Field
from typing import Any, Dict

class RazorpayWebhook(BaseModel):
    entity: str = Field(..., description="Webhook entity type (e.g. event)")
    account_id: str | None = None
    event: str = Field(..., description="Webhook event name (e.g. payment.captured)")
    payload: Dict[str, Any] = Field(..., description="Raw Razorpay payload containing entities")
    created_at: int | None = None
