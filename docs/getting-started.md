Copy this line into your terminal, then press Enter:

<!-- rer:launch -->
```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-pantry
```
<!-- /rer:launch -->

<!-- rer:requirements -->
macOS, Linux or Windows with WSL2. git is required; rer brings Node and pnpm.
<!-- /rer:requirements -->

It installs `rer`, the Run Edit Run command, and starts Pantry. This copy is free and MIT licensed. Its books stay on this computer; it sends no email, and your accountant cannot sign in from another computer. To share it online, read [Put Pantry online](/docs/hosting).

Already have Node 22 or later? This alternative starts the same Pantry:

<!-- rer:alternative -->
```sh
npx -y @runeditrun/rer dev just-every/run-pantry
```
<!-- /rer:alternative -->

## Before you start

Use a Mac, Linux computer, or Windows with [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) installed. On a Mac, open **Terminal** from Applications → Utilities. On Linux, open your terminal app. On Windows, open your installed WSL distribution, such as Ubuntu.

Check that Git is installed by typing `git --version` and pressing Enter. If it reports that the command is missing, follow [Git's installation guide](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) for your system, then reopen the terminal. Choose a folder in which to keep your books; the start line above creates a `run-pantry` folder there.

Allow several minutes for the first start to download and build everything. The time depends on your computer and connection; progress appears in the terminal. Later starts reuse the installation.

## Start Pantry

If the installer prints a command for future terminal windows, run it so `rer` stays available when you start again.

`rer` gets Pantry into a `run-pantry` folder. To start it again later, run `cd run-pantry && rer dev`.

This copy runs only on your computer, so invoices can't be emailed and your accountant can't sign in until it is online. [Put Pantry online](/docs/hosting), or [let Run Edit Run host it](https://runeditrun.com).

When it is ready, the terminal prints:

- `RER_READY` with the address Pantry answers on, such as `http://127.0.0.1:8787`.
- `RER_OPEN` with a link that opens Pantry signed in as you, the owner. Treat that link like a password: it works for anyone who has it.

Open the `RER_OPEN` link in your browser on the same computer. Keep the terminal open while you use Pantry. If startup stops, read its last message and follow the next command it gives. If the terminal was closed or startup was interrupted, open the `run-pantry` folder in a terminal and run `rer dev` again; it resumes rather than replacing your books. When asking for help, share the error message, never the `RER_OPEN` link or a private settings file.

## Finish setup

The first time you sign in, Pantry asks you to confirm the owner of this installation. It shows the owner's name and email (on your own computer the name starts as "Owner"); you change both later in **People & settings › You, the owner**. Tick **I confirm this owner account is ready to use.** and choose **Finish setup**. Pantry then opens **Overview**, with the five setup steps described in [Your first month](/docs/first-month).

## Stop and start again

```sh
rer dev --stop
```

To return later, open Terminal, run `cd run-pantry` from the folder where you started, then run `rer dev`. If you already have a checkout under another name, open that folder instead. Your data stays in that folder between runs; [Back up and restore](/docs/backup) explains how to keep a copy somewhere else.
