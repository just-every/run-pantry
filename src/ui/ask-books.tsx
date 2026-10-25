import { useState } from 'react'
import { Action, api, Card, command, Field, Form, usd, type D } from './kit'
export function AskBooks() {
  const [answer, setAnswer] = useState<D | null>(null)
  return (
    <Card title="Ask the books">
      <p>
        Ask about contractor spending or net income. Name a month or quarter; an omitted year means the current UTC
        year. Figures use posted reports; contractor spending means expense accounts containing “contract”.
      </p>
      <Form
        label="Ask the books"
        submit={async (b) => {
          setAnswer(null)
          return api('ask?' + new URLSearchParams({ question: String(b.question), basis: String(b.basis) }))
        }}
        onDone={async (a) => setAnswer(a)}
        className="grid-form"
      >
        <Field
          label="Book question"
          name="question"
          maxLength={160}
          required
          hint="Why is net income down in October 2026?"
        />
        <Field
          label="Answer basis"
          name="basis"
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'accrual', label: 'Accrual' },
          ]}
          required
        />
      </Form>
      {answer && (
        <div role="status">
          <h3>Generated answer · {answer.status}</h3>
          <p>{answer.scope}</p>
          <p>
            {answer.basis} basis ·{' '}
            {answer.changeCents === null ? 'Comparison has no records' : `Change: ${usd(answer.changeCents)}`}
          </p>
          <p>Account movements explain the change:</p>
          <ul>
            {answer.movements.map((m: D) => (
              <li key={m.accountId}>
                {m.accountName}: {usd(m.changeCents)}
              </li>
            ))}
          </ul>
          {answer.figures.map((f: D, i: number) => (
            <section key={f.from}>
              <h4>
                {f.from} to {f.to}: {f.records ? usd(f.amountCents) : 'No records'}
              </h4>
              <a href={answer.citations[i].href}>{answer.citations[i].label}</a>
              <details>
                <summary>Posted lines used ({f.records})</summary>
                <ul>
                  {f.lines.map((l: D, j: number) => (
                    <li key={j}>
                      <a href={l.href}>
                        {l.date} · {l.memo || 'Journal entry'} · {usd(l.amountCents)}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          ))}
          {answer.status === 'answered' && (
            <Action
              run={async () => {
                const r = await command('custom-report.save', { definition: answer.definition })
                window.location.assign('/app/reports?report=custom&customId=' + encodeURIComponent(r.id))
              }}
            >
              Save answer as custom report
            </Action>
          )}
        </div>
      )}
    </Card>
  )
}
