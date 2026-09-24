# UPI FraudDetectionSystem

### AI-Powered Real-Time UPI Transaction Fraud Detection & Risk Intelligence Platform

---

## 📌 Problem Statement
As digital payments scale, UPI (Unified Payments Interface) transactions are subject to sophisticated social engineering, phishing, account takeovers, and mule account networks. Detecting fraud *during* payment authorization is critical. However, live payment processors (like Razorpay) provide only basic transactional info (amounts, timestamps, payment channels) and do not supply fraud-related metrics.

## 💡 Solution
**UPI FraudDetectionSystem** is a real-time risk intelligence system. It acts as an intermediary, receiving raw transaction webhooks from payment gateways (e.g. Razorpay) or simulation endpoints, dynamically engineering a **30-dimensional feature vector** from historical transaction states, executing machine learning prediction pipelines, running a post-prediction rule engine for explainability, and updating an analytical React dashboard in real-time.

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

## 📊 The 30 ML Features

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
When a payment webhook hits `POST /webhooks/razorpay` or `/predict`, the backend retrieves profile states from PostgreSQL:
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

## 🗄️ Database: PostgreSQL

This project now runs on **PostgreSQL** instead of SQLite, so it can handle concurrent writers (multiple webhook events / API workers hitting the DB at once) without lock contention, and can be scaled to a managed Postgres instance (RDS, Supabase, etc.) as transaction volume grows.

- Connections are served from a `psycopg2` **ThreadedConnectionPool** (2–20 connections), not a single per-request connection.
- All five tables (`transactions`, `user_profiles`, `beneficiary_profiles`, `device_profiles`, `location_profiles`) and their seeding logic were ported 1:1, with SQLite's `INSERT OR REPLACE` converted to proper Postgres `ON CONFLICT ... DO UPDATE` upserts.
- No route or service code changed — the repository layer exposes the same `execute()` / `fetchone()` / `fetchall()` interface the rest of the app already used, so `feature_engineering.py`, the prediction pipeline, and every route work unmodified.

### Quick start with Docker (recommended)
```bash
docker compose up -d
```
This starts a local Postgres 16 instance matching the default `DATABASE_URL` in `backend/.env.example` (`fraudguard` / `fraudguard` / `fraudguard_db` on `localhost:5432`).

### Or point at any PostgreSQL instance
Set `DATABASE_URL` in `backend/.env`:
```
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
```
Tables are created automatically on first run — no manual migration step needed.

---

## 🔐 Login / Authentication

The dashboard is now gated behind a real sign-in screen (`frontend/src/pages/Login.tsx`), backed by a genuine JWT auth layer on the backend — not just a frontend-only check.

- `POST /auth/login` accepts `{ email, password }` and returns a signed JWT (`PyJWT`, `HS256`, 24h expiry) plus the user's display info.
- **Demo Mode**: any well-formed email + non-empty password is accepted, matching the same demo-mode pattern used for Razorpay/GTCO elsewhere in this system. Swap the acceptance check in `backend/app/routes/auth.py` for a real password-hash lookup against a `users` table to go to production.
- Every data route (`/predict*`, `/analytics`, `/transactions*`, `/model/select`) requires a valid `Authorization: Bearer <token>` header — enforced server-side via a FastAPI dependency (`backend/app/auth.py::get_current_user`), so the login screen genuinely gates access to live data.
- The frontend (`frontend/src/services/api.ts`) attaches the token to every request automatically and forces a re-login if the backend ever returns `401`.
- Set `AUTH_SECRET_KEY` in `backend/.env` to a real secret before deploying.

---

## 🎨 GT GUARD Restyle & Suspend Workflow

The dashboard now matches the GT GUARD Figma designs: orange/dark brand system, USSD/Naira throughout, and a real **Suspend** state for medium-risk transactions - not just a color swap.

**Decision logic** (`backend/app/routes/prediction.py::status_from_risk_level`):
- **LOW** risk -> `status: APPROVED` (auto-cleared)
- **HIGH** risk -> `status: BLOCKED` (auto-rejected)
- **MEDIUM** risk -> `status: SUSPENDED` - held, *not* auto-approved, until a human resolves it

**Roles**: login is restricted to a fixed allowlist in `backend/app/services/credential_store.py` (SHA-256 hashed passwords):
- **Analysts** (password `12345`): `peace@gmail.com`, `jane@gmail.com`, `esther@gmail.com`, `pelumi@gmail.com`, `tobi@gmail.com`
- **Admins** (password `admin`): `admin@gmail.com`, `sup.admin@gmail.com`

Only these accounts can sign in at `/auth/login`; anything else gets a `401`. The role is issued as a `role` claim inside the JWT.

- **Analyst** accounts can see a Suspended transaction (a "Suspend" badge) but cannot act on it.
- **Admin** accounts see inline **Approve** / **Block** buttons directly in the Live Monitor table and in the transaction detail panel.
- Resolution goes through `PATCH /transactions/{id}/resolve`, protected server-side by `require_admin` - a non-admin token gets a `403`, enforced by the backend, not hidden UI.
- Resolving stamps `resolved_by` (the admin's email) and `resolved_at` on the transaction record.

---

## 💻 Installation & Setup

### Requirements
- Python 3.10+
- Node.js v18+
- PostgreSQL 14+ (or Docker, see above)

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
- SHAP value charts for visual feature importance explanations.
