**Receipts** catches every receipt: take a photo on your phone, upload a file, or forward the email. Pantry reads the vendor, date, total and tax, proposes the transaction it belongs to, and attaches it when you accept.

## Add a receipt

Open **More › Receipts**.

- **Take a photo** opens your phone's camera. Photograph the receipt flat and in good light.
- **Upload a file** accepts several photos, PDFs or saved emails (`.eml`) at once. You can also drop several files into the receipt drop zone. Each file has its own progress and error, so one failure does not discard the others. JPEG, PNG, HEIC and multi-page PDFs are accepted up to 25 MB per original. A multi-page PDF stays one document.

Pantry keeps the original exactly as you sent it, with its fingerprint (SHA-256). A large phone photo also gets a smaller copy made on the phone for reading; the original is what Pantry keeps.

## Several receipts in one photograph

Choose **Split receipts in a photo**, then take a photo or upload a JPEG or PNG. Draw a rectangle around each receipt, or add regions and enter their percentages. Choose **Save separate receipts**. Each selected region becomes its own JPEG receipt for review. The interface identifies it as a derived receipt and links to the **Original capture**: your whole photograph, unchanged, with its SHA-256. A HEIC photo can be retained as one file; convert it to JPEG or PNG on your device before choosing regions.

If a part fails to upload, choose its **Retry receipt** button. Already saved parts stay saved; retrying a part does not create a second receipt. Capturing never approves a bill or posts a financial entry. Existing receipt rules still apply after capture.

The original photograph has the same signed-in financial access as other receipt evidence. A full archive keeps both original and derived documents and their provenance. When it supports posted entries for several receipts, ERASURE-001 retains it until the latest supporting transaction or correction across all those receipts plus the owner's retention period, followed by explicit owner confirmation of expiry. No public link is created.

## Forward receipts by email

The owner sets up a private **Pantry address** once, in **People & settings › Forward receipts by email**. It needs a domain of yours, such as `yourbusiness.com`, on the Cloudflare account Pantry runs in; the `workers.dev` address Pantry starts on cannot receive mail. Without a domain nothing is lost: photos and uploads work everywhere.

No domain on that Cloudflare account yet? Either buy one there, under **Domain Registration → Register Domains** (it is on your account at once), or add one you own: choose **Add a domain**, pick the Free plan, check the DNS records Cloudflare copied against your current ones, then at the company you bought it from replace its nameservers with the two Cloudflare shows. It says **Active** once the change has spread, usually within an hour. The domain you send Pantry's mail from can be the same one.

Then:

1. In Cloudflare, open the domain, then **Email › Email Routing**, and turn it on (a spare subdomain such as `books.example.com` leaves your normal mail as it is).
2. Under **Routing rules**, create the address `receipts@` your domain with the action **Send to a Worker**, and choose Pantry's Worker: `pantry-production`, or `pantry-` and the environment name if you deployed with `--environment`. The card names it.
3. Under **Settings**, turn on **Subaddressing**.
4. Enter the address on the page and choose **Create my Pantry address**.

Pantry adds a private tag, such as `receipts+k7…@books.example.com`. Forward receipt emails to it, or set your mail to forward them automatically; Gmail's confirmation code shows on the same card. Each message is kept whole. Pantry reads its PDF or photo attachment, or the email itself when it has none. If your domain keeps Subaddressing off, use the same private address spelled with a dash (`receipts-k7…@books.example.com`, shown on the card) and give it its own routing rule to Pantry's Worker. Mail to any other address is refused, and **Make a new address** replaces a shared one.

On your own computer, mail cannot reach Pantry: send a saved `.eml` to the address from the same card to see it work.

## AI reading

Pantry reads receipts with your own AI provider account. The owner adds the key in **People & settings › AI reading**: choose Anthropic or an OpenAI-compatible provider, paste the key, and choose **Test the key**. The key is stored sealed and never shown again. Without a key, every receipt says **Add a key to read receipts** and Pantry reads nothing; you can still type the vendor, date and total from the receipt, and the transactions with that total appear under **Attach to**, ready for **Accept and attach**.

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
