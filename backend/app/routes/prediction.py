import random
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query, Request
from backend.app.schemas.transaction import TransactionCreate, TransactionResponse
from backend.app.schemas.prediction import FeatureVector, PredictionResponse
from backend.app.services.feature_engineering import FeatureEngineeringService
from backend.app.services.prediction_service import prediction_service
from backend.app.repositories.transaction_repository import db_repo, WINDOW_LIMIT
from backend.app.services.rate_limiter import check_rate_limit
from backend.app.services.nigeria_places import (
    clamp_to_nigeria, far_nigerian_city, is_in_nigeria,
)

# Manual-test rows (POST /predict/features without coordinates) used to fall
# back to 22.5942/85.9754 - a point in India. Default to central Abuja so
# every stored row is a Nigerian coordinate pair.
DEFAULT_NG_LAT, DEFAULT_NG_LON = 9.0579, 7.4951

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
            latitude=features.location_latitude if features.location_latitude is not None else DEFAULT_NG_LAT,
            longitude=features.location_longitude if features.location_longitude is not None else DEFAULT_NG_LON,
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

def _pick_amount_for_target_level(target_level: str, avg_amount: float, build_features,
                                  context=None, ratios=None) -> tuple[float, dict, bool, float]:
    """Probe a focused grid of amount-vs-average ratios through the live model
    pipeline and return (amount, engineered_features, exact_match, distance).

    exact_match is True only when a probe actually classifies into
    target_level; distance then reports how far the best fallback candidate's
    score sits from the target band's midpoint, so the caller can retry the
    scenario with a different user instead of accepting a mismatched tier.

    The retrained model's decision surface (fit on the Nigerian dataset) is
    not a smooth "bigger amount = riskier" curve — MEDIUM/HIGH fraud rows in
    that data cluster in a narrow amount_vs_user_avg band (empirically
    ~3x-6x average), and scores can drop back to LOW well past that band.
    So rather than guessing a fixed multiplier per scenario, we probe real
    amounts through the real pipeline and use whichever one the model
    actually agrees with. The ladder is ordered to cover the risky band
    densely first (3x-6x), then the tails, and STOPS at the first exact hit.
    Each probe is cheap because the feature context is fetched once by the
    caller and shared across every probe (no per-probe DB round-trips)."""
    RATIO_LADDER = ratios or [
        3.0, 4.0, 5.0, 6.0, 3.5, 4.5, 5.5, 6.5, 2.5, 7.0, 7.5, 8.0, 8.5, 9.0, 10.0
    ]

    best_fallback = None  # (distance_to_target_band, amount, features)
    target_mid = {"MEDIUM": 55, "HIGH": 90}.get(target_level, 20)

    for ratio in RATIO_LADDER:
        amount = round(avg_amount * ratio, 2)
        feats = build_features(amount, context)
        res = prediction_service.predict_features(feats)
        if res["risk_level"] == target_level:
            return amount, feats, True, 0.0
        dist = abs(res["risk_score"] - target_mid)
        if best_fallback is None or dist < best_fallback[0]:
            best_fallback = (dist, amount, feats)

    return best_fallback[1], best_fallback[2], False, best_fallback[0]


def _synthetic_context_row(user_id: str, amount: float, timestamp_iso: str,
                           beneficiary_id: str, device_id: str,
                           latitude: float, longitude: float) -> dict:
    """Shape a transactions-table row WITHOUT writing it. The suspicious /
    high-risk scenarios need a few hours of plausible recent history so
    history-driven features (moving average, velocity counts, percentiles)
    have real, non-zero values to react to — but earlier versions persisted
    these txn_hist_* / txn_velocity_* rows into the ledger, where they showed
    up as phantom transactions the user never simulated (and each save also
    nudged the user's live profile). The row now exists only in memory and is
    merged into the shared feature context below."""
    return {
        "transaction_id": f"txn_ctx_{uuid.uuid4().hex[:8]}",
        "user_id": user_id,
        "amount": amount,
        "transaction_type": "P2P",
        "timestamp": timestamp_iso,
        "beneficiary_id": beneficiary_id,
        "device_id": device_id,
        "location_latitude": latitude,
        "location_longitude": longitude,
        "is_fraud": 0,
        "fraud_probability": 0.01,
        "risk_score": 1,
        "risk_level": "LOW",
        "triggered_rules": "[]",
        "created_at": timestamp_iso,
        "payment_method": "USSD",
        "status": "APPROVED",
        "resolved_by": None,
        "resolved_at": None,
        "claimed_by": None,
        "claimed_at": None,
    }


def _pick_demo_user(excluded: set) -> str | None:
    """One random seeded user not already tried during this generate call, so
    a scenario retry lands on a fresh profile (different avg/std/history)
    that may reach the target risk tier. None once every candidate is used."""
    conn = db_repo.get_connection()
    try:
        if excluded:
            placeholders = ",".join("?" for _ in excluded)
            cursor = conn.execute(
                f"SELECT user_id FROM user_profiles "
                f"WHERE user_id NOT IN ({placeholders}) "
                f"ORDER BY RANDOM() LIMIT 1",
                tuple(excluded),
            )
        else:
            cursor = conn.execute(
                "SELECT user_id FROM user_profiles ORDER BY RANDOM() LIMIT 1"
            )
        row = cursor.fetchone()
        return row["user_id"] if row else None
    finally:
        conn.close()


def _build_demo_attempt(scenario: str, target_level: str, user_id: str) -> dict:
    """Build one candidate demo transaction for the given user and probe the
    live model until it agrees with the scenario's risk tier. Returns the
    scenario fields plus matched/distance so generate_demo_transaction can
    retry with another user on a miss."""
    user_profile = db_repo.get_user_profile(user_id)
    avg_amount = (user_profile["avg_amount"] if user_profile else None) or 1500.0
    last_lat = (user_profile["last_latitude"] if user_profile else None) or 6.5244
    last_lon = (user_profile["last_longitude"] if user_profile else None) or 3.3792
    # Profiles seeded before the Nigerian-coordinates fix still carry Indian
    # city coords - snap any out-of-country profile onto central Lagos so
    # every scenario derives a Nigerian location regardless of DB vintage.
    if not is_in_nigeria(last_lat, last_lon):
        last_lat, last_lon = 6.5244, 3.3792

    timestamp = datetime.now()
    synthetic_rows: list[dict] = []
    ratios = None  # default risky ladder for suspicious / high_risk

    # Scenario parameters. Beyond scaling the amount off the user's real
    # average (so the amount-based signals the retrained model actually
    # relies on move in the right direction), each scenario also pushes
    # real, live-engineered location/device/beneficiary signals so the
    # rule engine's full signal set (distance anomalies, new-device/
    # beneficiary flags, etc.) fires accurately — not just the amount rules.
    if scenario == "normal":
        amount = round(avg_amount * random.uniform(0.3, 1.1), 2)
        if amount <= 0: amount = 100.0
        transaction_type = random.choice(["P2P", "P2M", "Merchant"])
        beneficiary_id = f"acct_{random.randint(100, 999)}@ussd"
        device_id = f"dev_{random.randint(100, 999)}"
        # Location is a few metres around the user's (Nigerian) home position
        location_latitude, location_longitude = clamp_to_nigeria(
            round(last_lat + random.uniform(-0.005, 0.005), 4),
            round(last_lon + random.uniform(-0.005, 0.005), 4),
        )
        payment_method = random.choice(["USSD", "USSD", "USSD", "Net Banking", "Debit Card", "Wallet"])
        # Try the randomized amount first so amounts stay varied; only if the
        # model disagrees with the scenario's LOW tier does the ladder below
        # sweep nearby small ratios until it does.
        ratios = [amount / avg_amount if avg_amount > 0 else 1.0,
                  0.9, 0.7, 1.1, 0.5, 1.0, 0.6, 0.8, 1.2, 0.4, 1.5, 0.3]
    else:
        # Seed a few realistic prior transactions (near the user's real
        # average, spread over the last several hours) so history-driven
        # signals — moving_average_deviation, amount_percentile, daily
        # totals — have real, non-zero values to react to. Without prior
        # history, a freshly-picked user's "moving average" is always 0,
        # which pins the retrained model to LOW regardless of the current
        # amount. Built in memory only - never written to the ledger.
        for hours_ago in (6, 4, 2):
            synthetic_rows.append(_synthetic_context_row(
                user_id=user_id,
                amount=round(avg_amount * random.uniform(0.8, 1.2), 2),
                timestamp_iso=(timestamp - timedelta(hours=hours_ago)).isoformat(),
                beneficiary_id="acct_regular@ussd", device_id="dev_regular",
                latitude=last_lat, longitude=last_lon,
            ))

        if scenario == "suspicious":
            transaction_type = random.choice(["Bill Payment", "Recharge"])
            # New, unfamiliar beneficiary and device
            beneficiary_id = "acct_suspicious_mule@ussd"
            device_id = "dev_unfamiliar"
            # Location is moderately far (30-80 km) but clamped inside
            # Nigeria - the raw +0.3/+0.8 degree offset could push a border
            # profile (e.g. northern Borno) into Cameroon/Niger.
            location_latitude, location_longitude = clamp_to_nigeria(
                round(last_lat + random.uniform(0.3, 0.8), 4),
                round(last_lon + random.uniform(0.3, 0.8), 4),
            )
            payment_method = random.choice(["Debit Card", "Net Banking", "Mobile Transfer", "Wallet"])

        else:  # high_risk
            transaction_type = "P2P"
            beneficiary_id = "acct_flagged_fraud_wallet@ussd"
            device_id = "dev_blacklisted_malware"
            # Impossible-travel jump: a far NIGERIAN city 500+ km away
            # (the old +6/+12 degree offset landed in Niger/Algeria). Still
            # far enough to plausibly trip the >800km/h velocity check
            # against the 2-minutes-ago context row below.
            location_latitude, location_longitude = far_nigerian_city(last_lat, last_lon)
            payment_method = random.choice(["Debit Card", "Mobile Transfer", "Wallet", "Net Banking"])
            # A transaction at the user's last known location 2 minutes ago,
            # so the jump to the far-away coordinates above trips the
            # impossible-travel velocity check (in-memory - it used to be a
            # persisted txn_velocity_* row).
            synthetic_rows.append(_synthetic_context_row(
                user_id=user_id, amount=100.0,
                timestamp_iso=(timestamp - timedelta(minutes=2)).isoformat(),
                beneficiary_id="acct_legit@ussd", device_id="dev_legit",
                latitude=last_lat, longitude=last_lon,
            ))

    # The travel story above lives in the synthetic rows, not in the user's
    # profile (which the old code used to rewrite on every generate just to
    # surface this flag). Pin it per scenario so high_risk always carries the
    # impossible-travel signal its 600km-in-2-minutes history implies, while
    # the other tiers never pick up a stale/spurious one.
    forced_impossible_travel = 1 if scenario == "high_risk" else 0

    def build_features(candidate_amount, _context=None, _txn_type=transaction_type,
                        _bene=beneficiary_id, _dev=device_id,
                        _lat=location_latitude, _lon=location_longitude,
                        _pm=payment_method):
        feats = FeatureEngineeringService.generate_features(
            user_id=user_id, amount=candidate_amount, transaction_type=_txn_type,
            timestamp_iso=timestamp.isoformat(), beneficiary_id=_bene,
            device_id=_dev, latitude=_lat, longitude=_lon, context=_context
        )
        feats["payment_method"] = _pm
        feats["impossible_travel_flag"] = forced_impossible_travel
        return feats

    # Fetch the user+beneficiary history once, merge the synthetic rows
    # exactly where the old persisted ones would have landed (newest-first,
    # window-capped), and reuse that shared context for every amount probe
    # below (1 DB query instead of 1 per probe).
    user_rows, bene_rows = db_repo.get_features_context(
        user_id, beneficiary_id, timestamp.isoformat(), 1440)
    if synthetic_rows:
        user_rows = sorted(
            user_rows + [r for r in synthetic_rows if r["user_id"] == user_id],
            key=lambda r: r["timestamp"], reverse=True)[:WINDOW_LIMIT]
        bene_rows = sorted(
            bene_rows + [r for r in synthetic_rows if r["beneficiary_id"] == beneficiary_id],
            key=lambda r: r["timestamp"], reverse=True)[:WINDOW_LIMIT]
    shared_context = (user_rows, bene_rows)

    amount, engineered_features, matched, distance = _pick_amount_for_target_level(
        target_level, avg_amount, build_features, context=shared_context, ratios=ratios)

    return {
        "user_id": user_id,
        "amount": amount,
        "transaction_type": transaction_type,
        "timestamp": timestamp,
        "beneficiary_id": beneficiary_id,
        "device_id": device_id,
        "location_latitude": location_latitude,
        "location_longitude": location_longitude,
        "payment_method": payment_method,
        "engineered_features": engineered_features,
        "matched": matched,
        "distance": distance,
    }


@router.post("/demo/generate")
def generate_demo_transaction(scenario: str = Query("normal", enum=["normal", "suspicious", "high_risk"])):
    try:
        # Each scenario button promises a specific risk tier, but the model's
        # decision surface is not a smooth "bigger amount = riskier" curve -
        # some seeded users simply can't reach HIGH (or MEDIUM) at any
        # amount, and a single missed ladder probe used to silently fall back
        # to a mismatched tier. Probe up to 8 different seeded users until
        # the live model actually agrees with the clicked scenario (first
        # exact hit wins; the closest miss is kept as worst-case fallback).
        target_level = {"normal": "LOW", "suspicious": "MEDIUM", "high_risk": "HIGH"}[scenario]
        tried_users: set = set()
        best = None
        for _ in range(8):
            user_id = _pick_demo_user(tried_users)
            if user_id is None:
                if tried_users:
                    break
                # Fresh database with no seeded profiles: one fallback identity.
                user_id = f"CUST_{random.randint(10**7, 10**8 - 1):X}"
            tried_users.add(user_id)
            attempt = _build_demo_attempt(scenario, target_level, user_id)
            if best is None or attempt["distance"] < best["distance"]:
                best = attempt
            if attempt["matched"]:
                break

        if best is None:
            raise HTTPException(status_code=500, detail="Could not build a demo transaction.")

        return {
            "user_id": best["user_id"],
            "amount": best["amount"],
            "transaction_type": best["transaction_type"],
            "timestamp": best["timestamp"].isoformat(),
            "beneficiary_id": best["beneficiary_id"],
            "device_id": best["device_id"],
            "location_latitude": best["location_latitude"],
            "location_longitude": best["location_longitude"],
            "payment_method": best["payment_method"],
            # The frontend posts this straight to /predict/features so the
            # analyzed result matches what was just displayed.
            "engineered_features": best["engineered_features"]
        }
    except HTTPException:
        raise
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

