**Questions from Pantry**: Pantry checks your books for what doesn't add up and asks you, one plain question at a time, by email first. Your answer files it. Nothing in the books changes until you answer.

## What Pantry asks about

About once an hour (and whenever someone chooses **Check the books now**), Pantry looks for:

- **A deposit nothing explains**: money came in and nothing in the books is matched to it after a few days (5 by default). Pantry offers the open invoice of that amount, a transfer from your other account, the payment you already recorded, or how you filed the same payer before.
- **A payment with no category**: money went out and is still unfiled after two weeks (14 days by default), so it is missing from your reports. Pantry offers how you filed that payee before, a bill of that amount, or the categories you use most.
- **A cost without its receipt**: a posted bill, or spending from a bank or card filed as a cost, with no receipt or recorded reason after the same age. Costs under the receipt amount ($75.00 by default) are left alone.
- **The same payment twice**: two payments to one vendor of the same amount within ten days, or two charges from one payee of the same amount within three days.
- **A bank balance the books cannot reach**: the latest statement's closing balance against the books' opening balance for that account plus every transaction the bank sent since. Whatever is left over is money the bank has and the books cannot account for.

Months that are locked are left alone. A question is asked once: once you answer it, or say it is not a problem, Pantry does not ask about it again. If the books answer it first (someone files the line, a rule files it, a receipt is attached), the question says so and closes by itself.

## Answer by email

Each new question goes to the owner's email, a few a day (3 by default). The email says what doesn't add up, shows the record, and lists the answers by number, each with what it changes, for example *Files it to 6200 Software and subscriptions; October net income $9,840.00 → $9,785.01.* The link opens that exact record in Pantry.

If you have set up your **Pantry address** (**People & settings › Forward receipts by email**), the question comes from your books with that address to reply to:

- Reply with the **number** to file it that way. Add **always** (for example `2 always`) and Pantry also makes a bank rule, so the next ones from that payee file themselves.
- For a receipt question, reply with the **receipt attached**, and Pantry attaches it to the bill or entry.
- Or reply **in your own words**, like *that was my lunch, I'll pay it back*. With an AI model key (below), Pantry reads your answer into one of the answers, emails you what it understood, and waits: reply **yes** to do it or **no** to leave it.

Only the owner the question was sent to can answer by email. On this computer, and on RER Managed hosting, no email reaches Pantry; the emails link to the question instead.

## Answer in Pantry

Open **More › Questions from Pantry**. The oldest open question is at the top, beside its record; the rest wait in **Still to answer**.

- Choose an answer and Pantry shows what it changes. **File it** files the transaction; tick **Always file this payee the same way** to make a bank rule too.
- **Something else: file it to** files a payment or deposit to any category.
- For a receipt question, **Upload the receipt**, or choose **There is no receipt** and say why (this needs the post grant).
- **Or tell Pantry in your own words** works as it does by email: with an AI model key, Pantry reads it and waits for **Yes, do it**.

Each question keeps its conversation: what Pantry asked, every answer by email or in Pantry, and what Pantry did.

## AI model key

Pantry checks with built-in rules and says so. With the installation's own AI model key (**People & settings › AI reading**, the same key that reads receipts) it also reads answers written in your own words and guesses the category of a payee it has never seen. The model only ever picks one of the answers or one of your categories, and nothing is filed until you say yes. RER Managed hosting has no outbound connection for AI providers yet and says so in one line.

## At month end

**Close** shows the month's questions as one thread: the next open one to answer right there, and every other one with its answer or why it is still open (emailed with no answer yet, or waiting for your yes). The check **Pantry's questions answered** must pass before the month locks, and the accountant package carries the thread.

## How Pantry asks

The owner sets, on the Questions page, whether new questions are emailed, how many a day, after how many days a deposit or an unfiled payment is worth a question, and the receipt amount.
