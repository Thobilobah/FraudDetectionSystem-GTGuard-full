import os
import pickle
import json
import pandas as pd
from backend.app.config import settings
from datetime import datetime
from backend.app.services.rule_engine import RuleEngine

FEATURES_LIST = [
    "transaction_amount", "transaction_type", "transaction_hour", "day_of_week",
    "amount_vs_user_avg", "daily_transaction_count", "daily_transaction_amount", "identical_amount_count_24h",
    "user_avg_transaction_amount", "user_transaction_std", "user_avg_daily_transactions", "user_avg_transaction_hour", "behavior_deviation_score",
    "is_new_beneficiary", "beneficiary_age_days", "beneficiary_transaction_count_24h", "beneficiary_unique_senders_24h", "beneficiary_risk_score",
    "is_new_device", "device_account_count", "device_fraud_history", "device_change_recent",
    "location_risk_score", "distance_from_last_txn_km", "is_new_location", "impossible_travel_flag",
    "transactions_last_1_min", "transactions_last_5_min", "transactions_last_1_hour",
    "amount_last_5_min", "amount_last_1_hour", "beneficiaries_last_1_hour",
    "amount_z_score", "amount_percentile", "moving_average_deviation"
]

class PredictionService:
    def __init__(self):
        self.pipeline = None
        self.metadata = None
        self.active_model_name = "Logistic Regression"
        self.load_model()

    def load_model(self):
        metadata_path = os.path.abspath(settings.METADATA_PATH)
        
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    self.metadata = json.load(f)
                self.active_model_name = self.metadata.get("selected_model", "Logistic Regression")
                print(f"Model metadata loaded from {metadata_path}. Active model: {self.active_model_name}")
            except Exception as e:
                print(f"Error loading metadata: {e}")
                self.metadata = None
        else:
            print(f"Model metadata not found at {metadata_path}.")
            self.metadata = None

        # Resolve active model path
        fn = self.active_model_name.lower().replace(" ", "_") + ".pkl"
        models_dir = os.path.abspath(os.path.join(os.path.dirname(settings.MODEL_PATH)))
        model_path = os.path.abspath(os.path.join(models_dir, fn))
        
        if not os.path.exists(model_path):
            model_path = os.path.abspath(settings.MODEL_PATH)
            
        if os.path.exists(model_path):
            try:
                with open(model_path, "rb") as f:
                    self.pipeline = pickle.load(f)
                print(f"Active model pipeline [{self.active_model_name}] loaded from {model_path}")
            except Exception as e:
                print(f"Error loading model pipeline: {e}")
                self.pipeline = None
        else:
            print(f"Model pipeline not found at {model_path}. Train the model first.")
            self.pipeline = None

    def switch_model(self, model_name: str):
        fn = model_name.lower().replace(" ", "_") + ".pkl"
        models_dir = os.path.abspath(os.path.join(os.path.dirname(settings.MODEL_PATH)))
        model_path = os.path.abspath(os.path.join(models_dir, fn))
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found for: {model_name}")
            
        with open(model_path, "rb") as f:
            self.pipeline = pickle.load(f)
            
        self.active_model_name = model_name
        
        # Load comparison details to update active metadata
        import shutil
        reports_dir = os.path.abspath(settings.REPORTS_DIR)
        comp_csv = os.path.join(reports_dir, "model_comparison.csv")
        if os.path.exists(comp_csv):
            try:
                comp_df = pd.read_csv(comp_csv)
                row = comp_df[comp_df["Model"] == model_name]
                if not row.empty:
                    best_row = row.iloc[0]
                    self.metadata = {
                        "selected_model": model_name,
                        "metrics": {
                            "accuracy": float(best_row["Accuracy"]),
                            "precision": float(best_row["Precision"]),
                            "recall": float(best_row["Recall"]),
                            "f1": float(best_row["F1"]),
                            "roc_auc": float(best_row["ROC-AUC"]),
                            "training_time": float(best_row["Training Time (s)"])
                        },
                        "confusion_matrix": json.loads(best_row["Confusion Matrix"]),
                        "training_timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    }
                    
                    # Persist metadata to JSON
                    metadata_path = os.path.abspath(settings.METADATA_PATH)
                    with open(metadata_path, "w") as f:
                        json.dump(self.metadata, f, indent=4)
                        
                    # Copy matching feature importance CSV
                    feat_fn = "feature_importance_" + model_name.lower().replace(" ", "_") + ".csv"
                    shutil.copy(
                        os.path.join(reports_dir, feat_fn),
                        os.path.join(reports_dir, "feature_importance.csv")
                    )
            except Exception as e:
                print(f"Error compiling active metadata switch: {e}")
                
        print(f"Successfully switched active production model to: {model_name}")


    def predict_features(self, features: dict) -> dict:
        if self.pipeline is None:
            # Re-attempt loading
            self.load_model()
            if self.pipeline is None:
                raise RuntimeError("Machine learning model is not available. Please ensure model is trained.")
                
        # The pipeline expects a DataFrame
        # Construct DataFrame from features dict, in the precise training order
        ordered_features = {k: features[k] for k in FEATURES_LIST if k in features}

        # Verify all features exist
        if len(ordered_features) != 35:
            missing = [f for f in FEATURES_LIST if f not in ordered_features]
            raise ValueError(f"Missing features required for prediction: {missing}")
            
        # MLOps Outlier Defense: Cap extreme values to prevent scaling artifacts in linear models
        clipped_features = ordered_features.copy()
        if "distance_from_last_txn_km" in clipped_features:
            clipped_features["distance_from_last_txn_km"] = min(float(clipped_features["distance_from_last_txn_km"]), 150.0)
        if "amount_z_score" in clipped_features:
            clipped_features["amount_z_score"] = max(min(float(clipped_features["amount_z_score"]), 5.0), -5.0)
        if "amount_vs_user_avg" in clipped_features:
            clipped_features["amount_vs_user_avg"] = min(float(clipped_features["amount_vs_user_avg"]), 10.0)
        if "moving_average_deviation" in clipped_features:
            clipped_features["moving_average_deviation"] = min(float(clipped_features["moving_average_deviation"]), 10.0)
        if "behavior_deviation_score" in clipped_features:
            clipped_features["behavior_deviation_score"] = min(float(clipped_features["behavior_deviation_score"]), 100.0)
            
        df = pd.DataFrame([clipped_features])
        
        # Run prediction
        try:
            prediction = int(self.pipeline.predict(df)[0])
            prob_arr = self.pipeline.predict_proba(df)[0]
            # Probability of class 1 (Fraud)
            fraud_probability = float(prob_arr[1])
        except Exception as e:
            print(f"Error executing prediction pipeline: {e}")
            raise RuntimeError(f"ML Pipeline execution failure: {e}")

        # Compute risk score
        risk_score = int(round(fraud_probability * 100))
        
        # Categorize risk level
        if risk_score < settings.RISK_THRESHOLD_LOW:
            risk_level = "LOW"
        elif risk_score < settings.RISK_THRESHOLD_HIGH:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"
            
        # Run rule engine (pass full dict so payment_method-based rules 15-17 fire)
        triggered_rules = RuleEngine.evaluate_rules(features)
        
        return {
            "prediction": prediction,
            "fraud_probability": fraud_probability,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "triggered_rules": triggered_rules,
            "feature_signals": ordered_features
        }

    def score_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Vectorized version of predict_features' scoring (same clipping +
        thresholds) for bulk-scoring a whole dataset at once, e.g. to bucket
        real rows into LOW/MEDIUM/HIGH for the demo transaction generator.
        """
        if self.pipeline is None:
            self.load_model()
            if self.pipeline is None:
                raise RuntimeError("Machine learning model is not available. Please ensure model is trained.")

        X = df[FEATURES_LIST].copy()
        X["distance_from_last_txn_km"] = X["distance_from_last_txn_km"].clip(upper=150.0)
        X["amount_z_score"] = X["amount_z_score"].clip(lower=-5.0, upper=5.0)
        X["amount_vs_user_avg"] = X["amount_vs_user_avg"].clip(upper=10.0)
        X["moving_average_deviation"] = X["moving_average_deviation"].clip(upper=10.0)
        X["behavior_deviation_score"] = X["behavior_deviation_score"].clip(upper=100.0)

        fraud_probability = self.pipeline.predict_proba(X)[:, 1]
        risk_score = (fraud_probability * 100).round().astype(int)
        risk_level = pd.cut(
            risk_score,
            bins=[-1, settings.RISK_THRESHOLD_LOW - 1, settings.RISK_THRESHOLD_HIGH - 1, 100],
            labels=["LOW", "MEDIUM", "HIGH"]
        ).astype(str)

        return pd.DataFrame({
            "fraud_probability": fraud_probability,
            "risk_score": risk_score,
            "risk_level": risk_level
        }, index=df.index)

prediction_service = PredictionService()
