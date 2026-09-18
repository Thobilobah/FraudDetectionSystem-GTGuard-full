from fastapi import APIRouter, Request, Header, HTTPException, BackgroundTasks
from backend.app.services.razorpay_service import RazorpayService
from backend.app.services.feature_engineering import FeatureEngineeringService
from backend.app.services.prediction_service import prediction_service
from backend.app.repositories.transaction_repository import db_repo
from backend.app.routes.prediction import status_from_risk_level
import json

router = APIRouter()

@router.post("/webhooks/razorpay")
@router.post("/webhooks/gtco")
async def razorpay_webhook(request: Request, x_razorpay_signature: str = Header(None)):
    # 1. Fetch raw request body
    body_bytes = await request.body()
    
    # 2. Verify signature
    if not RazorpayService.verify_webhook_signature(body_bytes, x_razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid signature verification failure.")

    # 3. Parse payload
    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON body")

    event_type = payload.get("event")
    print(f"Received Razorpay Webhook Event: {event_type}")

    # We process capture events
    if event_type == "payment.captured":
        try:
            # Extract payment data
            payment_info = RazorpayService.extract_transaction_info(payload.get("payload", {}))
            
            # Run feature engineering
            features = FeatureEngineeringService.generate_features(
                user_id=payment_info["user_id"],
                amount=payment_info["amount"],
                transaction_type=payment_info["payment_method"],
                timestamp_iso=payment_info["timestamp"],
                beneficiary_id=payment_info["beneficiary_id"],
                device_id=payment_info["device_id"],
                latitude=payment_info["location_latitude"],
                longitude=payment_info["location_longitude"]
            )
            
            # Predict
            pred_res = prediction_service.predict_features(features)
            status = status_from_risk_level(pred_res["risk_level"])

            # Save
            db_repo.save_transaction(
                txn_id=payment_info["transaction_id"],
                user_id=payment_info["user_id"],
                amount=payment_info["amount"],
                txn_type=payment_info["payment_method"],
                timestamp=payment_info["timestamp"],
                beneficiary_id=payment_info["beneficiary_id"],
                device_id=payment_info["device_id"],
                latitude=payment_info["location_latitude"],
                longitude=payment_info["location_longitude"],
                is_fraud=pred_res["prediction"],
                prob=pred_res["fraud_probability"],
                score=pred_res["risk_score"],
                level=pred_res["risk_level"],
                rules=pred_res["triggered_rules"],
                payment_method=payment_info.get("payment_method", "USSD"),
                status=status
            )
            
            print(f"Processed transaction {payment_info['transaction_id']} successfully. Score: {pred_res['risk_score']}.")
            
            return {
                "status": "success",
                "message": "Transaction analyzed and recorded",
                "transaction_id": payment_info["transaction_id"],
                "risk_score": pred_res["risk_score"],
                "risk_level": pred_res["risk_level"],
                "decision_status": status
            }
            
        except Exception as e:
            print(f"Error processing captured payment: {e}")
            raise HTTPException(status_code=500, detail=f"Webhook processing error: {str(e)}")
            
    # For other events, acknowledge receipt
    return {"status": "ignored", "message": f"Event type '{event_type}' not processed"}
