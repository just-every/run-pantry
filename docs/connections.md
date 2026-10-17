Live bank feeds, Gusto payroll, Xero attachments and email each work through an account of your own with that provider. Pantry does not come with any of them, so each card in Pantry says when one is not set up yet and shows these same steps. Stripe and the AI key are set up inside Pantry itself, in **People & settings**.

Each provider gives you keys. You put them in lines like `PLAID_CLIENT_ID=…` and hand them to Pantry in one of two ways, shown at the end of this page.

## Bank feeds (Plaid)

Plaid connects Pantry to your bank and card accounts; Pantry never sees your bank password. Signing up is free.

1. Sign up at [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup) with your business details.
2. Open **Developers → Keys** in the Plaid Dashboard and copy your **client_id** and the **Sandbox** secret. Sandbox connects Plaid's test banks only (sign in with `user_good` / `pass_good`), so you can try the whole flow first.
3. For your real bank, request **Production** access in the Plaid Dashboard. Plaid reviews your business first, which can take a few days. Once it approves, copy the Production secret and use `PLAID_ENV=production`.
4. Some banks (Chase, for one) sign you in on their own site and need a return address. In **Developers → API**, add `https://<your Pantry address>/app/bank/connect` under **Allowed redirect URIs**, and give the same address as `PLAID_REDIRECT_URI`. Plaid accepts only https addresses there in Production, so these banks connect from a hosted Pantry.

```sh
PLAID_CLIENT_ID=your client_id
PLAID_SECRET=the Sandbox or Production secret
PLAID_ENV=sandbox
PLAID_REDIRECT_URI=https://<your Pantry address>/app/bank/connect
```

`PLAID_REDIRECT_URI` is needed only for banks that sign in on their own site. Then connect in **Bank → Connect a bank or card** ([Bank feeds and rules](/docs/bank-feeds-and-rules)).

## Payroll (Gusto)

Pantry reads processed payrolls through a Gusto developer app. The app is separate from your Gusto payroll account, and free.

1. Sign up at [dev.gusto.com](https://dev.gusto.com) and create an application.
2. Add `https://<your Pantry address>/api/pantry/gusto/callback` as its redirect URI. The **Payroll (Gusto)** card shows this address with your Pantry's own address filled in.
3. Copy the application's **Client ID** and **Secret**.
4. Gusto starts every application on its demo environment, with test companies. To bring in your real payroll, ask Gusto to approve the application for production, then use `GUSTO_ENV=production`.

```sh
GUSTO_CLIENT_ID=the Client ID
GUSTO_CLIENT_SECRET=the Secret
GUSTO_ENV=demo
```

Then connect in **People & settings → Payroll (Gusto)** ([Stripe payouts and Gusto payroll](/docs/stripe-and-gusto)).

## Attachments (Xero)

After a move-in from Xero, Pantry can carry over the files attached to your open invoices and bills. It reads them through a Xero app you make with your own Xero login; it is free and takes a few minutes.

1. Sign in at [developer.xero.com/app/manage](https://developer.xero.com/app/manage) with your Xero login and choose **New app**.
2. Choose **Web app**. Give it any name, your Pantry's address as the company or application URL, and `<your Pantry address>/api/pantry/xero/callback` as the redirect URI. The **Attachments from Xero** card shows both with your address filled in.
3. Create the app. Under **Configuration**, copy the **Client id**, then choose **Generate a secret** and copy it.

```sh
XERO_CLIENT_ID=the Client id
XERO_CLIENT_SECRET=the secret
```

Then connect on the move-in page ([Move in from QuickBooks Online or Xero](/docs/move-in)).

## Mail

Pantry on your own computer sends no email: it records each invoice and reminder as "Not sent: local run". A hosted Pantry emails invoices, reminders and sign-in links through a mail provider account of your own, [Resend](https://resend.com) or [SendGrid](https://sendgrid.com). You set it up before you [put Pantry online](/docs/hosting), because a hosted Pantry needs it to sign you in.

You send from a domain of your own, such as `yourbusiness.com`. No domain yet? Buy one from any registrar, or in the Cloudflare dashboard under **Domain Registration → Register Domains**, which also puts it on your Cloudflare account (forwarding receipts by email needs that).

**With Resend:**

1. Sign up at [resend.com](https://resend.com/signup).
2. Open **Domains**, choose **Add Domain** and enter your domain. Add the DNS records it shows wherever your domain's DNS is managed (on Cloudflare: your domain → **DNS → Records**), then choose **Verify DNS Records** and wait until it says **Verified**.
3. Open **API Keys**, choose **Create API Key** with **Sending access**, and copy it.

**With SendGrid:**

1. Sign up at [sendgrid.com](https://signup.sendgrid.com).
2. Open **Settings → Sender Authentication** and choose **Authenticate Your Domain**. Enter your domain, add the DNS records it shows wherever your domain's DNS is managed, then choose **Verify** and wait until it says **Verified**.
3. Open **Settings → API Keys**, choose **Create API Key**, pick **Restricted Access** with **Mail Send** set to **Full Access**, and copy the key. SendGrid shows it once.

Then choose the address mail comes from, at that domain, and write these lines (`MAIL_PROVIDER=sendgrid` for SendGrid):

```sh
MAIL_PROVIDER=resend
MAIL_API_KEY=the API key
MAIL_FROM=billing@example.com
```

Write `MAIL_FROM` as the address alone, with no name: `rer deploy` refuses `Your Business <billing@…>`. Invoices and reminders show your business's legal name (**People & settings → The business**) as the sender, and sign-in and invitation emails show Pantry. Customer replies go to the address in **People & settings → Sending invoices and reminders**, or to the owner's current sign-in email.

## Give the keys to Pantry

**On your own computer.** In your `run-pantry` folder, open the file `.dev.vars` in a text editor. It already holds this Pantry's private settings. Its name starts with a dot, so Finder and file dialogs hide it: open it from a terminal in that folder with `open -e .dev.vars` on a Mac, `notepad .dev.vars` on Windows, or `nano .dev.vars` on Linux. Add your lines at the end, save, and restart Pantry:

```sh
rer dev --stop
rer dev
```

**On a hosted Pantry.** On the computer you deploy from, save the lines in a private file in your `run-pantry` folder, for example `.env.pantry`, readable only by you. Give each key to the hosted Pantry with `--set-secret`, adding the same `--environment` you deployed with, if any:

```sh
chmod 600 .env.pantry
rer deploy --set-secret PLAID_CLIENT_ID --env-file .env.pantry
rer deploy --set-secret PLAID_SECRET --env-file .env.pantry
rer deploy --set-secret PLAID_ENV --env-file .env.pantry
```

Each takes effect at once, without a rebuild. Keys in `.env.pantry` when you first run `rer deploy --env-file .env.pantry` are set by that deploy. Git already ignores files named `.env…` in the `run-pantry` folder, so the keys never end up in a commit. Keep the file off anything you share.
