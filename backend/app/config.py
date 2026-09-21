import os
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

# Resolve the repository root relative to THIS file (backend/app/config.py),
# not the process cwd. Serverless platforms (Vercel) do not guarantee that
# the working directory is the repo root, so absolute-path lookups for the
# models/reports/data folders would otherwise break there.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class Settings:
    PROJECT_NAME: str = "UPI FraudGuard AI"
    API_V1_STR: str = "/api/v1"
    
    # Razorpay Secrets
    RAZORPAY_KEY_ID: str | None = os.getenv("RAZORPAY_KEY_ID", None)
    RAZORPAY_KEY_SECRET: str | None = os.getenv("RAZORPAY_KEY_SECRET", None)
    RAZORPAY_WEBHOOK_SECRET: str | None = os.getenv("RAZORPAY_WEBHOOK_SECRET", None)
    
    # Database (PostgreSQL)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://fraudguard:fraudguard@localhost:5432/fraudguard_db"
    )
    
    # ML Model Configs (defaults are repo-root-relative, so they work
    # regardless of the process working directory)
    MODEL_PATH: str = os.getenv("MODEL_PATH", os.path.join(BASE_DIR, "backend", "models", "upi_fraud_pipeline.pkl"))
    METADATA_PATH: str = os.getenv("METADATA_PATH", os.path.join(BASE_DIR, "backend", "models", "model_metadata.json"))
    REPORTS_DIR: str = os.getenv("REPORTS_DIR", os.path.join(BASE_DIR, "backend", "reports"))
    
    # Risk Level Thresholds
    RISK_THRESHOLD_LOW: int = int(os.getenv("RISK_THRESHOLD_LOW", "40"))
    RISK_THRESHOLD_HIGH: int = int(os.getenv("RISK_THRESHOLD_HIGH", "70"))

settings = Settings()

