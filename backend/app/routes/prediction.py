import random
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query, Request
from backend.app.schemas.transaction import TransactionCreate, TransactionResponse
from backend.app.schemas.prediction import FeatureVector, PredictionResponse
from backend.app.services.feature_engineering import FeatureEngineeringService
from backend.app.services.prediction_service import prediction_service
from backend.app.repositories.transaction_repository import db_repo
from backend.app.services.rate_limiter import check_rate_limit

router = APIRouter()


def status_from_risk_level(risk_level: str) -> str:
    """LOW -> auto-approved, HIGH -> auto-blocked, MEDIUM -> PENDING (sits
    visible to analysts until one of them actually flags/suspends it -
    suspension is now a deliberate analyst action, not automatic)."""
    if risk_level == "HIGH":
        return "BLOCKED"
    if risk_level == "MEDIUM":
        return "PENDING"
    return "APPROVED"


@router.post("/predict", response_model=TransactionResponse)
def predict_transaction(txn_in: TransactionCreate, request: Request):
    try:
        check_rate_limit("predict", request)
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

        status = status_from_risk_level(pred_res["risk_level"])

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
            payment_method=txn_in.payment_method,
            status=status
        )
        
        return saved_txn
        
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@router.post("/predict/features", response_model=PredictionResponse)
def predict_raw_features(features: FeatureVector, request: Request):
    try:
        check_rate_limit("predict", request)
        features_dict = features.dict()

        # Derive realistic payment method based on transaction characteristics
        # (unless the caller already supplied one, e.g. from a demo-generated
        # transaction that has a real payment method attached)
        amt = features_dict["transaction_amount"]
        txn_t = features_dict["transaction_type"]
        if features.payment_method:
            pay_method = features.payment_method
        else:
            pay_method = "USSD"
            if amt > 25000:
                pay_method = "Net Banking"
            elif txn_t in ["Bill Payment", "Merchant"]:
                pay_method = "Debit Card"
            elif txn_t == "Recharge":
                pay_method = "Wallet"

        features_dict["payment_method"] = pay_method
        pred_res = prediction_service.predict_features(features_dict)

        # Save to the database so it appears in the transaction history.
        # If this feature vector represents a real (demo-generated)
        # transaction, use its actual identity fields instead of the
        # generic manual-test placeholders.
        import uuid
        is_manual_test = features.user_id is None
        txn_id = f"txn_manual_{uuid.uuid4().hex[:8]}" if is_manual_test else f"txn_{uuid.uuid4().hex[:12]}"

        status = status_from_risk_level(pred_res["risk_level"])

        db_repo.save_transaction(
            txn_id=txn_id,
            user_id=features.user_id or "U_MANUAL",
            amount=features_dict["transaction_amount"],
            txn_type=features_dict["transaction_type"],
            timestamp=features.timestamp or datetime.now().isoformat(),
            beneficiary_id=features.beneficiary_id or "acct_manual@ussd",
            device_id=features.device_id or "dev_manual",
            latitude=features.location_latitude if features.location_latitude is not None else 22.5942,
            longitude=features.location_longitude if features.location_longitude is not None else 85.9754,
            is_fraud=pred_res["prediction"],
            prob=pred_res["fraud_probability"],
            score=pred_res["risk_score"],
            level=pred_res["risk_level"],
            rules=pred_res["triggered_rules"],
            payment_method=pay_method,
            status=status
        )

        pred_res["status"] = status
        pred_res["transaction_id"] = txn_id

        return pred_res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model evaluation failed: {str(e)}")

def _pick_amount_for_target_level(target_level: str, avg_amount: float, build_features, context=None) -> tuple[float, dict]:
    """Search a focused grid of amount-vs-average ratios and return the first
    (amount, engineered_features) pair the *live* model actually classifies
    into target_level, falling back to the closest miss if none match exactly.

    The retrained model's decision surface (fit on the Nigerian dataset) is
    not a smooth "bigger amount = riskier" curve — MEDIUM/HIGH fraud rows in
    that data cluster in a narrow amount_vs_user_avg band (empirically
    ~3x-6x average), and scores can drop back to LOW well past that band.
    So rather than guessing a fixed multiplier per scenario, we probe a handful
    of real amounts through the real pipeline and use whichever one the model
    actually agrees with — guaranteeing the analyzed result always matches the
    scenario button that was clicked.

    The probe ladder is ordered to cover the risky band densely first (3x-6x),
    then the tails, and STOPS at the first exact hit. A short, deterministic
    ladder preserves the old full-range sweep's coverage while bounding work:
    each probe is cheap now because feature context is fetched once and shared
    across all probes (no per-probe DB round-trips as in the pre-batching
    code). A single shared `context` is threaded through for the same reason.
    """
    RATIO_LADDER = [3.0, 4.0, 5.0, 6.0, 3.5, 4.5, 5.5, 6.5, 2.5, 7.0, 7.5, 8.0, 8.5]

    best_fallback = None  # (distance_to_target_band, amount, features, score)
    target_mid = {"MEDIUM": 55, "HIGH": 90}.get(target_level, 20)

    for ratio in RATIO_LADDER:
        amount = round(avg_amount * ratio, 2)
        feats = build_features(amount, context)
        res = prediction_service.predict_features(feats)
        if res["risk_level"] == target_level:
            return amount, feats
        dist = abs(res["risk_score"] - target_mid)
        if best_fallback is None or dist < best_fallback[0]:
            best_fallback = (dist, amount, feats)

    return best_fallback[1], best_fallback[2]


@router.post("/demo/generate")
def generate_demo_transaction(scenario: str = Query("normal", enum=["normal", "suspicious", "high_risk"])):
    try:
        # Pick a random *seeded* user so the scenario's amount multiplier
        # scales off their real historical average/std from the dataset —
        # a brand-new user has no history yet, which collapses
        # amount_vs_user_avg to a trivial 1.0 and makes every scenario
        # engineer to the same (LOW) risk tier.
        conn = db_repo.get_connection()
        cursor = conn.execute("SELECT user_id FROM user_profiles ORDER BY RANDOM() LIMIT 1")
        row = cursor.fetchone()
        conn.close()

        user_id = row["user_id"] if row else f"CUST_{random.randint(10**7, 10**8 - 1):X}"
        user_profile = db_repo.get_user_profile(user_id)
        avg_amount = (user_profile["avg_amount"] if user_profile else None) or 1500.0
        last_lat = (user_profile["last_latitude"] if user_profile else None) or 6.5244
        last_lon = (user_profile["last_longitude"] if user_profile else None) or 3.3792

        timestamp = datetime.now()

        # Scenario parameters. Beyond scaling the amount off the user's real
        # average (so the amount-based signals the retrained model actually
        # relies on move in the right direction), each scenario also pushes
        # real, live-engineered location/device/beneficiary signals so the
        # rule engine's full signal set (distance anomalies, impossible
        # travel, new-device/beneficiary flags, etc.) fires accurately —
        # not just the amount-based rules.
        if scenario == "normal":
            amount = round(avg_amount * random.uniform(0.3, 1.1), 2)
            if amount <= 0: amount = 100.0
            transaction_type = random.choice(["P2P", "P2M", "Merchant"])
            beneficiary_id = f"acct_{random.randint(100, 999)}@ussd"
            device_id = f"dev_{random.randint(100, 999)}"
            # Location is very close to the user's last known position
            location_latitude = round(last_lat + random.uniform(-0.005, 0.005), 4)
            location_longitude = round(last_lon + random.uniform(-0.005, 0.005), 4)
            payment_method = random.choice(["USSD", "USSD", "USSD", "Net Banking", "Debit Card", "Wallet"])

            engineered_features = FeatureEngineeringService.generate_features(
                user_id=user_id, amount=amount, transaction_type=transaction_type,
                timestamp_iso=timestamp.isoformat(), beneficiary_id=beneficiary_id,
                device_id=device_id, latitude=location_latitude, longitude=location_longitude
            )

        else:
            # Seed a few realistic prior transactions (near the user's real
            # average, spread over the last several hours) so history-driven
            # signals — moving_average_deviation, amount_percentile, daily
            # totals — have real, non-zero values to react to. Without any
            # prior history, a freshly-picked user's "moving average" is
            # always 0, which pins the retrained model to LOW regardless of
            # the current amount.
            for hours_ago in (6, 4, 2):
                hist_amount = round(avg_amount * random.uniform(0.8, 1.2), 2)
                db_repo.save_transaction(
                    txn_id=f"txn_hist_{uuid.uuid4().hex[:8]}",
                    user_id=user_id, amount=hist_amount, txn_type="P2P",
                    timestamp=(timestamp - timedelta(hours=hours_ago)).isoformat(),
                    beneficiary_id="acct_regular@ussd", device_id="dev_regular",
                    latitude=last_lat, longitude=last_lon,
                    is_fraud=0, prob=0.01, score=1, level="LOW", rules=[],
                    payment_method="USSD"
                )

            if scenario == "suspicious":
                target_level = "MEDIUM"
                transaction_type = random.choice(["Bill Payment", "Recharge"])
                # New, unfamiliar beneficiary and device
                beneficiary_id = "acct_suspicious_mule@ussd"
                device_id = "dev_unfamiliar"
                # Location is moderately far (30-80 km)
                location_latitude = round(last_lat + random.uniform(0.3, 0.8), 4)
                location_longitude = round(last_lon + random.uniform(0.3, 0.8), 4)
                payment_method = random.choice(["Debit Card", "Net Banking", "Mobile Transfer", "Wallet"])

            else:  # high_risk
                target_level = "HIGH"
                transaction_type = "P2P"
                beneficiary_id = "acct_flagged_fraud_wallet@ussd"
                device_id = "dev_blacklisted_malware"
                # Location is extremely far (impossible travel: 600+ km away)
                location_latitude = round(last_lat + random.uniform(6.0, 12.0), 4)
                location_longitude = round(last_lon + random.uniform(6.0, 12.0), 4)
                payment_method = random.choice(["Debit Card", "Mobile Transfer", "Wallet", "Net Banking"])

                # Insert a fake recent transaction at the user's last known
                # location just 2 minutes ago, so the jump to the far-away
                # coordinates above trips the impossible-travel velocity check.
                db_repo.save_transaction(
                    txn_id=f"txn_velocity_{uuid.uuid4().hex[:8]}",
                    user_id=user_id, amount=100.0, txn_type="P2P",
                    timestamp=(timestamp - timedelta(minutes=2)).isoformat(),
                    beneficiary_id="acct_legit@ussd", device_id="dev_legit",
                    latitude=last_lat, longitude=last_lon,
                    is_fraud=0, prob=0.01, score=1, level="LOW", rules=[],
                    payment_method="USSD"
                )

            def build_features(candidate_amount, _context=None, _txn_type=transaction_type, _bene=beneficiary_id,
                                _dev=device_id, _lat=location_latitude, _lon=location_longitude,
                                _pm=payment_method):
                feats = FeatureEngineeringService.generate_features(
                    user_id=user_id, amount=candidate_amount, transaction_type=_txn_type,
                    timestamp_iso=timestamp.isoformat(), beneficiary_id=_bene,
                    device_id=_dev, latitude=_lat, longitude=_lon,
                    context=_context
                )
                feats["payment_method"] = _pm
                return feats

            # Fetch the user+beneficiary history once and reuse it for every
            # amount probe below (1 DB query instead of 1 per probe).
            shared_context = db_repo.get_features_context(user_id, beneficiary_id, timestamp.isoformat(), 1440)
            amount, engineered_features = _pick_amount_for_target_level(target_level, avg_amount, build_features, context=shared_context)

        return {
            "user_id": user_id,
            "amount": amount,
            "transaction_type": transaction_type,
            "timestamp": timestamp.isoformat(),
            "beneficiary_id": beneficiary_id,
            "device_id": device_id,
            "location_latitude": location_latitude,
            "location_longitude": location_longitude,
            "payment_method": payment_method,
            # The frontend posts this straight to /predict/features so the
            # analyzed result matches what was just displayed.
            "engineered_features": engineered_features
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

