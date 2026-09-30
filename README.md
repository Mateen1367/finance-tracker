# Finance Tracker

A private, local expense and debt tracker. Your data stays in `data/finance.db` on this computer.

## Run it
Double-click **`run.bat`**. The first run sets everything up, then the app opens at http://localhost:8501.
Close the black console window to stop it.

## First steps
1. **Settings**: set your currency symbol. Optionally click **Load demo data** to explore, then **Remove demo accounts**.
2. **Accounts**: add each bank account, card, cash wallet, etc. with its balance *before* the first transaction you'll add.
3. **Import CSV**: download a statement as CSV from your bank's website and import it. Overlapping imports are de-duplicated.
4. **Categories & Budgets**: set monthly budgets and add rules (e.g. "UBER" → Transport) so future imports categorize themselves.
5. **Debts**: add loans and money you owe people, then use the payoff planner.

Tip: mark credit-card payments and moves between your own accounts with the **Transfer** category so they aren't counted as spending.

## Pages
| Page | What it does |
|---|---|
| Dashboard | Monthly income, spending, savings rate, net worth, spending by category, budget bars, 6-month trend |
| Transactions | Filter, search, edit, recategorize, delete, and add manual entries |
| Import CSV | Column mapping for any bank format (single amount or debit/credit columns, day-first dates) |
| Debts | Balances, upcoming due dates, avalanche vs. snowball payoff plans |
| Recurring | Auto-detected subscriptions and bills, with total monthly cost |
| Settings | Currency, CSV export, full database backup |

## Files
- `app.py`: the UI (Streamlit)
- `db.py`: the SQLite schema and queries
- `finance.py`: amount parsing, recurring detection, debt payoff math
- `demo.py`: sample data

## Back up
Copy `data/finance.db` somewhere safe, or use **Settings → Download full database backup**.
