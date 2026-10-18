Connect your bank and cards once and their transactions arrive in **Bank** on their own. Bank rules file the routine ones; you file the rest and reconcile as usual.

## Connect a bank or card

1. In **Bank**, under **Bank and card feeds**, choose **Connect a bank or card**.
2. Choose **Connect a bank or card** again and sign in to your bank in the Plaid window. Pantry never sees your bank password.
3. Choose where each of the bank's accounts goes: an existing Pantry bank or card account, **A new bank or card account** (with its opening date and the balance on that day), or **Leave it out**.
4. Choose **Bring transactions in**.

Transactions after each account's opening date arrive at once, then on their own: when the bank tells Plaid there is news, and every few hours besides. **Bank and card feeds** shows when each account last synced and when the connection next checks. A connection awaiting sign-in says its next sync is after you re-link. Pending card and bank transactions show as **Pending** and become ordinary lines when the bank posts them; a transaction the bank withdraws leaves, unless you already filed it.

Statement files keep working beside a feed. A file line and a feed line for the same day and amount are one line, whichever arrives first.

Live feeds come through a Plaid account of your own. Until it is set up, **Bank and card feeds** says so and shows the steps: where to get the keys, what to paste and where. They are also in [Connections and keys](/docs/connections#bank-feeds-plaid). Meanwhile, and on RER Managed until its connection relay ships, statement files work as before.

## When a connection needs re-linking

Banks sometimes ask you to sign in again. The connection then shows **Needs re-link** with a plain sentence saying why, and nothing new arrives until you choose **Re-link** and sign in again in the Plaid window. **Disconnect** ends a connection; lines already in Pantry stay.

## Bank rules

A rule files a line the way you would: a category (or a split across several by percentage), a vendor or customer, a tax code and a memo, for lines matching a payee, description text, an amount range, money in or out, and one account or all.

1. In **Bank**, open **Rules** and choose **New rule**.
2. Fill in **When a line…** and **…file it as**, then choose **Preview**. Pantry lists every open line the rule would file now, and the ones it will leave alone, with the reason.
3. Keep **File these lines when I save** ticked to file them now, and choose **Save rule**.

From then on, matching lines are filed as they arrive, from a feed or a statement file. In **Transactions** they show **Filed by rule** with the rule's name and an **Undo**, which reverses the entry and leaves that line for you to file. Rules never file a line in a locked month or inside a reconciled statement. The first rule that matches a line files it.

When you file the same payee the same way three times, Pantry suggests a rule for it. Choose **Make a rule** to start from the suggestion.
