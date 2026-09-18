import random
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query
from backend.app.schemas.transaction import TransactionCreate, TransactionResponse
from backend.app.schemas.prediction import FeatureVector, PredictionResponse
from backend.app.services.feature_engineering import FeatureEngineeringService
from backend.app.services.prediction_service import prediction_service
from backend.app.repositories.transaction_repository import db_repo

router = APIRouter()

@router.post("/predict", response_model=TransactionResponse)
def predict_transaction(txn_in: TransactionCreate):
    try:
        # 1. Feature Engineering
        features = FeatureEngineeringService.generate_features(
            user_id=txn_in.user_id,
            amount=txn_in.amount,
            transaction_type=txn_in.transaction_type,
            timestamp_iso=txn_in.timestamp,
            beneficiary_id=txn_in.beneficiary_id,
            device_id=txn_in.device_id,
            latitude=txn_in.location_latitude,
            longitude=txn_in.location_longitude
        )
        
        # Add payment method to features dict so rule engine can parse it
        features["payment_method"] = txn_in.payment_method
        
        # 2. Prediction Service
        pred_res = prediction_service.predict_features(features)
        
        # Generate new transaction ID
        txn_id = f"txn_{uuid.uuid4().hex[:12]}"
        
        # 3. Save to database
        saved_txn = db_repo.save_transaction(
            txn_id=txn_id,
            user_id=txn_in.user_id,
            amount=txn_in.amount,
            txn_type=txn_in.transaction_type,
            timestamp=txn_in.timestamp,
            beneficiary_id=txn_in.beneficiary_id,
            device_id=txn_in.device_id,
            latitude=txn_in.location_latitude,
            longitude=txn_in.location_longitude,
            is_fraud=pred_res["prediction"],
            prob=pred_res["fraud_probability"],
            score=pred_res["risk_score"],
            level=pred_res["risk_level"],
            rules=pred_res["triggered_rules"],
            payment_method=txn_in.payment_method
        )
        
        return saved_txn
        
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@router.post("/predict/features", response_model=PredictionResponse)
def predict_raw_features(features: FeatureVector):
    try:
        features_dict = features.dict()
        
        # Derive realistic payment method based on transaction characteristics
        amt = features_dict["transaction_amount"]
        txn_t = features_dict["transaction_type"]
        pay_method = "UPI"
        if amt > 25000:
            pay_method = "Net Banking"
        elif txn_t in ["Bill Payment", "Merchant"]:
            pay_method = "Credit Card"
        elif txn_t == "Recharge":
            pay_method = "Wallet"
            
        features_dict["payment_method"] = pay_method
        pred_res = prediction_service.predict_features(features_dict)
        
        # Save to SQLite database so it appears in the transaction history
        import uuid
        txn_id = f"txn_manual_{uuid.uuid4().hex[:8]}"
            
        db_repo.save_transaction(
            txn_id=txn_id,
            user_id="U_MANUAL",
            amount=features_dict["transaction_amount"],
            txn_type=features_dict["transaction_type"],
            timestamp=datetime.now().isoformat(),
            beneficiary_id="vpa_manual@upi",
            device_id="dev_manual",
            latitude=22.5942,
            longitude=85.9754,
            is_fraud=pred_res["prediction"],
            prob=pred_res["fraud_probability"],
            score=pred_res["risk_score"],
            level=pred_res["risk_level"],
            rules=pred_res["triggered_rules"],
            payment_method=pay_method
        )
        
        return pred_res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model evaluation failed: {str(e)}")

@router.post("/demo/generate")
def generate_demo_transaction(scenario: str = Query("normal", enum=["normal", "suspicious", "high_risk"])):
    try:
        # Pick a random user from seeded user profiles
        conn = db_repo.get_connection()
        cursor = conn.execute("SELECT user_id FROM user_profiles ORDER BY RANDOM() LIMIT 1")
        row = cursor.fetchone()
        conn.close()
        
        if row:
            user_id = row["user_id"]
        else:
            user_id = f"U{random.randint(10000, 10999)}"
            
        # Get user profile stats to generate relative amounts
        user_profile = db_repo.get_user_profile(user_id)
        avg_amount = user_profile["avg_amount"] if user_profile else 1500.0
        last_lat = user_profile["last_latitude"] if user_profile else 12.9716
        last_lon = user_profile["last_longitude"] if user_profile else 77.5946
        
        timestamp = datetime.now()
        
        # Scenarios parameters
        if scenario == "normal":
            amount = round(avg_amount * random.uniform(0.3, 1.1), 2)
            if amount <= 0: amount = 100.0
            transaction_type = random.choice(["P2P", "P2M", "Merchant"])
            beneficiary_id = f"vpa_{random.randint(100, 999)}@upi"
            device_id = f"dev_{random.randint(100, 999)}"
            # Location is very close
            location_latitude = round(last_lat + random.uniform(-0.005, 0.005), 4)
            location_longitude = round(last_lon + random.uniform(-0.005, 0.005), 4)
            
        elif scenario == "suspicious":
            amount = round(avg_amount * random.uniform(2.5, 4.0), 2)
            if amount < 2000: amount = round(random.uniform(5000, 12000), 2)
            transaction_type = random.choice(["Bill Payment", "Recharge"])
            # Generate a new beneficiary and suspicious device
            beneficiary_id = "vpa_suspicious_mule@upi"
            device_id = "dev_unfamiliar"
            # Location is moderately far (30-80 km)
            location_latitude = round(last_lat + random.uniform(0.3, 0.8), 4)
            location_longitude = round(last_lon + random.uniform(0.3, 0.8), 4)
            
        else: # high_risk
            amount = round(avg_amount * random.uniform(6.0, 12.0), 2)
            if amount < 10000: amount = round(random.uniform(35000, 85000), 2)
            transaction_type = "P2P"
            beneficiary_id = "vpa_flagged_fraud_wallet@upi"
            device_id = "dev_blacklisted_malware"
            # Location is extremely far (impossible travel: 800+ km away)
            location_latitude = round(last_lat + random.uniform(6.0, 12.0), 4)
            location_longitude = round(last_lon + random.uniform(6.0, 12.0), 4)
            # Subtract 2 minutes from last txn time to force velocity travel speed check
            # We insert a quick fake recent transaction at last location in DB first
            last_txn_time = (timestamp - timedelta(minutes=2)).isoformat()
            
            # Save a dummy transaction just 2 mins ago to force velocity & impossible travel flag
            db_repo.save_transaction(
                txn_id=f"txn_velocity_{random.randint(1000,9999)}",
                user_id=user_id,
                amount=100.0,
                txn_type="P2P",
                timestamp=last_txn_time,
                beneficiary_id="vpa_legit@upi",
                device_id="dev_legit",
                latitude=last_lat,
                longitude=last_lon,
                is_fraud=0,
                prob=0.01,
                score=1,
                level="LOW",
                rules=[],
                payment_method="UPI"
            )

        # Scenarios payment methods
        if scenario == "normal":
            payment_method = random.choice(["UPI", "UPI", "UPI", "Net Banking", "Debit Card", "Wallet"])
        elif scenario == "suspicious":
            payment_method = random.choice(["Credit Card", "Net Banking", "IMPS", "Wallet"])
        else:
            payment_method = random.choice(["Credit Card", "IMPS", "Wallet", "Net Banking"])

        return {
            "user_id": user_id,
            "amount": amount,
            "transaction_type": transaction_type,
            "timestamp": timestamp.isoformat(),
            "beneficiary_id": beneficiary_id,
            "device_id": device_id,
            "location_latitude": location_latitude,
            "location_longitude": location_longitude,
            "payment_method": payment_method
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Demo generation failed: {str(e)}")

@router.post("/model/select")
def select_active_model(model_name: str = Query(..., description="Name of the model to activate")):
    try:
        prediction_service.switch_model(model_name)
        return {
            "status": "success",
            "active_model": prediction_service.active_model_name,
            "metadata": prediction_service.metadata
        }
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

