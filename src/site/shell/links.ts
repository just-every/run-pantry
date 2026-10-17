// Where the run site's links go. The run site never links an instance-only route (/signin, /setup, /app).
import run from '../run.json'

export const links = { home: '/', run: '/run', docs: '/docs', contract: '/contract', source: run.repository, demo: 'https://demo.run-pantry.com/' }
export const docsPath = (slug: string) => `/docs/${slug}`
