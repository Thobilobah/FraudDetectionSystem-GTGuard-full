from pydantic import BaseModel, Field
from datetime import datetime

class TransactionBase(BaseModel):
    user_id: str = Field(..., description="Unique customer ID (e.g. U10001)")
    amount: float = Field(..., description="Transaction amount in INR")
    transaction_type: str = Field("P2P", description="Type of transaction (P2P, P2M, Recharge, Bill Payment, Merchant)")
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat(), description="ISO timestamp of the transaction")
    beneficiary_id: str = Field(..., description="Receiver's identifier or UPI VPA")
    device_id: str = Field(..., description="Device fingerprint / ID")
    location_latitude: float = Field(..., description="GPS Latitude")
    location_longitude: float = Field(..., description="GPS Longitude")
    payment_method: str = Field("UPI", description="Payment channel used (UPI, Credit Card, Debit Card, Net Banking, Wallet, IMPS)")

class TransactionCreate(TransactionBase):
    pass

class TransactionResponse(TransactionBase):
    transaction_id: str
    is_fraud: int | None = None
    fraud_probability: float | None = None
    risk_score: int | None = None
    risk_level: str | None = None
    triggered_rules: list[dict] = []
    created_at: str
