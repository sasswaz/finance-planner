# Finance Planner

A household finance planner that runs locally in your browser. Enter your family's salaries and bonuses, other income, expenses, loans and savings goals. It projects your cash flow month by month for the coming years and shows what early loan payments would save.

## Run it

```bash
npm install      # first time only
npm run dev      # then open http://localhost:5199
```

For everyday use, `npm run build` and then `npm run preview` is faster. It serves an optimised build on the same address, so your plans are the same. `npm run dev` is for working on the code.

Your plans save automatically in this browser's local storage, tied to the address http://localhost:5199. Always open the app there, or your plans won't show. They are never sent anywhere. Use **Settings → Export backup** now and then: clearing browser data deletes your plans. The backup includes every plan. Import it to restore them or to move them to another computer.

## What's in it

| Page | What you enter / see |
|---|---|
| Overview | Monthly income vs spending, a breakdown of how the savings figure adds up, a warning for suspiciously small amounts, savings and debt over time, a **money-flow diagram** (income sources → spending, loans and savings) for the next 12 months or any year, the next 12 months of irregular events, goal status, and a cash-shortfall warning |
| Income | Each family member's net salary, yearly raise and bonuses. A bonus can be paid every year, quarter or month, or once, with an optional end. It can be a fixed amount or a multiple of salary (e.g. a 13th salary), which then follows raises and salary changes. Salary changes from a given month (new job, parental leave with bonuses paused, retirement). Other income such as rent received or benefits |
| Expenses | Rent, bills, insurance, groceries, holidays and so on. Each one is monthly, quarterly, yearly or one-off, with optional start and end months. Includes a breakdown by category |
| Loans | Balance, rate, and either the remaining term or the monthly payment. You can enter today's balance, or the original loan with its first payment. Variable-rate changes. Plan early payments (once, monthly, yearly, or **a share of bonuses**, e.g. 50% of one person's bonuses, or of those paid in a given month), choose whether the bank shortens the term or lowers the payment, and set an early-repayment fee %. **Debt payoff plan**: manual roll-over from one loan into another, or automatic **avalanche** (highest rate first) / **snowball** (smallest balance first) with an optional extra monthly budget, compared side by side. Shows interest saved, the new payoff date, a what-if calculator with an "overpay vs save" hint, a full repayment schedule, and the balance left each year across all loans |
| Savings & goals | Current savings, savings interest rate, and goals with on-track status |
| Projection | Year-by-year and month-by-month table of everything coming in and going out. Export to CSV |
| Compare plans | Copy your plan (sidebar copy button), change something such as "bonuses go to the mortgage", and compare the plans side by side. Includes a chart of how much better or worse off each plan is |

**Editing:** each item (person, income, expense, loan, goal) shows as a compact summary. Click **Edit** to open it, change what you need, then **Save**: it collapses again and every total updates. **Cancel** or Escape throws the changes away, and Enter saves. Nothing changes until you save. While a loan is open, its results are a preview of your unsaved changes. Settings forms (savings, projection, debt budget) show Save and Cancel as soon as you change something. Leaving a page with unsaved changes asks first.

**Amounts** can be typed the way you normally write them: `1200`, `1,200`, `1 200`, `€1,200.50` or `1.234,56`.

**Undo / redo:** the sidebar buttons, or ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z) when you're not typing in a field.

## How the numbers work

- Everything works in whole months.
- Salary raises and expense inflation apply every January after the plan starts.
- Salary raises restart the January after a salary change.
- Loans use standard annuity maths. An early payment comes off the principal right after that month's regular payment.
  - **Shorter term**: you keep paying the same amount and finish sooner.
  - **Lower payment**: the payment is recalculated over the remaining months.
  - **Rate change**: the payment is recalculated so the loan still ends on schedule. If early payments have already shortened the loan, the shortened end date is kept.
  - **Money rolled in from elsewhere** (roll-overs, the debt plan) always shortens the loan, even on "lower payment" loans, so your total monthly spending stays the same.
  - **Roll-over (manual)**: when a loan is paid off, its regular payment (plus anything rolled into it) is paid into the target loan each month from the following month. Your cash flow stays the same; the target just finishes sooner.
  - **Avalanche / snowball**: from the plan's start, a monthly pool goes to the open loan with the highest rate (avalanche) or smallest balance (snowball). The pool is the extra budget plus the regular payment of every loan already paid off. Whatever a loan can't absorb moves to the next one in line. Loans that finished before the debt plan started don't count. Money left once all loans are paid stays in savings. Manual roll-over settings are ignored while this is on.
  - **Bonus shares**: the chosen % of the matching bonuses (everyone's or one person's, any month or a specific one) goes into the loan in the month they're paid. Bonuses paused by a salary change don't count.
- A loan exists from the month before its first payment. A loan that starts later in the plan isn't counted as owed before then.
- Savings earn monthly interest, and each month's net (income − expenses − loan payments) is added to them.

Engine code is in `src/engine/`. Tests: `npm test`.
