import { demoSockets } from './src/modules/demo/vite.mjs'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { isIP } from 'node:net'
import { defineConfig, type Plugin } from 'vite'
import { archiveOutputGuard } from '@runeditrun/rer/archive-output'

// Only `vite dev` loads the local-only entry and the checkout's dev key; a build
// keeps src/server.ts and never sees either (rer build checks its output).
const local = (name: string) => process.env[name] ? { [name]: process.env[name] } : {}
const serve = { main: './src/server.dev.ts', vars: { ...local('RER_DEMO'), ...local('RER_DEMO_EXPIRES'), ...local('RER_DEV_ORIGIN'), ...local('RER_DEV_KEY'), ...local('RER_DEV_IDENTITY'), ...local('RER_MODELS_SERVICE'), ...local('RER_MODELS_KEY') } }

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

export default defineConfig(({ command, isPreview }) => ({ server, plugins: [demoSockets(), ...(command === 'serve' && !isPreview ? [localPeerIp()] : []), cloudflare({ inspectorPort: false, viteEnvironment: { name: 'ssr' }, persistState: { path: process.env.RER_STATE_DIR ?? '.wrangler/state' }, ...(command === 'serve' && !isPreview ? { config: serve } : process.env.RER_DEV_ORIGIN ? { config: { vars: local('RER_DEV_ORIGIN') } } : {}) }), tanstackStart(), react(), archiveOutputGuard()] }))
