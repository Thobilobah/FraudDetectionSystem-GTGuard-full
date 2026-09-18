# UPI FraudGuard AI

### AI-Powered Real-Time UPI Transaction Fraud Detection & Risk Intelligence Platform

---

## 📌 Problem Statement
As digital payments scale, UPI (Unified Payments Interface) transactions are subject to sophisticated social engineering, phishing, account takeovers, and mule account networks. Detecting fraud *during* payment authorization is critical. However, live payment processors (like Razorpay) provide only basic transactional info (amounts, timestamps, payment channels) and do not supply fraud-related metrics.

## 💡 Solution
**UPI FraudGuard AI** is a real-time risk intelligence system. It acts as an intermediary, receiving raw transaction webhooks from payment gateways (e.g. Razorpay) or simulation endpoints, dynamically engineering a **35-dimensional feature vector** from historical transaction states, executing machine learning prediction pipelines, running a post-prediction rule engine for explainability, and updating an analytical React dashboard in real-time.

---

## 🏗️ Architecture Flow
```
                     RAZORPAY GATEWAY / SIMULATOR
                                  |
                                  v
                       RAW PAYMENT EVENT CAPTURE
                                  |
                                  v
                         FASTAPI API SERVER
                                  |
                                  v
              DYNAMIC FEATURE ENGINEERING (haversine.py / sql)
         (User behavior + Beneficiary + Device + Location + Velocity)
                                  |
                                  v
             35-DIMENSIONAL VECTOR MODEL INTAKE PIPELINE
                                  |
                                  v
               SCIKIT-LEARN ML CLASSIFIER PREDICTION
                                  |
                                  v
               RULE-ENGINE EXPLANATION & RISK SCORING
                                  |
                                  v
                    REACT HACKATHON DASHBOARD (Vite)
```

---

## 📊 The 35 ML Features

### 1. Transaction Features
- `transaction_amount`: Direct input (INR)
- `transaction_type`: P2P, P2M, Recharge, Bill Payment, Merchant
- `transaction_hour`: Hour of day (0-23)
- `day_of_week`: Day name (e.g., Tuesday)
- `amount_vs_user_avg`: Ratio of amount to user historical average
- `daily_transaction_count`: Number of user transactions today
- `daily_transaction_amount`: Sum of user transaction amounts today
- `identical_amount_count_24h`: User's identical transaction amounts in 24 hours

### 2. User Behavior Features
- `user_avg_transaction_amount`: Historical mean amount
- `user_transaction_std`: Standard deviation of amount
- `user_avg_daily_transactions`: Mean daily transaction rate
- `user_avg_transaction_hour`: Average transaction hour
- `behavior_deviation_score`: Cumulative score of anomaly deviation (amount, hour, location)

### 3. Beneficiary Features
- `is_new_beneficiary`: Indicator (1/0) if beneficiary is new
- `beneficiary_age_days`: Age of beneficiary in system
- `beneficiary_transaction_count_24h`: Transaction count to beneficiary in 24 hours
- `beneficiary_unique_senders_24h`: Number of unique senders in 24 hours
- `beneficiary_risk_score`: Cumulative historical risk score

### 4. Device Features
- `is_new_device`: Indicator (1/0) if device is new to user
- `device_account_count`: Accounts linked to device ID
- `device_fraud_history`: Count of historical fraud flags for device
- `device_change_recent`: Indicator if device changed in 24 hours

### 5. Location Features
- `location_risk_score`: Historical risk score of location segment
- `distance_from_last_txn_km`: Haversine distance in km from last transaction
- `is_new_location`: Distance > 20 km (1/0)
- `impossible_travel_flag`: Travel speed > 800 km/h between subsequent transactions (1/0)

### 6. Velocity Features
- `transactions_last_1_min`, `transactions_last_5_min`, `transactions_last_1_hour`
- `amount_last_5_min`, `amount_last_1_hour`
- `beneficiaries_last_1_hour`

### 7. Statistical Features
- `amount_z_score`: Standardized amount (z-score)
- `amount_percentile`: Percentile rank of amount
- `moving_average_deviation`: Deviation from last 5 transactions moving average

---

## ⚙️ Automated Feature Engineering Layer
When a payment webhook hits `POST /webhooks/razorpay` or `/predict`, the backend retrieves profile states from SQLite:
1. **Haversine Distance**: Calculates distance in km between current lat/lon and last transaction coordinates.
2. **Velocity Travel Check**: Calculates velocity (distance / time). If speed > 800 km/h, flags `impossible_travel_flag` = 1.
3. **Statistical Deviation**: Evaluates Z-Score and Percentile ranks using historical user statistics.
4. **Moving Windows**: Counts user transactions and sums volumes across 1m, 5m, and 1h intervals.

---

## 🤖 Machine Learning Pipeline & Evaluation
Trained models on `data/dataset.csv` (1000 rows, 37 columns) with stratified split (80-20):
- **Logistic Regression** (F1 Accuracy: 53.61%, Recall: 44.07%, ROC-AUC: 76.66%) - **Active Best Model**
- **Decision Tree** (F1 Accuracy: 52.43%, Recall: 45.76%, ROC-AUC: 69.41%)
- **Random Forest** (F1 Accuracy: 39.51%, Recall: 27.12%, ROC-AUC: 74.92%)
- **Gradient Boosting** (F1 Accuracy: 41.76%, Recall: 32.20%, ROC-AUC: 73.29%)

The best model is automatically serialized with its preprocessors to `backend/models/upi_fraud_pipeline.pkl`.

---

## 📑 Rule Engine & Explainability
Provides fallback and readable details for risk compliance:
- `HIGH_AMOUNT`: Amount > 3x user avg
- `NEW_BENEFICIARY`: First time transacting
- `NEW_DEVICE`: Unrecognized device
- `DEVICE_FRAUD_HISTORY`: Blacklisted device ID
- `HIGH_VELOCITY`: Frequency spike (5m > 3 txns)
- `IMPOSSIBLE_TRAVEL`: Velocity > 800 km/h
- `STATISTICAL_AMOUNT_ANOMALY`: Z-score > 3
- `REPEATED_AMOUNT_PATTERN`: Identical values in 24 hours

---

## 🔗 Razorpay Integration
Integrates live transaction captures seamlessly:
- **CONNECTED**: Webhooks are verified using SHA256 HMAC when `RAZORPAY_WEBHOOK_SECRET` is configured in `.env`.
- **DEMO/SIMULATION**: Bypasses verification gracefully if credentials are empty, allowing judges/developers to run end-to-end simulations out-of-the-box.

---

## 💻 Installation & Setup

### Requirements
- Python 3.10+
- Node.js v18+

### Step 1: Clone & Install Python Dependencies
```bash
# Create virtual environment
python -m venv venv
# Activate virtual environment
# Windows:
.\venv\Scripts\activate.bat
# Linux/macOS:
source venv/bin/activate

# Install requirements
pip install -r backend/requirements.txt
```

### Step 2: Compile ML Pipeline
```bash
python backend/training/train.py
```
This validates `data/dataset.csv`, trains models, and generates metrics files and reports inside `backend/models` and `backend/reports`.

### Step 3: Install Node Packages
```bash
cd frontend
npm install
cd ..
```

---

## 🚀 Running the Application

### Start Backend Server
Run the startup script:
```bash
.\start_backend.bat
```
*(or run: `uvicorn backend.app.main:app --port 8000 --reload`)*

### Start Frontend Server
Run the startup script:
```bash
.\start_frontend.bat
```
*(or run: `cd frontend && npm run dev`)*

Open **http://localhost:5173** to view the app!

---

## 🔮 Future Enhancements
- GNNs (Graph Neural Networks) for cluster ring fraud detection.
- Kafka for transaction streaming, Redis for hot caching.
- PostgreSQL database integration for scale.
- SHAP value charts for visual feature importance explanations.
