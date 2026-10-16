import { Check, Painting } from '../parts'

/** The one painted band between the stories: the lake at sunrise, the books up to date. */
export function Interlude() {
  return <section className="interlude" aria-label="Books up to date as of Oct 31">
    <Painting className="interlude-art" name="interlude" widths={[768, 1152, 1536]} sizes="100vw" />
    <p className="interlude-badge"><Check />Books up to date · Oct 31</p>
  </section>
}
