// The run site (run-pantry.com) as `rer build --site` writes it: a visitor reaches /run from the homepage's
// primary action, every page's links and files resolve inside the site, and no page links an instance-only route.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('../..', import.meta.url).pathname
const site = join(root, 'dist/site')
const pages = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? pages(join(dir, entry.name)) : entry.name.endsWith('.html') ? [join(dir, entry.name)] : [])
const served = path => [path, `${path}.html`, join(path, 'index.html')].some(candidate => existsSync(join(site, candidate)) && !candidate.endsWith('/'))
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1].replaceAll('&amp;', '&'))

test('the run site builds, its primary action opens /run, and every link and file it names resolves', () => {
  execFileSync(join(root, 'node_modules/.bin/rer'), ['build', '--site'], { cwd: root, stdio: 'pipe' })
  const home = readFileSync(join(site, 'index.html'), 'utf8')
  assert.match(home, /<a class="site-pill" href="\/run">/, 'the homepage leads with Run Pantry to /run')
  assert.ok(served('run'), '/run is built')
  const run = JSON.parse(readFileSync(join(root, 'src/site/run.json')))
  const text = html => html.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&')
  const commands = [`curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev ${new URL(run.repository).pathname.slice(1)}`, run.clone]
  for (const path of ['index.html', 'run.html', 'docs/getting-started.html']) {
    const html = readFileSync(join(site, path), 'utf8'), content = text(html)
    for (const command of commands) assert.ok(content.includes(command), `${path} offers ${command}`)
    assert.doesNotMatch(content, /git clone|rer install|rer setup/, `${path} uses the canonical start procedure and declared Node alternative`)
  }
  const guide = readFileSync(join(site, 'run.html'), 'utf8')
  const started = readFileSync(join(site, 'docs/getting-started.html'), 'utf8')
  for (const html of [guide, started]) assert.ok(text(html).includes(`cd ${run.folder} && rer dev`), 'restart uses the declared folder')
  for (const href of ['https://runeditrun.com', '/docs/hosting']) assert.ok(attrs(guide, 'href').includes(href), `/run links ${href}`)
  assert.ok(served('contract'), '/contract remains available')
  const all = pages(site)
  assert.ok(all.length > 3, 'the homepage, /run, the docs and the not-found page')
  for (const file of all) {
    const html = readFileSync(file, 'utf8'), where = relative(site, file)
    const mainNav = html.match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/)?.[1]
    if (mainNav) assert.ok(!attrs(mainNav, 'href').includes('/contract'), `${where} keeps contributor progress out of the main nav`)
    const refs = [...attrs(html, 'href'), ...attrs(html, 'src'), ...attrs(html, 'srcSet').concat(attrs(html, 'srcset')).flatMap(set => set.split(',').map(part => part.trim().split(/\s+/)[0]))]
    for (const ref of refs.filter(ref => ref.startsWith('/') && !ref.startsWith('//'))) {
      const path = decodeURIComponent(ref.split(/[?#]/)[0])
      assert.doesNotMatch(path, /^\/(signin|login|sign-in|setup|app|auth)(\/|$)/, `${where} links the instance-only ${path}`)
      if (path !== '/') assert.ok(served(path), `${where} names ${path}, which the site does not serve`)
    }
  }
})
