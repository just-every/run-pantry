import { useState } from 'react'
import { Action, Card, Chip, command, day, Details, Field, Form, monthName, Table, useWho, type D } from './kit'

export function CloseBoard({ board, period, select }: { board: D; period: string; select: (id: string) => void }) {
  return <Card title="Monthly close board">
    <p className="hint">Review tasks and unanswered questions across {board.year}. Open a month to review its calculated checks before locking.</p>
    <details><summary>View all 12 months</summary>
      <Table heads={['Month', 'Period', 'Review tasks', 'Questions waiting', 'Next task due']}>
        {board.months.map((m: D) => <tr key={m.id} aria-current={period === m.id ? 'true' : undefined}>
          <td><a href={`/app/close?period=${m.id}`} onClick={e => { e.preventDefault(); select(m.id) }}>{monthName(m.id)}</a></td>
          <td><Chip tone={m.status === 'locked' ? 'info' : 'neutral'}>{m.status === 'locked' ? 'Locked' : 'Open'}</Chip></td>
          <td>{m.total ? `${m.done} of ${m.total} done` : 'No tasks yet'}</td><td>{m.waiting}</td><td>{day(m.nextDue)}</td>
        </tr>)}
      </Table>
    </details>
  </Card>
}

export function ReviewTasks({ s, canRecord, onChange }: { s: D; canRecord: boolean; onChange: () => Promise<void> }) {
  const who = useWho(), [editing, setEditing] = useState<string | null>(null), [pending, setPending] = useState(false), open = s.status !== 'locked' && canRecord
  const update = async (operation: string, body: D) => {
    setPending(true)
    try {
      const result = await command(operation, body)
      if (operation === 'close.task-save') setEditing(null)
      await onChange()
      return result
    } finally { setPending(false) }
  }
  const people = s.assignees.map((p: D) => ({ value: p.email, label: p.name || p.email }))
  return <Card title="Review tasks" actions={open && (!s.tasks.length || s.checks.some((c: D) => c.key === 'year-end-reviews' && !c.ok)) && <Action tone="primary" disabled={pending} run={() => update('close.tasks', { period: s.id })}>Add the standard review tasks</Action>}>
    <Table heads={['Task', 'Assigned to', 'Due', 'Status', 'Completed by', '']} empty="No review tasks yet. Add the standard ones, or your own.">
      {s.tasks.map((t: D) => <tr key={t.id}><td><strong>{t.title}</strong>{t.note && <small className="sub">{t.note}</small>}{t.judgment_kind && <><p>Accountant judgment: {t.judgment_kind}</p><a href="/app/agents">Review agent evidence</a></>}
        {open && editing === t.id && <Form label="Save review task" submit={b => update('close.task-save', { id: t.id, revision: t.revision, ...b })}>
          <Field label="Task title" name="title" defaultValue={t.title} required />
          <Field label="Task assignee" name="assignee" options={people} defaultValue={t.assignee ?? ''} empty="Unassigned" />
          <Field label="Task due date" name="dueDate" type="date" defaultValue={t.due_date ?? ''} />
          <p className="hint">Saving changes reopens the task for a fresh completion. Assignment does not change anyone’s access.</p>
        </Form>}
      </td><td>{t.assignee ? who(t.assignee) : 'Unassigned'}</td><td>{day(t.due_date)}</td>
        <td>{t.status === 'done' ? <Chip tone="good">Done</Chip> : <Chip tone="warn">Open</Chip>}</td><td>{t.done_by ? <>{who(t.done_by)}, {day(t.done_at)}</> : '—'}</td>
        <td>{open && <div className="row-actions"><Action disabled={pending} run={() => update('close.task', { id: t.id, revision: t.revision, done: t.status !== 'done' })}>{t.status === 'done' ? 'Reopen task' : 'Mark done'}</Action>
          <button type="button" className="btn btn-link" aria-label={`Edit ${t.title}`} disabled={pending} onClick={() => setEditing(editing === t.id ? null : t.id)}>{editing === t.id ? 'Cancel edit' : 'Edit'}</button></div>}</td></tr>)}
    </Table>
    {open && <Form label="Add task" submit={b => command('close.tasks', { period: s.id, ...b })} onDone={onChange}>
      <Field label="New review task" name="title" required />
      <Field label="Assign to" name="assignee" options={people} empty="Unassigned" />
      <Field label="Due date" name="dueDate" type="date" />
    </Form>}
  </Card>
}
