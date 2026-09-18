import os
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

class Settings:
    PROJECT_NAME: str = "UPI FraudGuard AI"
    API_V1_STR: str = "/api/v1"
    
    # Razorpay Secrets
    RAZORPAY_KEY_ID: str | None = os.getenv("RAZORPAY_KEY_ID", None)
    RAZORPAY_KEY_SECRET: str | None = os.getenv("RAZORPAY_KEY_SECRET", None)
    RAZORPAY_WEBHOOK_SECRET: str | None = os.getenv("RAZORPAY_WEBHOOK_SECRET", None)
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./fraud_guard.db")
    
    # ML Model Configs
    MODEL_PATH: str = os.getenv("MODEL_PATH", "backend/models/upi_fraud_pipeline.pkl")
    METADATA_PATH: str = os.getenv("METADATA_PATH", "backend/models/model_metadata.json")
    REPORTS_DIR: str = os.getenv("REPORTS_DIR", "backend/reports")
    
    # Risk Level Thresholds
    RISK_THRESHOLD_LOW: int = int(os.getenv("RISK_THRESHOLD_LOW", "40"))
    RISK_THRESHOLD_HIGH: int = int(os.getenv("RISK_THRESHOLD_HIGH", "70"))

settings = Settings()

