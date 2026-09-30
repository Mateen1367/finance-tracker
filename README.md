# My Money

A private, Copilot / Rocket Money style personal finance app. It tracks spending, budgets, subscriptions and debts, with automatic bank syncing through Plaid.
It runs on your own computer, and your data stays in `data/money.db`.

## Start it
Double-click **`run.bat`**. The first run installs everything (a few minutes), then the app opens at **http://localhost:8501**.
Keep the black window open while you use the app. Close it to stop.

After pulling new code from GitHub, run **`update.bat`** once to rebuild.

## Connect your bank (Plaid)
1. Create a free account at https://dashboard.plaid.com/signup
2. In the dashboard, open **Developers → Keys** and copy your `client_id` and **Sandbox** secret
3. In the app, go to **Accounts → Set up bank connections** and paste them
4. Click **Connect a bank**. In Sandbox, pick any bank and sign in with `user_good` / `pass_good`

Sandbox uses fake banks, so you can try everything safely. To connect your **real** accounts, request Production access in the Plaid
dashboard. Once approved, paste the Production secret and switch the environment to Production (Settings → Plaid keys).

How it stays secure:
- You log in to your bank inside Plaid's own window, so your bank password never reaches this app.
- The app only gets a **read-only** access token. It can't move money.
- Access tokens are encrypted in the database with a key kept in `.env`, which is never committed.
- The server only listens on `localhost`, so nothing on your network can reach it.

## Features
| Screen | What it does |
|---|---|
| Home | Spending this month vs last month (pace chart), budget ring, net worth, transactions to review, upcoming bills, top categories |
| Transactions | Grouped by day, search and filters, tap to recategorize, "always categorize this merchant", notes, review mode that advances automatically, manual entry |
| Budgets | Monthly limits per category, left-per-day, custom categories (emoji and color), auto-categorize rules |
| Debts | Loans and cards (synced ones fill in automatically), due dates, avalanche vs snowball payoff planner with a chart |
| Accounts | Net worth, bank connections and sync, manual accounts, CSV statement import |
| Recurring | Detected subscriptions and bills with next charge dates and yearly cost |

It also installs like an app on your phone ("Add to Home Screen"). Phones can only install it over HTTPS, so that part comes when it's hosted online.

## Project layout
```
backend/          Python API (FastAPI)
  main.py         all /api endpoints and serving of the web app
  plaid_sync.py   Plaid Link, transaction sync, liabilities -> debts
  db.py           SQLite schema and queries
  finance.py      recurring detection, debt payoff simulation, amount parsing
  demo.py         sample data
  config.py       .env loading and token encryption
web/              React app (Vite, Tailwind, React Query, Recharts)
  src/pages/      one file per screen
  src/components/ shared UI, transaction sheet, bank connection pieces
```

### Developing
```bash
.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8501 --reload
```
```bash
cd web && ..\.venv\Scripts\npm.exe run dev
```
Then open http://localhost:5173 (hot reload; API calls are proxied to port 8501).
