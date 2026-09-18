import os
import json
import time
import pandas as pd
import numpy as np
import pickle

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix

def train_and_evaluate():
    print("Starting ML Model Training Pipeline...")
    
    # Paths
    dataset_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "dataset.csv"))
    models_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models"))
    reports_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports"))
    
    os.makedirs(models_dir, exist_ok=True)
    os.makedirs(reports_dir, exist_ok=True)
    
    # 1. Load dataset
    print(f"Loading dataset from: {dataset_path}")
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"Dataset not found at {dataset_path}")
        
    df = pd.read_csv(dataset_path)
    
    # 2. Validate dataset
    print("Validating dataset...")
    expected_cols_count = 37

    print(f"Dataset has {len(df)} rows")

    if len(df.columns) != expected_cols_count:
        raise ValueError(f"Dataset column count mismatch. Expected {expected_cols_count}, got {len(df.columns)}")
        
    if "user_id" not in df.columns or "is_fraud" not in df.columns:
        raise ValueError("Required columns 'user_id' or 'is_fraud' are missing in the dataset.")
        
    # Check 35 ML features
    features_list = [
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
    
    missing_features = [f for f in features_list if f not in df.columns]
    if missing_features:
        raise ValueError(f"Missing expected ML features: {missing_features}")

    # Flag columns that are entirely empty in this dataset — informational only.
    # keep_empty_features=True below keeps them in the pipeline (filled with 0)
    # instead of silently dropping them, so feature names stay aligned with
    # feature importances and live traffic (which does populate these fields).
    fully_empty = [f for f in features_list if df[f].isna().all()]
    if fully_empty:
        print(f"\n[Note] {len(fully_empty)} features have NO data in this dataset "
              f"and will contribute nothing to the model:")
        print(" ", ", ".join(fully_empty), "\n")

    print("Dataset validation successful!")

    # 3. Separate features and target
    X = df[features_list].copy()
    y = df["is_fraud"].copy()

    # 4. Define Preprocessor
    categorical_cols = ["transaction_type", "day_of_week"]
    numerical_cols = [c for c in features_list if c not in categorical_cols]

    numerical_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
        ("scaler", StandardScaler())
    ])

    categorical_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="most_frequent", keep_empty_features=True)),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False))
    ])
    
    preprocessor = ColumnTransformer(transformers=[
        ("num", numerical_transformer, numerical_cols),
        ("cat", categorical_transformer, categorical_cols)
    ])
    
    # 5. Train-Test Split (80/20, stratified, seed 42)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    
    print(f"Split sizes: Train={X_train.shape}, Test={X_test.shape}")
    print(f"Target distribution: Train={y_train.value_counts().to_dict()}, Test={y_test.value_counts().to_dict()}")
    
    # 6. Define candidate models
    from sklearn.linear_model import LogisticRegression
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    
    models = {
        "Logistic Regression": LogisticRegression(random_state=42, max_iter=1000),
        "Decision Tree": DecisionTreeClassifier(random_state=42, max_depth=6),
        "Random Forest": RandomForestClassifier(random_state=42, n_estimators=100, max_depth=8),
        "Gradient Boosting": GradientBoostingClassifier(random_state=42, n_estimators=100, learning_rate=0.1, max_depth=4)
    }
    
    # Attempt XGBoost
    try:
        from xgboost import XGBClassifier
        models["XGBoost"] = XGBClassifier(
            random_state=42, n_estimators=100, learning_rate=0.1, max_depth=4, eval_metric="logloss"
        )
        print("XGBoost library loaded successfully. Adding to model suite.")
    except ImportError:
        print("XGBoost not installed or load failed. Continuing with sklearn models.")
        
    # Evaluate models
    comparison_results = []
    trained_pipelines = {}
    
    for name, clf in models.items():
        print(f"Training and evaluating model: {name}...")
        pipeline = Pipeline(steps=[
            ("preprocessor", preprocessor),
            ("classifier", clf)
        ])
        
        start_time = time.time()
        pipeline.fit(X_train, y_train)
        training_time = time.time() - start_time
        
        # Predict
        y_pred = pipeline.predict(X_test)
        y_prob = pipeline.predict_proba(X_test)[:, 1] if hasattr(pipeline, "predict_proba") else [0]*len(y_pred)
        
        # Metrics
        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        auc = roc_auc_score(y_test, y_prob)
        cm = confusion_matrix(y_test, y_pred)
        
        results = {
            "Model": name,
            "Accuracy": acc,
            "Precision": prec,
            "Recall": rec,
            "F1": f1,
            "ROC-AUC": auc,
            "Training Time (s)": training_time,
            "Confusion Matrix": json.dumps(cm.tolist())
        }
        
        comparison_results.append(results)
        trained_pipelines[name] = pipeline
        print(f"Results for {name}: F1={f1:.4f}, Recall={rec:.4f}, ROC-AUC={auc:.4f}")
        
    # Save Model Comparison CSV
    comparison_df = pd.DataFrame(comparison_results)
    comparison_csv_path = os.path.join(reports_dir, "model_comparison.csv")
    comparison_df.to_csv(comparison_csv_path, index=False)
    print(f"Saved model comparison to: {comparison_csv_path}")
    
    # 7. Automatically select best model
    # Priority order: F1 -> Recall -> ROC-AUC -> Precision
    # Let's sort by these metrics descending
    best_row = comparison_df.sort_values(
        by=["F1", "Recall", "ROC-AUC", "Precision"], 
        ascending=[False, False, False, False]
    ).iloc[0]
    
    best_model_name = best_row["Model"]
    print(f"\n>>> Best model selected: {best_model_name} (F1: {best_row['F1']:.4f})")
    
    # Save all pipelines and their feature importances
    import shutil
    for name, pipeline in trained_pipelines.items():
        # Save pipeline pickle
        fn = name.lower().replace(" ", "_") + ".pkl"
        path = os.path.join(models_dir, fn)
        with open(path, "wb") as f:
            pickle.dump(pipeline, f)
        print(f"Saved pipeline for {name} to {path}")
        
        # Generate feature importance
        classifier = pipeline.named_steps["classifier"]
        onehot_encoder = pipeline.named_steps["preprocessor"].named_transformers_["cat"].named_steps["onehot"]
        cat_features_encoded = list(onehot_encoder.get_feature_names_out(categorical_cols))
        all_feature_names = numerical_cols + cat_features_encoded
        
        if hasattr(classifier, "feature_importances_"):
            importances = classifier.feature_importances_
        elif hasattr(classifier, "coef_"):
            coefs = classifier.coef_[0]
            importances = np.abs(coefs)
            total_coef = np.sum(importances)
            if total_coef > 0:
                importances = importances / total_coef
        else:
            importances = [1.0 / len(all_feature_names)] * len(all_feature_names)
            
        feature_importances = list(zip(all_feature_names, importances))
        feature_importance_df = pd.DataFrame(feature_importances, columns=["Feature", "Importance"])
        feature_importance_df = feature_importance_df.sort_values(by="Importance", ascending=False)
        
        # Save Feature Importance CSV
        fn_feat = "feature_importance_" + name.lower().replace(" ", "_") + ".csv"
        feature_importance_csv_path = os.path.join(reports_dir, fn_feat)
        feature_importance_df.to_csv(feature_importance_csv_path, index=False)
        print(f"Saved feature importances for {name} to: {feature_importance_csv_path}")

    # Copy best model to default paths for initial load
    best_fn = best_model_name.lower().replace(" ", "_") + ".pkl"
    shutil.copy(os.path.join(models_dir, best_fn), os.path.join(models_dir, "upi_fraud_pipeline.pkl"))
    
    best_feat_fn = "feature_importance_" + best_model_name.lower().replace(" ", "_") + ".csv"
    shutil.copy(os.path.join(reports_dir, best_feat_fn), os.path.join(reports_dir, "feature_importance.csv"))
    
    # Save model metadata JSON
    metadata = {
        "selected_model": best_model_name,
        "trained_on": "dataset.csv (Nigerian NIBSS data)",
        "features_with_no_data": fully_empty,
        "metrics": {
            "accuracy": float(best_row["Accuracy"]),
            "precision": float(best_row["Precision"]),
            "recall": float(best_row["Recall"]),
            "f1": float(best_row["F1"]),
            "roc_auc": float(best_row["ROC-AUC"]),
            "training_time": float(best_row["Training Time (s)"])
        },
        "confusion_matrix": json.loads(best_row["Confusion Matrix"]),
        "training_timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    
    metadata_json_path = os.path.join(models_dir, "model_metadata.json")
    with open(metadata_json_path, "w") as f:
        json.dump(metadata, f, indent=4)
    print(f"Saved model metadata to: {metadata_json_path}")

    
    print("Top 10 features:")
    print(feature_importance_df.head(10).to_string(index=False))
    print("Training pipeline finished successfully!")

if __name__ == "__main__":
    train_and_evaluate()
