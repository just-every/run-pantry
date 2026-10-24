import { installRer } from '../base/run-site'
import { SiteHeader } from './shell/SiteHeader'
import { SiteFooter } from './shell/SiteFooter'
import { TitleDots } from './docs/TitleDots'
import run from './run.json'
import './styles/site.css'
import './styles/cards.css'
import './styles/docs.css'

function Code({ children }: { children: string }) {
  return <div className="docs-code"><div className="docs-code-head"><button className="docs-copy" hidden type="button">Copy</button></div><pre><code>{children}</code></pre></div>
}

export function RunPage() {
  return <><SiteHeader /><div className="docs-page"><div className="site-wrap"><main id="main" className="docs-main run-guide">
    <header className="docs-page-head"><p className="eyebrow-docs">On your computer</p><h1>Run Pantry</h1><TitleDots /><p className="docs-summary">Your own copy of Pantry. Free and MIT licensed.</p></header>
    <div className="docs-prose">
      <h2>Before you start</h2>
      <p>On a Mac, open Terminal (Applications › Utilities). On Windows, Pantry runs inside <a href="https://learn.microsoft.com/windows/wsl/install">WSL2</a>; install it and open its terminal. On Linux, open your terminal.</p>
      <p>Check that git is installed by running <code>git --version</code>. The first start can take a few minutes.</p>
      <p>Not comfortable with a terminal? <a href="https://runeditrun.com">Let us run it</a>.</p>
      <h2>Start Pantry</h2><Code>{`${installRer} -s -- dev ${new URL(run.repository).pathname.slice(1)}`}</Code>
      <p>This installs rer, gets Pantry into a <code>{run.folder}</code> folder and starts it. Git is required; the installer brings Node when needed, and rer brings pnpm.</p>
      <p>If the installer prints a command for future terminal windows, run it so rer stays available when you start again.</p>
      <p>Already have Node 22 or later? You can start the same Pantry with this alternative:</p><Code>{run.clone}</Code>
      <p>Keep this terminal open while you use Pantry.</p>
      <h2>What success looks like</h2>
      <p>When Pantry is ready, the terminal shows its address and a private link that opens Pantry signed in as you. Open the RER_OPEN link on this computer. Keep it private, like a password.</p>
      <Code>{'RER_READY http://127.0.0.1:8787\nRER_OPEN http://127.0.0.1:8787/<private-sign-in-link>'}</Code>
      <p>Confirm your owner account on the setup screen, then start your books.</p>
      <h2>Start again later</h2><Code>{`cd ${run.folder} && rer dev`}</Code>
      <h2>Use Pantry with other people</h2>
      <p>This copy runs only on your computer, so invoices can't be emailed and your accountant can't sign in until it is online.</p>
      <p><a href="/docs/hosting">Put Pantry online</a>, or <a href="https://runeditrun.com">Or let Run Edit Run host it</a>.</p>
      <p><a href="/docs/getting-started">Getting started</a> walks through your first setup.</p>
    </div>
  </main></div></div><SiteFooter /></>
}
