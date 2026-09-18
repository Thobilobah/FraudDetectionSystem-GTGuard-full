class RuleEngine:
    @staticmethod
    def evaluate_rules(features: dict) -> list[dict]:
        triggered = []
        
        # Rule 1: HIGH_AMOUNT
        amount = features.get("transaction_amount", 0)
        user_avg = features.get("user_avg_transaction_amount", 0)
        if user_avg > 0 and amount > user_avg * 3:
            triggered.append({
                "rule_id": "HIGH_AMOUNT",
                "rule_name": "High Transaction Amount",
                "severity": "WARNING",
                "message": f"Transaction amount of ₹{amount:,.2f} is more than 3x the user's average (₹{user_avg:,.2f})."
            })
        elif amount > 50000:
            triggered.append({
                "rule_id": "HIGH_AMOUNT",
                "rule_name": "High Transaction Amount",
                "severity": "WARNING",
                "message": f"Transaction amount of ₹{amount:,.2f} exceeds standard limits."
            })
            
        # Rule 2: NEW_BENEFICIARY
        if features.get("is_new_beneficiary", 0) == 1:
            triggered.append({
                "rule_id": "NEW_BENEFICIARY",
                "rule_name": "New Beneficiary",
                "severity": "INFO",
                "message": "This is the first time transacting with this beneficiary."
            })
            
        # Rule 3: NEW_DEVICE
        if features.get("is_new_device", 0) == 1:
            triggered.append({
                "rule_id": "NEW_DEVICE",
                "rule_name": "New Device Fingerprint",
                "severity": "WARNING",
                "message": "Transaction initiated from a device that has never been linked to this account before."
            })
            
        # Rule 4: DEVICE_FRAUD_HISTORY
        dev_fraud = features.get("device_fraud_history", 0)
        if dev_fraud > 0:
            triggered.append({
                "rule_id": "DEVICE_FRAUD_HISTORY",
                "rule_name": "Device Fraud History Detect",
                "severity": "CRITICAL",
                "message": f"This device has been flagged in {dev_fraud} previous fraudulent transaction(s)."
            })
            
        # Rule 5: HIGH_VELOCITY
        tx_5m = features.get("transactions_last_5_min", 0)
        if tx_5m > 3:
            triggered.append({
                "rule_id": "HIGH_VELOCITY",
                "rule_name": "High Transaction Velocity",
                "severity": "CRITICAL",
                "message": f"High frequency of transactions detected ({tx_5m} in last 5 minutes)."
            })
            
        # Rule 6: HIGH_BENEFICIARY_RISK
        bene_risk = features.get("beneficiary_risk_score", 0)
        if bene_risk > 50:
            triggered.append({
                "rule_id": "HIGH_BENEFICIARY_RISK",
                "rule_name": "Suspicious Beneficiary Account",
                "severity": "WARNING",
                "message": f"Beneficiary UPI profile carries a high risk flag (score: {bene_risk:.1f}/100)."
            })
            
        # Rule 7: HIGH_LOCATION_RISK
        loc_risk = features.get("location_risk_score", 0)
        if loc_risk > 50:
            triggered.append({
                "rule_id": "HIGH_LOCATION_RISK",
                "rule_name": "High Risk Location",
                "severity": "WARNING",
                "message": f"Transaction origin IP / Geolocation belongs to a high-risk sector (risk: {loc_risk:.1f}/100)."
            })
            
        # Rule 8: LOCATION_DISTANCE_ANOMALY
        dist = features.get("distance_from_last_txn_km", 0)
        if dist > 100:
            triggered.append({
                "rule_id": "LOCATION_DISTANCE_ANOMALY",
                "rule_name": "Location Distance Anomaly",
                "severity": "WARNING",
                "message": f"Transaction initiated {dist:.1f} km away from user's last recorded active location."
            })
            
        # Rule 9: IMPOSSIBLE_TRAVEL
        if features.get("impossible_travel_flag", 0) == 1:
            triggered.append({
                "rule_id": "IMPOSSIBLE_TRAVEL",
                "rule_name": "Impossible Travel Velocity",
                "severity": "CRITICAL",
                "message": "Physical impossibility of travel: distance between subsequent transactions implies travel speed > 800 km/h."
            })
            
        # Rule 10: STATISTICAL_AMOUNT_ANOMALY
        z_score = features.get("amount_z_score", 0)
        if z_score > 3.0:
            triggered.append({
                "rule_id": "STATISTICAL_AMOUNT_ANOMALY",
                "rule_name": "Statistical Amount Anomaly",
                "severity": "WARNING",
                "message": f"Transaction amount is {z_score:.2f} standard deviations above the user's historical mean."
            })
            
        # Rule 11: HIGH_AMOUNT_PERCENTILE
        pct = features.get("amount_percentile", 0)
        if pct > 95.0 or pct > 0.95:  # Handle scale representation
            val = pct * 100 if pct <= 1.0 else pct
            triggered.append({
                "rule_id": "HIGH_AMOUNT_PERCENTILE",
                "rule_name": "High Amount Percentile",
                "severity": "WARNING",
                "message": f"Transaction amount is in the top {100 - val:.1f}% of all historical payments for this account."
            })
            
        # Rule 12: BEHAVIORAL_ANOMALY
        dev_score = features.get("behavior_deviation_score", 0)
        if dev_score > 50:
            triggered.append({
                "rule_id": "BEHAVIORAL_ANOMALY",
                "rule_name": "Behavioral Deviation Anomaly",
                "severity": "WARNING",
                "message": f"Behavioral score deviates significantly from historical baseline (score: {dev_score:.1f}/100)."
            })
            
        # Rule 13: MULTIPLE_BENEFICIARIES
        bene_1h = features.get("beneficiaries_last_1_hour", 0)
        if bene_1h > 3:
            triggered.append({
                "rule_id": "MULTIPLE_BENEFICIARIES",
                "rule_name": "Multiple Beneficiaries Spike",
                "severity": "WARNING",
                "message": f"Payments sent to {bene_1h} unique beneficiary accounts within the last hour."
            })
            
        # Rule 14: REPEATED_AMOUNT_PATTERN
        id_amt_24h = features.get("identical_amount_count_24h", 0)
        if id_amt_24h > 3:
            triggered.append({
                "rule_id": "REPEATED_AMOUNT_PATTERN",
                "rule_name": "Repeated Amount Pattern",
                "severity": "WARNING",
                "message": f"Detected {id_amt_24h} transactions of identical amount within a 24-hour window."
            })
            
        # Rule 15: CREDIT_CARD_LIMIT_ANOMALY
        pay_method = features.get("payment_method", "UPI")
        if pay_method == "Credit Card" and amount > 40000:
            triggered.append({
                "rule_id": "CREDIT_CARD_LIMIT_ANOMALY",
                "rule_name": "Credit Card Single-Tap Limit Anomaly",
                "severity": "WARNING",
                "message": f"Credit Card single transaction of ₹{amount:,.2f} exceeds typical single-tap security limits."
            })
            
        # Rule 16: NET_BANKING_ANOMALY
        txn_hour = features.get("transaction_hour", 12)
        if pay_method == "Net Banking" and amount > 25000 and (txn_hour < 5 or txn_hour >= 23):
            triggered.append({
                "rule_id": "NET_BANKING_ANOMALY",
                "rule_name": "Late Night Net Banking Transfer",
                "severity": "WARNING",
                "message": f"High value Net Banking transfer of ₹{amount:,.2f} initiated during odd quiet hours ({txn_hour:02d}:00)."
            })
            
        # Rule 17: WALLET_VELOCITY_ANOMALY
        tx_last_5m = features.get("transactions_last_5_min", 0)
        if pay_method == "Wallet" and tx_last_5m > 2:
            triggered.append({
                "rule_id": "WALLET_VELOCITY_ANOMALY",
                "rule_name": "Digital Wallet Velocity Spike",
                "severity": "CRITICAL",
                "message": f"Digital Wallet velocity exceeds frequency limits with {tx_last_5m} payments in the last 5 minutes."
            })
            
        return triggered
