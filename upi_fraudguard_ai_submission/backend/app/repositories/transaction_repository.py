import sqlite3
import os
import json
from datetime import datetime
import pandas as pd
from backend.app.config import settings

class TransactionRepository:
    def __init__(self, db_path: str = None):
        if db_path is None:
            # Resolve db path relative to workspace or config
            db_path = settings.DATABASE_URL.replace("sqlite:///", "")
            
        self.db_path = os.path.abspath(db_path)
        # Ensure parent directories exist
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.init_db()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        with self.get_connection() as conn:
            # 1. Transactions Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transactions (
                    transaction_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    amount REAL,
                    transaction_type TEXT,
                    timestamp TEXT,
                    beneficiary_id TEXT,
                    device_id TEXT,
                    location_latitude REAL,
                    location_longitude REAL,
                    is_fraud INTEGER,
                    fraud_probability REAL,
                    risk_score INTEGER,
                    risk_level TEXT,
                    triggered_rules TEXT,
                    created_at TEXT,
                    payment_method TEXT DEFAULT 'UPI'
                )
            """)
            
            # Migration check: Add payment_method column if missing
            try:
                conn.execute("ALTER TABLE transactions ADD COLUMN payment_method TEXT DEFAULT 'UPI'")
            except sqlite3.OperationalError:
                pass
            
            # 2. User Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_profiles (
                    user_id TEXT PRIMARY KEY,
                    avg_amount REAL,
                    std_amount REAL,
                    avg_daily_txns REAL,
                    avg_hour REAL,
                    last_latitude REAL,
                    last_longitude REAL,
                    last_txn_time TEXT
                )
            """)
            
            # 3. Beneficiary Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS beneficiary_profiles (
                    beneficiary_id TEXT PRIMARY KEY,
                    age_days INTEGER,
                    risk_score REAL,
                    total_txns INTEGER,
                    unique_senders INTEGER
                )
            """)
            
            # 4. Device Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS device_profiles (
                    device_id TEXT PRIMARY KEY,
                    account_count INTEGER,
                    fraud_history INTEGER,
                    last_used_time TEXT
                )
            """)
            
            # 5. Location Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS location_profiles (
                    location_id TEXT PRIMARY KEY,
                    risk_score REAL
                )
            """)
            
            conn.commit()
            
        # Seed profiles from CSV if database is empty
        self.seed_from_csv()

    def seed_from_csv(self):
        # Check if user_profiles is empty
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) as count FROM user_profiles")
            row = cursor.fetchone()
            if row["count"] > 0:
                print("Database already seeded.")
                return
                
        # Find CSV path
        csv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "dataset.csv"))
        if not os.path.exists(csv_path):
            print(f"Dataset CSV not found at {csv_path}. Skipping database seeding.")
            return
            
        print(f"Seeding database profiles from {csv_path}...")
        try:
            df = pd.read_csv(csv_path)
            
            with self.get_connection() as conn:
                for idx, row in df.iterrows():
                    user_id = str(row["user_id"])
                    
                    # 1. Seed User Profiles
                    conn.execute("""
                        INSERT OR REPLACE INTO user_profiles 
                        (user_id, avg_amount, std_amount, avg_daily_txns, avg_hour, last_latitude, last_longitude, last_txn_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        user_id,
                        float(row["user_avg_transaction_amount"]),
                        float(row["user_transaction_std"]),
                        float(row["user_avg_daily_transactions"]),
                        float(row["user_avg_transaction_hour"]),
                        12.9716 + (idx % 100) * 0.001,  # Simulated last lat
                        77.5946 + (idx % 100) * 0.001,  # Simulated last lon
                        datetime.utcnow().isoformat()
                    ))
                    
                    # 2. Seed Beneficiary Profiles
                    beneficiary_id = f"vpa_{idx}@upi"
                    conn.execute("""
                        INSERT OR REPLACE INTO beneficiary_profiles
                        (beneficiary_id, age_days, risk_score, total_txns, unique_senders)
                        VALUES (?, ?, ?, ?, ?)
                    """, (
                        beneficiary_id,
                        int(row["beneficiary_age_days"]),
                        float(row["beneficiary_risk_score"]),
                        int(row["beneficiary_transaction_count_24h"]),
                        int(row["beneficiary_unique_senders_24h"])
                    ))
                    
                    # 3. Seed Device Profiles
                    device_id = f"dev_{idx}"
                    conn.execute("""
                        INSERT OR REPLACE INTO device_profiles
                        (device_id, account_count, fraud_history, last_used_time)
                        VALUES (?, ?, ?, ?)
                    """, (
                        device_id,
                        int(row["device_account_count"]),
                        int(row["device_fraud_history"]),
                        datetime.utcnow().isoformat()
                    ))
                    
                    # 4. Seed Location Profiles
                    location_id = f"loc_{idx}"
                    conn.execute("""
                        INSERT OR REPLACE INTO location_profiles
                        (location_id, risk_score)
                        VALUES (?, ?)
                    """, (
                        location_id,
                        float(row["location_risk_score"])
                    ))
                    
                conn.commit()
            print("Database profiles seeded successfully!")
        except Exception as e:
            print(f"Error seeding database: {e}")

    # Transaction operations
    def save_transaction(self, txn_id: str, user_id: str, amount: float, txn_type: str, 
                         timestamp: str, beneficiary_id: str, device_id: str, 
                         latitude: float, longitude: float, is_fraud: int, 
                         prob: float, score: int, level: str, rules: list, payment_method: str = "UPI") -> dict:
        with self.get_connection() as conn:
            rules_str = json.dumps(rules)
            created_at = datetime.utcnow().isoformat()
            
            conn.execute("""
                INSERT INTO transactions 
                (transaction_id, user_id, amount, transaction_type, timestamp, beneficiary_id, device_id, 
                 location_latitude, location_longitude, is_fraud, fraud_probability, risk_score, risk_level, triggered_rules, created_at, payment_method)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                txn_id, user_id, amount, txn_type, timestamp, beneficiary_id, device_id,
                latitude, longitude, is_fraud, prob, score, level, rules_str, created_at, payment_method
            ))
            
            # Update user profile dynamically
            cursor = conn.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,))
            user_prof = cursor.fetchone()
            if user_prof:
                # Update moving average metrics
                total_txns = 10  # assume weight for history
                new_avg = (user_prof["avg_amount"] * total_txns + amount) / (total_txns + 1)
                conn.execute("""
                    UPDATE user_profiles 
                    SET avg_amount = ?, last_latitude = ?, last_longitude = ?, last_txn_time = ?
                    WHERE user_id = ?
                """, (new_avg, latitude, longitude, timestamp, user_id))
            else:
                # Insert default new user profile
                conn.execute("""
                    INSERT INTO user_profiles 
                    (user_id, avg_amount, std_amount, avg_daily_txns, avg_hour, last_latitude, last_longitude, last_txn_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (user_id, amount, 100.0, 1.0, 12.0, latitude, longitude, timestamp))
                
            # Update beneficiary profile dynamically
            cursor = conn.execute("SELECT * FROM beneficiary_profiles WHERE beneficiary_id = ?", (beneficiary_id,))
            bene_prof = cursor.fetchone()
            if bene_prof:
                conn.execute("""
                    UPDATE beneficiary_profiles
                    SET total_txns = total_txns + 1
                    WHERE beneficiary_id = ?
                """, (beneficiary_id,))
            else:
                # Insert default beneficiary
                conn.execute("""
                    INSERT INTO beneficiary_profiles
                    (beneficiary_id, age_days, risk_score, total_txns, unique_senders)
                    VALUES (?, ?, ?, ?, ?)
                """, (beneficiary_id, 1, 10.0, 1, 1))

            # Update device profile dynamically
            cursor = conn.execute("SELECT * FROM device_profiles WHERE device_id = ?", (device_id,))
            dev_prof = cursor.fetchone()
            if dev_prof:
                conn.execute("""
                    UPDATE device_profiles
                    SET last_used_time = ?
                    WHERE device_id = ?
                """, (timestamp, device_id))
            else:
                # Insert default device
                conn.execute("""
                    INSERT INTO device_profiles
                    (device_id, account_count, fraud_history, last_used_time)
                    VALUES (?, ?, ?, ?)
                """, (device_id, 1, 0, timestamp))
                
            conn.commit()
            
        return {
            "transaction_id": txn_id,
            "user_id": user_id,
            "amount": amount,
            "transaction_type": txn_type,
            "timestamp": timestamp,
            "beneficiary_id": beneficiary_id,
            "device_id": device_id,
            "location_latitude": latitude,
            "location_longitude": longitude,
            "is_fraud": is_fraud,
            "fraud_probability": prob,
            "risk_score": score,
            "risk_level": level,
            "triggered_rules": rules,
            "created_at": created_at,
            "payment_method": payment_method
        }

    def get_recent_transactions(self, user_id: str, timestamp_iso: str, minutes_offset: int) -> list:
        # Get transactions within timestamp_iso minus minutes_offset
        try:
            current_time = datetime.fromisoformat(timestamp_iso.replace("Z", ""))
        except ValueError:
            current_time = datetime.utcnow()
            
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions 
                WHERE user_id = ? 
                ORDER BY timestamp DESC
            """, (user_id,))
            
            rows = cursor.fetchall()
            matching = []
            for row in rows:
                try:
                    row_time = datetime.fromisoformat(row["timestamp"].replace("Z", ""))
                    diff_seconds = (current_time - row_time).total_seconds()
                    if 0 <= diff_seconds <= (minutes_offset * 60):
                        matching.append(dict(row))
                except ValueError:
                    continue
            return matching

    def get_recent_beneficiary_transactions(self, beneficiary_id: str, timestamp_iso: str, minutes_offset: int) -> list:
        try:
            current_time = datetime.fromisoformat(timestamp_iso.replace("Z", ""))
        except ValueError:
            current_time = datetime.utcnow()
            
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions 
                WHERE beneficiary_id = ? 
                ORDER BY timestamp DESC
            """, (beneficiary_id,))
            
            rows = cursor.fetchall()
            matching = []
            for row in rows:
                try:
                    row_time = datetime.fromisoformat(row["timestamp"].replace("Z", ""))
                    diff_seconds = (current_time - row_time).total_seconds()
                    if 0 <= diff_seconds <= (minutes_offset * 60):
                        matching.append(dict(row))
                except ValueError:
                    continue
            return matching

    def get_user_profile(self, user_id: str) -> dict | None:
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_beneficiary_profile(self, beneficiary_id: str) -> dict | None:
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM beneficiary_profiles WHERE beneficiary_id = ?", (beneficiary_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_device_profile(self, device_id: str) -> dict | None:
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM device_profiles WHERE device_id = ?", (device_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_all_transactions(self, limit: int = 100) -> list:
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions 
                ORDER BY created_at DESC 
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]

    def get_analytics_summary(self) -> dict:
        with self.get_connection() as conn:
            cursor_total = conn.execute("SELECT COUNT(*) as count FROM transactions")
            total = cursor_total.fetchone()["count"]
            
            cursor_fraud = conn.execute("SELECT COUNT(*) as count FROM transactions WHERE is_fraud = 1")
            fraud = cursor_fraud.fetchone()["count"]
            
            cursor_genuine = conn.execute("SELECT COUNT(*) as count FROM transactions WHERE is_fraud = 0")
            genuine = cursor_genuine.fetchone()["count"]
            
            cursor_high_risk = conn.execute("SELECT COUNT(*) as count FROM transactions WHERE risk_score >= 70")
            high_risk = cursor_high_risk.fetchone()["count"]
            
            # Hourly trend
            cursor_trend = conn.execute("""
                SELECT strftime('%H', created_at) as hour, COUNT(*) as count, SUM(is_fraud) as fraud_count
                FROM transactions 
                GROUP BY hour
                ORDER BY hour
            """)
            trend = [dict(row) for row in cursor_trend.fetchall()]
            
            return {
                "total_transactions": total,
                "fraud_transactions": fraud,
                "genuine_transactions": genuine,
                "fraud_percentage": (fraud / total * 100) if total > 0 else 0.0,
                "high_risk_transactions": high_risk,
                "hourly_trend": trend
            }
db_repo = TransactionRepository()
