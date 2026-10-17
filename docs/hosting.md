Pantry runs on your own computer first. To reach it from anywhere, send invoices by email and let your accountant sign in, put it online on your own Cloudflare account. `rer deploy` does the work from the `run-pantry` folder on your computer; it takes about ten minutes the first time.

## What you need

- **Pantry running on this computer**, set up with your own email as the owner ([Getting started](/docs/getting-started)). The hosted Pantry starts with the same owner.
- **A Cloudflare account.** Sign up free at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Pantry runs on Cloudflare Workers with a D1 database; Cloudflare's free Workers plan is enough to start, and [Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/) gives its limits.
- **A mail provider account** (Resend or SendGrid) with your sending domain verified, so the hosted Pantry can email your sign-in links and invoices. [Connections and keys](/docs/connections#mail) walks through it.

## 1. Give your Cloudflare account a workers.dev address

In the Cloudflare dashboard, open **Workers & Pages**. The first time, Cloudflare asks you to choose your account's `workers.dev` subdomain, for example `yourbusiness`. Your Pantry will answer at `https://pantry-production.yourbusiness.workers.dev`.

## 2. Find your account ID and make an API token

1. In the Cloudflare dashboard, open **Workers & Pages**. Copy the **Account ID** shown on the right.
2. Open **My Profile → API Tokens** ([dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)) and choose **Create Token**, then **Create Custom Token**.
3. Name it `Pantry deploy` and add two account permissions: **Workers Scripts: Edit** and **D1: Edit**. Under **Account Resources**, choose your account. No zone permission is needed.
4. Choose **Continue to summary**, then **Create Token**, and copy the token. Cloudflare shows it once.

## 3. Write the deploy file

In your `run-pantry` folder, create a file named `.env.pantry` with these lines, each value replaced with yours:

```sh
CLOUDFLARE_ACCOUNT_ID=your account ID
CLOUDFLARE_API_TOKEN=the token
MAIL_PROVIDER=resend
MAIL_API_KEY=your mail provider's API key
MAIL_FROM=Your Business <billing@example.com>
```

Keys for bank feeds, Gusto or Xero ([Connections and keys](/docs/connections)) can go in the same file now, or be added later. Make the file readable only by you; `rer deploy` refuses it otherwise. Git ignores files named `.env…`, so it never ends up in a commit.

```sh
chmod 600 .env.pantry
```

## 4. Deploy

```sh
rer deploy --env-file .env.pantry
```

`rer deploy` builds Pantry, creates its Worker and database on your account, and checks that it answers. It ends by printing the address, for example `Your application is live on your Cloudflare account at https://pantry-production.yourbusiness.workers.dev`, and claims you as the hosted owner.

Open that address and sign in with your owner email: Pantry emails you a sign-in link. If the email does not arrive, check the mail provider's dashboard for the message; `rer signin --env-file .env.pantry` also prints a one-time owner sign-in link in the terminal, without email.

The hosted Pantry starts with its own, empty books, and you set the business up there as you did here. The books on this computer stay where they are.

## Keep it current

- **Update Pantry**: in the `run-pantry` folder, `git pull`, then `rer deploy --env-file .env.pantry` again. Your books stay.
- **Change one key**: put the new value in `.env.pantry`, then `rer deploy --set-secret NAME --env-file .env.pantry`.
- **Keep the `.rer` folder.** It records what `rer deploy` created on your account, so later deploys update the same Pantry. Deploy from the same folder each time.
- **Take it down**: `rer deploy --remove --yes --env-file .env.pantry` deletes the Worker and database it created, and checks that both are gone. Export your books first.

If a deploy stops with `token-scope-missing-workers` or `token-scope-missing-d1`, the API token lacks that permission: edit it in Cloudflare and run the same command again. `workers-subdomain-missing` means step 1 is not done yet.
