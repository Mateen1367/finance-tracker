"""Pure calculation helpers: amount parsing, recurring-charge detection, debt payoff simulation."""
import re

import pandas as pd


def parse_amount(value):
    """Turn bank-statement strings like '$1,234.50', '(45.00)', '120.00-' into floats."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return 0.0 if pd.isna(value) else float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    negative = text.startswith("-") or text.endswith("-") or (text.startswith("(") and text.endswith(")"))
    digits = re.sub(r"[^0-9.]", "", text)
    if digits in ("", "."):
        return 0.0
    amount = float(digits)
    return -amount if negative else amount


def normalize_merchant(description):
    """'NETFLIX.COM 8472 LOS GATOS' and 'NETFLIX.COM 1193 LOS GATOS' -> 'netflix com los'."""
    text = re.sub(r"[0-9#*/\\._-]+", " ", description.lower())
    words = [w for w in text.split() if len(w) > 1]
    return " ".join(words[:3]) or description.lower()


FREQUENCIES = [  # label, min gap days, max gap days, charges per month
    ("Weekly", 6, 8, 52 / 12),
    ("Monthly", 26, 35, 1),
    ("Quarterly", 85, 95, 1 / 3),
    ("Yearly", 355, 375, 1 / 12),
]


def detect_recurring(tx):
    """Find subscriptions/bills: same merchant, similar amount, regular spacing.
    tx needs columns date (datetime), description, amount."""
    spending = tx[tx["amount"] < 0].copy()
    if spending.empty:
        return pd.DataFrame()
    spending["merchant"] = spending["description"].astype(str).map(normalize_merchant)
    found = []
    for _, group in spending.groupby("merchant"):
        if len(group) < 3:
            continue
        group = group.sort_values("date")
        gaps = group["date"].diff().dt.days.dropna()
        amounts = -group["amount"]
        if amounts.std(ddof=0) / amounts.mean() > 0.25:  # amount varies too much
            continue
        median_gap = gaps.median()
        match = next((f for f in FREQUENCIES if f[1] <= median_gap <= f[2]), None)
        if match is None:
            continue
        label, lo, hi, per_month = match
        if gaps.between(lo * 0.8, hi * 1.2).mean() < 0.6:  # spacing too irregular
            continue
        last = group["date"].max()
        found.append({
            "merchant": group["description"].iloc[-1],
            "frequency": label,
            "avg_amount": round(amounts.mean(), 2),
            "monthly_cost": round(amounts.mean() * per_month, 2),
            "times_seen": len(group),
            "last_charge": last.date(),
            "next_expected": (last + pd.Timedelta(days=int(median_gap))).date(),
        })
    if not found:
        return pd.DataFrame()
    return pd.DataFrame(found).sort_values("monthly_cost", ascending=False)


def simulate_payoff(debts, extra=0.0, strategy="avalanche", max_months=600):
    """Month-by-month payoff. Every month: interest accrues, minimums are paid, and the
    extra money (plus minimums freed up by paid-off debts) goes to the priority debt.
    avalanche = highest interest first, snowball = smallest balance first.
    Returns months (None if never paid off), total_interest, payoff order, and a balance history."""
    ds = [
        {"name": d["name"], "balance": float(d["balance"]), "rate": float(d["apr"] or 0) / 100 / 12,
         "min": float(d["min_payment"] or 0)}
        for d in debts if float(d["balance"]) > 0
    ]
    history = [{"month": 0, "balance": sum(d["balance"] for d in ds)}]
    if not ds:
        return {"months": 0, "total_interest": 0.0, "order": [], "history": pd.DataFrame(history)}

    monthly_budget = sum(d["min"] for d in ds) + float(extra)
    if strategy == "avalanche":
        priority = sorted(ds, key=lambda d: (-d["rate"], d["balance"]))
    else:
        priority = sorted(ds, key=lambda d: (d["balance"], -d["rate"]))

    month, total_interest, order = 0, 0.0, []
    while any(d["balance"] > 0.005 for d in ds):
        if month >= max_months:
            return {"months": None, "total_interest": total_interest, "order": order,
                    "history": pd.DataFrame(history)}
        month += 1
        for d in ds:
            if d["balance"] > 0:
                interest = d["balance"] * d["rate"]
                d["balance"] += interest
                total_interest += interest
        remaining = monthly_budget
        for d in ds:
            if d["balance"] > 0:
                paid = min(d["min"], d["balance"], remaining)
                d["balance"] -= paid
                remaining -= paid
        for d in priority:
            if remaining <= 0:
                break
            if d["balance"] > 0:
                paid = min(remaining, d["balance"])
                d["balance"] -= paid
                remaining -= paid
        for d in ds:
            if d["balance"] <= 0.005 and not d.get("done"):
                d["balance"], d["done"] = 0.0, True
                order.append((d["name"], month))
        history.append({"month": month, "balance": sum(d["balance"] for d in ds)})
    return {"months": month, "total_interest": total_interest, "order": order, "history": pd.DataFrame(history)}
