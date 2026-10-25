# Fonts

Three families, each self-hosted under the SIL Open Font License 1.1 with its
licence beside the files:

| Family | Use | Files | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Schibsted Grotesk | headings and the Pantry wordmark (app and run site); the app's body | `schibsted-grotesk/` (Latin, Latin Extended; weights 400–900) | `schibsted-grotesk/LICENSE.txt` | https://github.com/schibsted/schibsted-grotesk |
| Figtree | the run site's body text | `figtree/` (Latin, Latin Extended; weights 300–900) | `figtree/LICENSE.txt` | https://github.com/erikdkennedy/figtree |
| JetBrains Mono | code, the terminal and the receipt on the run site | `jetbrains-mono/` (Latin; weights 100–800) | `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono |

The variable WOFF2 subsets come from Fontsource's distributions
(`@fontsource-variable/*` 5.3.0 for Figtree and JetBrains Mono).

Every page links `/fonts/fonts.css` once, outside the temporary dev SSR
stylesheet, and preloads only the primary Latin file it needs first. Do not
import this CSS from a component. Every app body-font stack uses `--font-body`,
including the local `Schibsted Grotesk Fallback` before generic fallback fonts;
controls inherit it. A family is downloaded only by a page that uses it.

`fonts.css` also carries the rest of Pantry's look: its own tokens, Base's
other `--rer-*` names and the rules that dress Base's pages.
`/rer-theme.css` holds only what rer's theme reader takes (the `--rer-*` theme
tokens and these faces, which the installer reads from it), so both files
declare the same faces: change both.

Fallback scales use Schibsted Grotesk/Arial advance-width ratios over A-Z, a-z
and 0-9 at weights 400, 500 and 700. Ascent, descent and line gap match the
font's 980, -260 and 0 per 1000 units, divided by each scale. Matching metrics
reduces layout movement; different glyph designs cannot have identical widths in
every piece of text. Recalculate the fallback and preload when changing the brand font.
