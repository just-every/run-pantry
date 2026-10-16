**Receipts** catches every receipt: take a photo on your phone, upload a file, or forward the email. Pantry reads the vendor, date, total and tax, proposes the transaction it belongs to, and attaches it when you accept.

## Add a receipt

Open **More › Receipts**.

- **Take a photo** opens your phone's camera. Photograph the receipt flat and in good light.
- **Upload a file** takes a photo, a PDF or a saved email (`.eml`).

Pantry keeps the original exactly as you sent it, with its fingerprint (SHA-256). A large phone photo also gets a smaller copy made on the phone for reading; the original is what Pantry keeps.

## Forward receipts by email

The owner sets up a private **Pantry address** once, in **People & settings › Forward receipts by email**. It needs a domain of yours on Cloudflare, in the account Pantry runs in:

1. In Cloudflare, open the domain, then **Email › Email Routing**, and turn it on (a spare subdomain such as `books.example.com` leaves your normal mail as it is).
2. Under **Routing rules**, create the address `receipts@` your domain with the action **Send to a Worker**, and choose Pantry's Worker.
3. Under **Settings**, turn on **Subaddressing**.
4. Enter the address on the page and choose **Create my Pantry address**.

Pantry adds a private tag, such as `receipts+k7…@books.example.com`. Forward receipt emails to it, or set your mail to forward them automatically; Gmail's confirmation code shows on the same card. Each message is kept whole. Pantry reads its PDF or photo attachment, or the email itself when it has none. If your domain keeps Subaddressing off, use the same private address spelled with a dash (`receipts-k7…@books.example.com`, shown on the card) and give it its own routing rule to Pantry's Worker. Mail to any other address is refused, and **Make a new address** replaces a shared one.

On your own computer, mail cannot reach Pantry: send a saved `.eml` to the address from the same card to see it work.

## AI reading

Pantry reads receipts with your own AI provider account. The owner adds the key in **People & settings › AI reading**: choose Anthropic or an OpenAI-compatible provider, paste the key, and choose **Test the key**. The key is stored sealed and never shown again. Without a key, every receipt says **Add a key to read receipts** and Pantry reads nothing; you can still type the fields and attach the receipt yourself.

Pantry sends the receipt and your expense account names to that provider. What the model reads is only a proposal, and anything written on a receipt is never followed as an instruction.

## Review and attach

Each new receipt waits under **To review** with what was read: vendor, date, total, tax, currency and an expense account. Below it are the transactions it may belong to (a bank or card line, a bill, a payment or an entry), found by the same total, a date close to the receipt's and the vendor's name; a receipt in another currency is matched by date and vendor. Correct anything that was misread, choose the transaction and choose **Accept and attach**.

Nothing is attached or recorded before you accept. A card line that is not in your books yet is recorded to the account you choose, matched to its line, with the receipt attached. **Not a receipt** sets one aside; its file is still kept.

## Rules

The owner can let routine receipts attach themselves: under **Receipt rules**, name the vendor, the account and an amount limit. A receipt from that vendor, up to the limit, that matches exactly one bank or card line (same total, within three days) is attached and recorded without waiting. The activity record names the rule.

## Where a receipt shows

- **Books › Journal entries:** each entry shows its receipt, or **Photo** and **File** to add one.
- **Reports:** every figure opens to its records, and each record lists its receipts.
- **Close:** the **Receipts** card lists spending with no receipt ([Close the month](/docs/close)).
- **Exports:** the general ledger CSV names each line's receipt with its fingerprint, the accountant package lists every attached receipt, and a full export keeps every file.
