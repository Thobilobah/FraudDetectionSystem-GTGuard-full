import hmac
import hashlib
from datetime import datetime
from backend.app.config import settings

class RazorpayService:
    @staticmethod
    def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
        """
        Verify the signature of the Razorpay webhook payload using HMAC SHA256.
        """
        secret = settings.RAZORPAY_WEBHOOK_SECRET
        if not secret:
            print("[Warning] RAZORPAY_WEBHOOK_SECRET not set. Skipping signature validation.")
            return True
            
        if not signature:
            return False
            
        try:
            expected_signature = hmac.new(
                secret.encode("utf-8"),
                raw_body,
                hashlib.sha256
            ).hexdigest()
            return hmac.compare_digest(expected_signature, signature)
        except Exception as e:
            print(f"Error validating signature: {e}")
            return False

    @staticmethod
    def extract_transaction_info(payload: dict) -> dict:
        """
        Extract normalized raw transaction details from the Razorpay payment.captured event payload.
        """
        # Razorpay payload structure: payload.payment.entity
        payment_data = payload.get("payment", {}).get("entity", {})
        if not payment_data:
            payment_data = payload  # fallback in case payload directly passed

        # Extract payment basics
        txn_id = payment_data.get("id", f"rp_txn_{int(datetime.utcnow().timestamp())}")
        raw_amount = payment_data.get("amount", 0)
        # Razorpay amounts are in paise (e.g. 50000 paise = 500 INR)
        amount_inr = float(raw_amount) / 100.0 if raw_amount else 0.0
        
        currency = payment_data.get("currency", "INR")
        payment_method = payment_data.get("method", "upi")
        payment_status = payment_data.get("status", "captured")
        
        created_at_ts = payment_data.get("created_at")
        if created_at_ts:
            dt = datetime.utcfromtimestamp(created_at_ts)
            timestamp_iso = dt.isoformat()
        else:
            timestamp_iso = datetime.utcnow().isoformat()

        # Extract meta-parameters from transaction notes (passed from frontend integration)
        notes = payment_data.get("notes", {})
        if not isinstance(notes, dict):
            notes = {}
        user_id = notes.get("user_id", "U10001") # fallback default
        beneficiary_id = notes.get("beneficiary_id", payment_data.get("vpa", "vpa_default@upi"))
        device_id = notes.get("device_id", "dev_default")
        
        # Geolocation extraction from notes
        try:
            latitude = float(notes.get("latitude", 12.9716))
            longitude = float(notes.get("longitude", 77.5946))
        except (ValueError, TypeError):
            latitude = 12.9716
            longitude = 77.5946

        return {
            "transaction_id": txn_id,
            "user_id": user_id,
            "amount": amount_inr,
            "currency": currency,
            "payment_method": payment_method,
            "timestamp": timestamp_iso,
            "beneficiary_id": beneficiary_id,
            "device_id": device_id,
            "location_latitude": latitude,
            "location_longitude": longitude,
            "payment_status": payment_status
        }
