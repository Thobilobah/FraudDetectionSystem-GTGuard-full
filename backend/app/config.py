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
    # 127.0.0.1 instead of "localhost": on Windows "localhost" resolves to
    # ::1 first and each connect pays a ~2s IPv6 fallback stall before
    # falling back to IPv4. Vercel always sets DATABASE_URL, so this default
    # only matters for local development.
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://fraudguard:fraudguard@127.0.0.1:5432/fraudguard_db"
    )
    
    # ML Model Configs (defaults are repo-root-relative, so they work
    # regardless of the process working directory)
    MODEL_PATH: str = os.getenv("MODEL_PATH", os.path.join(BASE_DIR, "backend", "models", "upi_fraud_pipeline.pkl"))
    METADATA_PATH: str = os.getenv("METADATA_PATH", os.path.join(BASE_DIR, "backend", "models", "model_metadata.json"))
    REPORTS_DIR: str = os.getenv("REPORTS_DIR", os.path.join(BASE_DIR, "backend", "reports"))
    
    # Risk Level Thresholds
    RISK_THRESHOLD_LOW: int = int(os.getenv("RISK_THRESHOLD_LOW", "40"))
    RISK_THRESHOLD_HIGH: int = int(os.getenv("RISK_THRESHOLD_HIGH", "70"))

    # Customer-authentication gate for the bottom of the MEDIUM band: a
    # MEDIUM transaction scoring at/below AUTH_REQUIRED_MAX_SCORE (i.e. 40-45)
    # is held as PENDING with required_action='USER_AUTH' - "awaiting user
    # authentication". Analysts must NOT flag these; the customer clears the
    # hold by authenticating (-> APPROVED). If they have not authenticated
    # within AUTH_LIFESPAN_MIN minutes the policy sweep blocks it instead
    # (-> BLOCKED, resolved_by='system:auth-timeout').
    AUTH_REQUIRED_MAX_SCORE: int = int(os.getenv("AUTH_REQUIRED_MAX_SCORE", "45"))
    AUTH_LIFESPAN_MIN: int = int(os.getenv("AUTH_LIFESPAN_MIN", "15"))

    # Policy sweep trigger (the dashboard nudges it on its poll). The sweep
    # itself only ever auto-BLOCKS unauthenticated USER_AUTH holds past their
    # lifespan; it never auto-approves. BATCH bounds rows per run.
    AUTO_RESOLVE_ENABLED: bool = os.getenv("AUTO_RESOLVE_ENABLED", "true").lower() == "true"
    AUTO_RESOLVE_BATCH: int = int(os.getenv("AUTO_RESOLVE_BATCH", "50"))

    # CORS: comma-separated allowlist of dashboard origins. Defaults to "*"
    # (any origin, credentials off) for demo simplicity; set CORS_ORIGINS in
    # production (e.g. "https://fraudguard-dashboard-eta.vercel.app") to lock
    # the API to the real dashboard(s).
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()
    ]

settings = Settings()

