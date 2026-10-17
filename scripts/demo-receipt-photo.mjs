// Draws the demo's Home Depot receipt photo, the receipt the homepage shows,
// and writes its pixels to src/demo/receipt-photo-data.ts. The demo stamps its
// own date into the photo when it seeds (src/demo/receipt-photo.ts), so the
// pixels keep the date's digit cells and one strip of the digits 0-9 in the
// same face. Run: node scripts/demo-receipt-photo.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const font = `data:font/woff2;base64,${(await readFile(new URL('../public/fonts/jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2', import.meta.url))).toString('base64')}`
const CELL = 9 // CSS px per character: JetBrains Mono at 14.5px is 8.7px wide; whole pixels keep cells copyable
const cells = text => [...text].map(ch => `<span class="c">${ch}</span>`).join('')

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'JetBrains Mono'; src: url('${font}') format('woff2'); font-weight: 100 800; }
html, body { margin: 0; background: #e2dfeb; }
.desk { position: relative; width: 480px; height: 490px; background: #e2dfeb; }
.paper { position: absolute; left: 35px; top: 26px; width: 358px; padding: 22px 26px 26px; background: #fff; font: 500 14.5px/20px 'JetBrains Mono', monospace; color: #2a2a32;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08), 0 18px 30px -16px rgba(16, 26, 51, .4);
  clip-path: polygon(0 1%, 6% 0, 13% .8%, 22% 0, 31% .9%, 40% 0, 50% 1%, 60% 0, 70% .8%, 80% 0, 89% 1%, 100% 0, 100% 99%, 93% 100%, 85% 99.2%, 75% 100%, 64% 99%, 52% 100%, 41% 99.2%, 30% 100%, 19% 99%, 9% 100%, 0 99.2%); }
p { margin: 0; }
.head { display: flex; align-items: center; gap: 14px; }
.logo { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 8px; background: #f26f21; color: #fff; font: 800 19px/1 Arial, sans-serif; }
.name { font-weight: 700; font-size: 15.5px; letter-spacing: .02em; }
.store { margin-top: 12px; padding-left: 66px; }
.row { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; white-space: pre; }
.sums { margin-top: 14px; padding-left: 150px; }
.sums .row { margin-top: 2px; }
.sums .total { margin-top: 11px; font-weight: 700; }
.c { display: inline-block; width: ${CELL}px; height: 20px; text-align: center; vertical-align: top; }
.thanks { margin-top: 18px; text-align: center; }
.meta { position: relative; }
#date { position: absolute; left: 186px; top: 0; }
.strip { position: absolute; left: 0; top: 700px; padding: 0; background: #fff; font: 500 14.5px/20px 'JetBrains Mono', monospace; color: #2a2a32; }
</style>
<div class="desk"><div class="paper">
  <div class="head"><span class="logo">HD</span><span class="name">HOME DEPOT<br>STORE 0607</span></div>
  <p class="store">1234 EL CAMINO REAL<br>SAN BRUNO, CA 94066</p>
  <p class="row meta"><span>0607  00062  48872</span><span id="date">${cells('10/13/26')}</span><span>14:27</span></p>
  <p class="row"><span>1001372715  2X4-8FT STUD<br>      6 @ 2.06</span><span><br>12.36</span></p>
  <p class="row"><span>0000-345-276  DEWALT DRILL</span><span>279.00</span></p>
  <div class="sums"><p class="row"><span>SUBTOTAL</span><span>291.36</span></p><p class="row"><span>SALES TAX 7.25%</span><span>21.12</span></p>
    <p class="row total"><span>TOTAL</span><span>$312.48</span></p></div>
  <p class="row"><span>AMEX  •••• 1009</span><span>$312.48</span></p>
  <p class="thanks">THANK YOU FOR SHOPPING<br>THE HOME DEPOT</p>
</div></div>
<div class="strip" id="strip">${cells('0123456789')}</div>`

const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
try {
  const page = await (await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 480, height: 760 } })).newPage()
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  if (!await page.evaluate(() => document.fonts.check("500 14.5px 'JetBrains Mono'"))) throw new Error('JetBrains Mono did not load')
  const box = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }), sel)
  const date = await box('#date .c'), strip = await box('#strip .c')
  for (const [x, y, w, h] of [...date, ...strip]) if (![x, y, w, h].every(Number.isInteger)) throw new Error(`a digit cell is off the pixel grid: ${[x, y, w, h]}`)
  // Pixels as raw RGB, read back through a canvas from the page's own screenshot.
  const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 480, height: 760 } })
  const rgba = await page.evaluate(async b64 => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = canvas.getContext('2d')
    g.drawImage(img, 0, 0); return [...g.getImageData(0, 0, img.width, img.height).data]
  }, shot.toString('base64'))
  const W = 960, rgb = (x0, y0, w, h) => {
    const out = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = rgba[((y0 + y) * W + x0 + x) * 4 + k]
    return out
  }
  const s = 2, [cw, ch] = [CELL * s, 20 * s]
  const photo = { width: 960, height: 980, cell: [cw, ch], digits: [0, 1, 3, 4, 6, 7].map(i => [date[i][0] * s, date[i][1] * s]) }
  const pixels = deflateSync(rgb(0, 0, photo.width, photo.height), { level: 9 }).toString('base64')
  const glyphs = deflateSync(rgb(strip[0][0] * s, strip[0][1] * s, cw * 10, ch), { level: 9 }).toString('base64')
  await writeFile(new URL('../src/demo/receipt-photo-data.ts', import.meta.url), `// Generated by scripts/demo-receipt-photo.mjs: the demo's Home Depot receipt photo as zlib-deflated RGB rows,
// where its date's digits sit, and the digits 0-9 in the receipt's face. Do not edit by hand.
export const PHOTO = ${JSON.stringify(photo)}
export const PIXELS = '${pixels}'
export const DIGITS = '${glyphs}'
`)
  console.log(`receipt photo ${photo.width}x${photo.height}: ${pixels.length + glyphs.length} base64 chars`)
} finally { await browser.close() }
