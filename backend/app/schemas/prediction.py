from pydantic import BaseModel, Field

class FeatureVector(BaseModel):
    transaction_amount: float
    transaction_type: str
    transaction_hour: int
    day_of_week: str
    amount_vs_user_avg: float
    daily_transaction_count: int
    daily_transaction_amount: float
    identical_amount_count_24h: int
    
    user_avg_transaction_amount: float
    user_transaction_std: float
    user_avg_daily_transactions: float
    user_avg_transaction_hour: float
    behavior_deviation_score: float
    
    is_new_beneficiary: int
    beneficiary_age_days: int
    beneficiary_transaction_count_24h: int
    beneficiary_unique_senders_24h: int
    beneficiary_risk_score: float
    
    is_new_device: int
    device_account_count: int
    device_fraud_history: int
    device_change_recent: int
    
    location_risk_score: float
    distance_from_last_txn_km: float
    is_new_location: int
    impossible_travel_flag: int
    
    transactions_last_1_min: int
    transactions_last_5_min: int
    transactions_last_1_hour: int
    amount_last_5_min: float
    amount_last_1_hour: float
    beneficiaries_last_1_hour: int
    
    amount_z_score: float
    amount_percentile: float
    moving_average_deviation: float

    # Optional identity passthrough: when this feature vector represents a
    # real (demo-generated) transaction rather than an ad-hoc manual feature
    # test, the caller can supply these so the saved transaction record
    # reflects the actual user/beneficiary/device instead of the generic
    # "U_MANUAL" placeholder.
    user_id: str | None = None
    beneficiary_id: str | None = None
    device_id: str | None = None
    timestamp: str | None = None
    location_latitude: float | None = None
    location_longitude: float | None = None
    payment_method: str | None = None

class TriggeredRule(BaseModel):
    rule_id: str
    rule_name: str
    severity: str
    message: str

class PredictionResponse(BaseModel):
    fraud_probability: float = Field(..., description="Fraud probability (0.0 to 1.0)")
    prediction: int = Field(..., description="0 for genuine, 1 for fraud")
    risk_score: int = Field(..., description="Risk score (0 to 100)")
    risk_level: str = Field(..., description="Risk level (LOW, MEDIUM, HIGH)")
    triggered_rules: list[TriggeredRule] = Field(default=[], description="List of triggered rules")
    feature_signals: dict = Field(default={}, description="Feature values calculated for explanation")
    status: str | None = Field(default=None, description="APPROVED, BLOCKED, or SUSPENDED")
    transaction_id: str | None = Field(default=None, description="ID of the saved transaction record")
