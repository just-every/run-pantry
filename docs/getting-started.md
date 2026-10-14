Pantry runs on your own computer. You need Node 22 or later and pnpm 10.12.4, on macOS, Linux or Windows with WSL2. Pantry is MIT licensed: there is nothing to buy and no account to create.

## Install rer

`rer` is the Run Edit Run command that installs, starts, backs up and restores Pantry. Install it once per computer:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
```

If you prefer npm, `npm install -g @runeditrun/rer` installs the same command.

## Get Pantry and start it

```sh
git clone https://github.com/just-every/run-pantry.git pantry
cd pantry && rer dev
```

The first start installs everything Pantry needs, which can take a few minutes. When it is ready, `rer dev` prints two lines:

- `RER_READY` with the address Pantry answers on, such as `http://127.0.0.1:8787`.
- `RER_OPEN` with a link that opens Pantry signed in as you, the owner. Treat that link like a password: it works for anyone who has it.

Open the `RER_OPEN` link in your browser on the same computer.

## Finish setup

The first time you sign in, Pantry asks you to confirm the owner of this installation. Check your name and email, tick **I confirm this owner account is ready to use.** and choose **Finish setup**. Pantry then opens **Overview**, with the five setup steps described in [Your first month](/docs/first-month).

## Stop and start again

```sh
rer dev --stop
```

Run `rer dev` again from the same folder whenever you want to work in your books. Your data stays in that folder between runs; [Back up and restore](/docs/backup) explains how to keep a copy somewhere else.
