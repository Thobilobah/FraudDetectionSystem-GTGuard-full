import math
from datetime import datetime
from backend.app.repositories.transaction_repository import db_repo

class FeatureEngineeringService:
    @staticmethod
    def haversine_distance(lat1, lon1, lat2, lon2):
        # Haversine formula to calculate distance between two coordinates
        try:
            lat1, lon1, lat2, lon2 = map(float, [lat1, lon1, lat2, lon2])
            # convert to radians
            lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
            
            dlon = lon2 - lon1
            dlat = lat2 - lat1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            r = 6371.0 # earth radius in km
            return c * r
        except Exception:
            return 0.0

    @classmethod
    def generate_features(cls, user_id: str, amount: float, transaction_type: str, 
                          timestamp_iso: str, beneficiary_id: str, device_id: str, 
                          latitude: float, longitude: float) -> dict:
        
        # 1. Parse current transaction details
        try:
            dt = datetime.fromisoformat(timestamp_iso.replace("Z", ""))
        except ValueError:
            dt = datetime.utcnow()
            
        transaction_hour = dt.hour
        day_of_week = dt.strftime("%A")
        
        # 2. Retrieve history profiles
        user_profile = db_repo.get_user_profile(user_id)
        beneficiary_profile = db_repo.get_beneficiary_profile(beneficiary_id)
        device_profile = db_repo.get_device_profile(device_id)
        
        # Default user metrics if new user
        if not user_profile:
            user_avg_amount = amount
            user_std_amount = 100.0  # reasonable fallback
            user_avg_daily_txns = 1.0
            user_avg_hour = float(transaction_hour)
            last_lat = latitude
            last_lon = longitude
            last_txn_time_str = None
        else:
            user_avg_amount = user_profile["avg_amount"] or amount
            user_std_amount = user_profile["std_amount"] or 100.0
            if user_std_amount <= 0:
                user_std_amount = 1.0
            user_avg_daily_txns = user_profile["avg_daily_txns"] or 1.0
            user_avg_hour = user_profile["avg_hour"] or float(transaction_hour)
            last_lat = user_profile["last_latitude"]
            last_lon = user_profile["last_longitude"]
            last_txn_time_str = user_profile["last_txn_time"]

        # Default beneficiary metrics
        is_new_beneficiary = 1
        beneficiary_age_days = 0
        beneficiary_risk_score = 10.0 # Default low risk for new
        if beneficiary_profile:
            is_new_beneficiary = 0 if beneficiary_profile["total_txns"] > 0 else 1
            beneficiary_age_days = beneficiary_profile["age_days"] or 1
            beneficiary_risk_score = beneficiary_profile["risk_score"] or 10.0

        # Default device metrics
        is_new_device = 1
        device_account_count = 1
        device_fraud_history = 0
        device_change_recent = 0
        
        if device_profile:
            # Check if this user has used this device before
            # For hackathon logic: if device profile exists, but was last used long ago or linked to multiple accounts
            is_new_device = 0
            device_account_count = device_profile["account_count"] or 1
            device_fraud_history = device_profile["fraud_history"] or 0
            
            # device_change_recent: did user use a different device in their last txn?
            if last_txn_time_str:
                # We can check transactions table for the user's last transaction
                recent_txns = db_repo.get_recent_transactions(user_id, timestamp_iso, 1440) # 24h
                if recent_txns:
                    last_device = recent_txns[0]["device_id"]
                    if last_device != device_id:
                        device_change_recent = 1

        # Default location metrics
        # Risk score simulation
        location_risk_score = 15.0 # baseline
        distance_from_last_txn_km = 0.0
        is_new_location = 0
        impossible_travel_flag = 0
        
        if last_lat is not None and last_lon is not None:
            distance_from_last_txn_km = cls.haversine_distance(latitude, longitude, last_lat, last_lon)
            if distance_from_last_txn_km > 20.0:
                is_new_location = 1
                
            # Impossible travel check
            if last_txn_time_str:
                try:
                    last_dt = datetime.fromisoformat(last_txn_time_str.replace("Z", ""))
                    time_diff = (dt - last_dt).total_seconds()
                    # Speed check (km/hour)
                    if time_diff > 0:
                        speed = (distance_from_last_txn_km / (time_diff / 3600.0))
                        if speed > 800.0 and distance_from_last_txn_km > 10.0:
                            impossible_travel_flag = 1
                    elif distance_from_last_txn_km > 10.0:
                        # Simultaneous txns at distance > 10km
                        impossible_travel_flag = 1
                except Exception:
                    pass

        # 3. Calculate Velocity Features from recent transactions
        # Query past transactions for this user within windows
        txns_1h = db_repo.get_recent_transactions(user_id, timestamp_iso, 60) # 1 hour
        txns_5m = [t for t in txns_1h if (dt - datetime.fromisoformat(t["timestamp"].replace("Z", ""))).total_seconds() <= 300]
        txns_1m = [t for t in txns_5m if (dt - datetime.fromisoformat(t["timestamp"].replace("Z", ""))).total_seconds() <= 60]
        
        transactions_last_1_min = len(txns_1m) + 1  # include current
        transactions_last_5_min = len(txns_5m) + 1
        transactions_last_1_hour = len(txns_1h) + 1
        
        amount_last_5_min = sum([t["amount"] for t in txns_5m]) + amount
        amount_last_1_hour = sum([t["amount"] for t in txns_1h]) + amount
        
        unique_beneficiaries_1h = len(set([t["beneficiary_id"] for t in txns_1h] + [beneficiary_id]))
        beneficiaries_last_1_hour = unique_beneficiaries_1h

        # Query past transactions to this beneficiary in 24 hours
        bene_txns_24h = db_repo.get_recent_beneficiary_transactions(beneficiary_id, timestamp_iso, 1440)
        beneficiary_transaction_count_24h = len(bene_txns_24h) + 1
        
        unique_senders_24h = len(set([t["user_id"] for t in bene_txns_24h] + [user_id]))
        beneficiary_unique_senders_24h = unique_senders_24h

        # 4. User-centric daily statistics
        # Retrieve all user's transactions today (matching calendar date of current transaction)
        current_date_str = dt.strftime("%Y-%m-%d")
        all_user_txns = db_repo.get_recent_transactions(user_id, timestamp_iso, 1440) # fetch last 24h as proxy for today
        
        daily_txns_today = [t for t in all_user_txns if t["timestamp"].startswith(current_date_str)]
        daily_transaction_count = len(daily_txns_today) + 1
        daily_transaction_amount = sum([t["amount"] for t in daily_txns_today]) + amount
        
        # Identical amounts in last 24 hours
        identical_amount_count_24h = len([t for t in all_user_txns if abs(t["amount"] - amount) < 0.01]) + 1
        
        # 5. Statistical Calculations
        amount_vs_user_avg = amount / user_avg_amount if user_avg_amount > 0 else 1.0
        amount_z_score = (amount - user_avg_amount) / user_std_amount
        
        # Percentile calculation
        all_user_amounts = [t["amount"] for t in all_user_txns]
        if not all_user_amounts:
            amount_percentile = 0.5 # default average
        else:
            smaller_count = sum([1 for a in all_user_amounts if a < amount])
            amount_percentile = smaller_count / len(all_user_amounts)
            
        # Moving average deviation
        # Dev of amount from moving average of last 5 transactions
        last_5_txns = all_user_txns[:5]
        if not last_5_txns:
            moving_average_deviation = 0.0
        else:
            m_avg = sum([t["amount"] for t in last_5_txns]) / len(last_5_txns)
            moving_average_deviation = (amount - m_avg) / m_avg if m_avg > 0 else 0.0
            
        # Behavior deviation score
        # Let's formulate a score from 0 to 100 based on hours/amount/velocity deviations
        hour_diff = abs(transaction_hour - user_avg_hour)
        # Normalize hour diff (max difference is 12 hours)
        hour_deviation = min(hour_diff / 12.0, 1.0)
        
        # Amount deviation (cap z-score at 3)
        amount_deviation = min(abs(amount_z_score) / 3.0, 1.0)
        
        # Location deviation
        loc_deviation = 1.0 if is_new_location == 1 else 0.0
        
        behavior_deviation_score = (hour_deviation * 0.25 + amount_deviation * 0.45 + loc_deviation * 0.3) * 100.0

        # Combine all features into the exact 35 required features
        features = {
            "transaction_amount": float(amount),
            "transaction_type": str(transaction_type),
            "transaction_hour": int(transaction_hour),
            "day_of_week": str(day_of_week),
            "amount_vs_user_avg": float(amount_vs_user_avg),
            "daily_transaction_count": int(daily_transaction_count),
            "daily_transaction_amount": float(daily_transaction_amount),
            "identical_amount_count_24h": int(identical_amount_count_24h),
            
            "user_avg_transaction_amount": float(user_avg_amount),
            "user_transaction_std": float(user_std_amount),
            "user_avg_daily_transactions": float(user_avg_daily_txns),
            "user_avg_transaction_hour": float(user_avg_hour),
            "behavior_deviation_score": float(behavior_deviation_score),
            
            "is_new_beneficiary": int(is_new_beneficiary),
            "beneficiary_age_days": int(beneficiary_age_days),
            "beneficiary_transaction_count_24h": int(beneficiary_transaction_count_24h),
            "beneficiary_unique_senders_24h": int(beneficiary_unique_senders_24h),
            "beneficiary_risk_score": float(beneficiary_risk_score),
            
            "is_new_device": int(is_new_device),
            "device_account_count": int(device_account_count),
            "device_fraud_history": int(device_fraud_history),
            "device_change_recent": int(device_change_recent),
            
            "location_risk_score": float(location_risk_score),
            "distance_from_last_txn_km": float(distance_from_last_txn_km),
            "is_new_location": int(is_new_location),
            "impossible_travel_flag": int(impossible_travel_flag),
            
            "transactions_last_1_min": int(transactions_last_1_min),
            "transactions_last_5_min": int(transactions_last_5_min),
            "transactions_last_1_hour": int(transactions_last_1_hour),
            "amount_last_5_min": float(amount_last_5_min),
            "amount_last_1_hour": float(amount_last_1_hour),
            "beneficiaries_last_1_hour": int(beneficiaries_last_1_hour),
            
            "amount_z_score": float(amount_z_score),
            "amount_percentile": float(amount_percentile),
            "moving_average_deviation": float(moving_average_deviation)
        }
        
        return features
