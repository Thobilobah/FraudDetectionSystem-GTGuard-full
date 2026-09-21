import os
import json
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from backend.app.config import settings
from backend.app.routes import prediction, analytics, razorpay, transactions, auth as auth_routes
from backend.app.auth import get_current_user
from backend.app.repositories.transaction_repository import db_repo
from backend.app.services.prediction_service import prediction_service

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="AI-Powered Real-Time UPI Transaction Fraud Detection and Risk Intelligence Platform",
    version="1.0.0"
)

# Enable CORS for React frontend (Vite)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Enable all origins for hackathon simplicity
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth is public (this is how a session token is obtained in the first place)
app.include_router(auth_routes.router, tags=["Authentication"])

# Everything below requires a valid Bearer token issued by /auth/login,
# so the login screen genuinely gates access to live data, not just the UI.
app.include_router(prediction.router, tags=["Prediction & Demo"], dependencies=[Depends(get_current_user)])
app.include_router(analytics.router, tags=["Analytics"], dependencies=[Depends(get_current_user)])
app.include_router(transactions.router, tags=["Transactions Log"], dependencies=[Depends(get_current_user)])

# Razorpay webhooks come from Razorpay's servers, not a logged-in user -
# they're authenticated separately via HMAC signature verification instead.
app.include_router(razorpay.router, tags=["Razorpay Integration"])

@app.get("/health")
def health_check():
    # Verify if DB connection is active
    db_ok = False
    try:
        conn = db_repo.get_connection()
        conn.execute("SELECT 1")
        conn.close()
        db_ok = True
    except Exception as e:
        print(f"Health DB error: {e}")
        
    return {
        "status": "healthy" if db_ok else "degraded",
        "service": settings.PROJECT_NAME,
        "database_engine": "PostgreSQL",
        "database_connected": db_ok,
        "razorpay_mode": "LIVE" if settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET else "DEMO/SIMULATION"
    }

@app.get("/model-info")
def model_info():
    metadata_path = os.path.abspath(settings.METADATA_PATH)
    metadata = None
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r") as f:
                metadata = json.load(f)
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error reading metadata: {str(e)}"
            }

    # Durable override: the /model/select endpoint persists the analyst's
    # active-model choice in PostgreSQL (serverless disk is read-only), so
    # report that model rather than the baked-in JSON default.
    try:
        db_active = db_repo.get_setting("active_model")
        if db_active and (metadata is None or metadata.get("selected_model") != db_active):
            csv_meta = prediction_service._metadata_from_comparison(db_active)
            if csv_meta:
                metadata = csv_meta
    except Exception as e:
        print(f"Error applying DB model override: {e}")

    if metadata:
        return {"status": "loaded", "metadata": metadata}
    return {
        "status": "unavailable",
        "message": "Model pipeline metadata file not found. Run model training first."
    }

@app.get("/feature-explanation")
def feature_explanation():
    return {
        "transaction_amount": "The amount in NGN for the current transaction.",
        "transaction_type": "The channel for the transaction: P2P, P2M, Recharge, Bill Payment, Merchant.",
        "transaction_hour": "Hour of the day the transaction occurred (0-23).",
        "day_of_week": "Day of the week the transaction occurred (e.g. Monday).",
        "amount_vs_user_avg": "Ratio of current transaction amount to the user's historical average transaction amount.",
        "daily_transaction_count": "Number of transactions made by this user in the current calendar day.",
        "daily_transaction_amount": "Total sum of transaction amounts made by this user in the current calendar day.",
        "identical_amount_count_24h": "Number of transactions of the exact same amount made by this user in the last 24 hours.",
        
        "user_avg_transaction_amount": "User's average transaction amount calculated from history.",
        "user_transaction_std": "Standard deviation of user's transaction amounts calculated from history.",
        "user_avg_daily_transactions": "User's historical average number of daily transactions.",
        "user_avg_transaction_hour": "User's historical average hour of day when transacting.",
        "behavior_deviation_score": "Composite metric scoring the degree of behavioral difference (time, location, and amount) from history.",
        
        "is_new_beneficiary": "Indicator (1 or 0) of whether this beneficiary account has ever been sent money before by this user.",
        "beneficiary_age_days": "Number of days since the beneficiary profile was created in the payment ecosystem.",
        "beneficiary_transaction_count_24h": "Number of transactions sent to this beneficiary by any user in the last 24 hours.",
        "beneficiary_unique_senders_24h": "Number of unique sender accounts sending funds to this beneficiary in the last 24 hours.",
        "beneficiary_risk_score": "Risk score (0-100) assigned to the beneficiary account based on history.",
        
        "is_new_device": "Indicator (1 or 0) of whether the device fingerprint is new for this user profile.",
        "device_account_count": "Number of distinct UPI accounts linked to this device ID.",
        "device_fraud_history": "Number of times this device has been associated with a flagged transaction.",
        "device_change_recent": "Indicator (1 or 0) of whether the device was changed from the user's last transaction.",
        
        "location_risk_score": "Risk score (0-100) of the transaction location geo-fencing segment.",
        "distance_from_last_txn_km": "Haversine distance in kilometers from the user's previous transaction location.",
        "is_new_location": "Indicator (1 or 0) of whether this transaction location is unfamiliar (> 20 km away from last).",
        "impossible_travel_flag": "Indicator (1 or 0) of physically impossible velocity (> 800 km/h) between subsequent transactions.",
        
        "transactions_last_1_min": "Number of transactions sent by the user in the last 1 minute.",
        "transactions_last_5_min": "Number of transactions sent by the user in the last 5 minutes.",
        "transactions_last_1_hour": "Number of transactions sent by the user in the last 1 hour.",
        "amount_last_5_min": "Total sum of funds sent by the user in the last 5 minutes.",
        "amount_last_1_hour": "Total sum of funds sent by the user in the last 1 hour.",
        "beneficiaries_last_1_hour": "Number of unique beneficiary accounts transacted with in the last 1 hour.",
        
        "amount_z_score": "Standardized amount score relative to user history: (amount - avg) / std.",
        "amount_percentile": "Percentile of current amount relative to user historical amounts.",
        "moving_average_deviation": "Deviation ratio of current amount from the user's 5-transaction moving average."
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main.py:app", host="0.0.0.0", port=8000, reload=True)
