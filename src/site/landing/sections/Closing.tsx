import { Actions } from '../../shell/Actions'
import { SiteFooter } from '../../shell/SiteFooter'
import { Painting } from '../parts'

/** The closing promise over the lookout at full light, with the footer on the rock. */
export function Closing() {
  return <section className="closing" aria-labelledby="closing-title">
    <Painting className="closing-art" name="closing" widths={[768, 1152, 1536]} sizes="100vw" />
    <div className="site-wrap closing-copy">
      <h2 id="closing-title">Close the month with your coffee hot.</h2>
      <p className="closing-sub">Open source accounting for US small businesses.</p>
      <Actions demo={false} />
      <p className="closing-small">Free and open source, MIT licensed.</p>
    </div>
    <SiteFooter tone="on-art" />
  </section>
}
