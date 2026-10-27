import { demoSockets } from './src/modules/demo/vite.mjs'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { isIP } from 'node:net'
import { watchFile, unwatchFile } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { archiveOutputGuard } from '@runeditrun/rer/archive-output'
// @ts-expect-error The installer reader is plain JavaScript, loaded only by Vite in Node.
import { readBusinessCarry } from './scripts/installer/business-carry.mjs'

// Only `vite dev` loads the local-only entry and the checkout's dev key; a build
// keeps src/server.ts and never sees either (rer build checks its output).
const local = (name: string) => process.env[name] ? { [name]: process.env[name] } : {}
const serve = () => {
  const business = process.env.RER_DEMO === '1' ? null : readBusinessCarry()
  return { main: './src/server.dev.ts', vars: { ...local('RER_DEMO'), ...local('RER_DEMO_EXPIRES'), ...local('RER_DEV_ORIGIN'), ...local('RER_DEV_KEY'), ...local('RER_DEV_IDENTITY'), ...local('RER_MODELS_SERVICE'), ...local('RER_MODELS_KEY'), ...(business ? { RER_BUSINESS: business } : {}) } }
}

function businessCarryWatch(): Plugin {
  return {
    name: 'pantry-business-carry', apply: 'serve',
    configureServer(vite) {
      if (process.env.RER_DEMO === '1') return
      const path = resolve(vite.config.root, '.rer/local/business.json')
      let timer: ReturnType<typeof setTimeout> | undefined
      const changed = (current: import('node:fs').Stats, previous: import('node:fs').Stats) => {
        if (current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs && current.ino === previous.ino) return
        clearTimeout(timer)
        timer = setTimeout(() => { void vite.restart().catch(error => vite.config.logger.error(String(error))) }, 150)
      }
      // Poll the file itself so creation is noticed even before its parents exist.
      watchFile(path, { interval: 250, persistent: false }, changed)
      vite.httpServer?.once('close', () => { clearTimeout(timer); unwatchFile(path, changed) })
    },
  }
}

// `vite dev` serves only the folders the app is built from (and what they
// import, plus the public run site declaration its identity reads), never the rest of the checkout: not rer's private folders (the dev
// key, installer state), export archives, settings or local data.
const server = { fs: { allow: ['src', 'public', 'node_modules', 'deploy-site.json'], deny: ['**/.rer/**', '**/.seed/**', '**/exports/**', '**/*.rer'] } }

// Cloudflare's Vite adapter creates Worker headers from rawHeaders. Miniflare
// otherwise preserves a caller's CF header or fills it from its internal peer,
// so both Node header representations must use the original listener socket.
function localPeerIp(): Plugin {
  return {
    name: 'pantry-local-peer-ip', apply: 'serve', enforce: 'pre',
    configureServer(vite) {
      vite.middlewares.use((req, _res, next) => {
        const peer = req.socket?.remoteAddress
        delete req.headers['cf-connecting-ip']
        for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
          if (req.rawHeaders[i].toLowerCase() === 'cf-connecting-ip') req.rawHeaders.splice(i, 2)
        }
        if (peer && isIP(peer)) {
          req.headers['cf-connecting-ip'] = peer
          req.rawHeaders.push('cf-connecting-ip', peer)
        }
        next()
      })
    },
  }
}

export default defineConfig(({ command, isPreview }) => ({ server, plugins: [demoSockets(), ...(command === 'serve' && !isPreview ? [localPeerIp(), businessCarryWatch()] : []), cloudflare({ inspectorPort: false, viteEnvironment: { name: 'ssr' }, persistState: { path: process.env.RER_STATE_DIR ?? '.wrangler/state' }, ...(command === 'serve' && !isPreview ? { config: serve() } : process.env.RER_DEV_ORIGIN ? { config: { vars: local('RER_DEV_ORIGIN') } } : {}) }), tanstackStart(), react(), archiveOutputGuard()] }))
