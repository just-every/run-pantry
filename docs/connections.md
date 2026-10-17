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

1. Sign up at Resend (or SendGrid).
2. Add the domain you send from (Resend: **Domains → Add domain**; SendGrid: **Settings → Sender Authentication**) and add the DNS records it shows wherever your domain's DNS is managed. Wait until it says **Verified**.
3. Create an API key with sending access (Resend: **API Keys → Create API key**; SendGrid: **Settings → API Keys**, with Mail Send) and copy it.
4. Choose the From address your customers see, at that domain.

```sh
MAIL_PROVIDER=resend
MAIL_API_KEY=the API key
MAIL_FROM=Your Business <billing@example.com>
```

Use `MAIL_PROVIDER=sendgrid` for SendGrid. Customer replies go to the address in **People & settings → Sending invoices and reminders**, or to the owner's.

## Give the keys to Pantry

**On your own computer.** In your `run-pantry` folder, open the file `.dev.vars` in a text editor. It already holds this Pantry's private settings. Add your lines at the end, save, and restart Pantry:

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
