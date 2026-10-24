[Or let Run Edit Run host it](https://runeditrun.com).

Pantry runs on your own computer first. To reach it from anywhere, send invoices by email and let your accountant sign in, put it online on your own Cloudflare account. `rer deploy` does the work from the `run-pantry` folder on your computer; it takes about ten minutes the first time.

## What you need

- **Pantry set up on this computer** ([Getting started](/docs/getting-started)). Stop it before you deploy (step 4): `rer deploy` refuses while it runs.
- **A Cloudflare account.** Sign up free at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Pantry runs on Cloudflare Workers with a D1 database; Cloudflare's free Workers plan is enough to start, and [Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/) gives its limits.
- **A domain of your own**, such as `yourbusiness.com`, to send mail from. No domain yet? Buy one in the Cloudflare dashboard under **Domain Registration → Register Domains**, or from any registrar. With the domain on your Cloudflare account, [forwarding receipts by email](/docs/receipts#forward-receipts-by-email) works too; without it, photos and uploads still do.
- **A mail provider account** (Resend or SendGrid) with that domain verified, so the hosted Pantry can email your sign-in links and invoices. [Connections and keys](/docs/connections#mail) walks through it.

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
OWNER_EMAIL=you@example.com
CLOUDFLARE_ACCOUNT_ID=your account ID
CLOUDFLARE_API_TOKEN=the token
MAIL_PROVIDER=resend
MAIL_API_KEY=your mail provider's API key
MAIL_FROM=billing@example.com
```

- `OWNER_EMAIL` is your own mailbox: the hosted Pantry's owner, where your sign-in links go. Without it, `rer deploy` uses the address Pantry on this computer was first set up with, which is a placeholder ending in `.test` if you started with `rer dev just-every/run-pantry`, and no mail reaches that. **People & settings → Put Pantry online** on this computer shows these lines with your own email filled in; while you still sign in with the placeholder, it asks for your email first.
- `MAIL_PROVIDER` is `resend` or `sendgrid`.
- `MAIL_FROM` is the address alone, with no name: `rer deploy` refuses `Your Business <billing@…>`. Invoices and reminders show your business's legal name as the sender, and sign-in and invitation emails show Pantry.

Keys for bank feeds, Gusto or Xero ([Connections and keys](/docs/connections)) can go in the same file now, or be added later. Make the file readable only by you; `rer deploy` refuses it otherwise. Git ignores files named `.env…`, so it never ends up in a commit.

```sh
chmod 600 .env.pantry
```

## 4. Deploy

Stop Pantry on this computer first: `rer deploy` refuses while it runs. Start it again with `rer dev` whenever you like; the books on this computer stay.

```sh
rer dev --stop
rer deploy --env-file .env.pantry
```

`rer deploy` builds Pantry, creates its Worker and database on your account, and checks that it answers. It ends by printing the address, for example `Your application is live on your Cloudflare account at https://pantry-production.yourbusiness.workers.dev`, and claims your `OWNER_EMAIL` as the hosted owner.

Open that address and sign in with your owner email: Pantry emails you a sign-in link. If the email does not arrive, check the mail provider's dashboard for the message; `rer signin --env-file .env.pantry` also prints a one-time owner sign-in link in the terminal, without email.

The hosted Pantry starts with its own, empty books, and you set the business up there as you did here. The books on this computer stay where they are.

## Keep it current

- **Update Pantry**: in the `run-pantry` folder, `git pull`, then `rer deploy --env-file .env.pantry` again. Your books stay.
- **Change one key**: put the new value in `.env.pantry`, then `rer deploy --set-secret NAME --env-file .env.pantry`.
- **Keep the `.rer` folder.** It records what `rer deploy` created on your account, so later deploys update the same Pantry. Deploy from the same folder each time.
- **Back up the hosted books**: `rer run hosted-backup --env-file .env.pantry` saves the hosted database, with every receipt and document in it, to the `exports` folder ([Back up and restore](/docs/backup#back-up-a-hosted-pantry)). Add `--environment NAME` if you deployed with one. `rer export` does not do this: it saves only the books on this computer.
- **Take it down**: export your hosted books first, because taking it down deletes them:

  ```sh
  rer run hosted-backup --env-file .env.pantry
  rer deploy --remove --yes --env-file .env.pantry
  ```

  The second command deletes the Worker and database `rer deploy` created, and checks that both are gone. If you deployed with `--environment NAME`, add `--environment NAME` to both commands; without it they act on the `production` deployment, not yours.

If an earlier update stopped at `0018_bank_rules_feeds.sql` with `FOREIGN KEY constraint failed`, Cloudflare rolled that step back and your books are as they were, but the unfinished step is still recorded, so the next deploy says the database "holds migration history this build does not match". Update Pantry (`git pull`), clear that record with your Cloudflare token from `.env.pantry`, and deploy again:

```sh
set -a; . ./.env.pantry; set +a
npx wrangler d1 execute pantry-production-db --remote --command "DELETE FROM d1_migrations WHERE name='0018_bank_rules_feeds.sql' AND state='applying'"
rer deploy --env-file .env.pantry
```

If you deployed with `--environment NAME`, the database is `pantry-NAME-db` and the deploy takes `--environment NAME` too.

If a deploy stops with `token-scope-missing-workers` or `token-scope-missing-d1`, the API token lacks that permission: edit it in Cloudflare and run the same command again. `workers-subdomain-missing` means step 1 is not done yet.
