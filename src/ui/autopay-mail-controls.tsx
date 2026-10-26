import { command, Field, Form, type D } from './kit'

export function AutopayMailControls({ customerId, recipients, reload }: { customerId: string; recipients: D[]; reload: () => Promise<void> }) {
  return <details className="details"><summary>Retry email preferences</summary>
    <p>Emails wait until 08:00–18:00 in both the business and recipient time zones. Record a bounce or complaint reported by your mail provider to stop retry emails to that address.</p>
    {recipients.map(recipient => <div key={`${recipient.recipient}-${recipient.revision}`}>
      <h3>{recipient.recipient}</h3>
      <p>{recipient.suppression ? `Stopped: owner-recorded ${recipient.suppression}. ${recipient.reason}` : 'No bounce or complaint recorded.'}</p>
      <Form label={recipient.suppression ? 'Confirm email preference' : 'Record email preference'} onDone={reload} submit={body => command('autopay.policy', { customerId, mailControl: {
        recipient: recipient.recipient, revision: recipient.revision, timeZone: body.timeZone,
        suppression: body.suppression || null, reason: body.reason, confirmReset: body.confirmReset === 'on',
      } })}>
        <Field label={`Email time zone for ${recipient.recipient}`} name="timeZone" required defaultValue={recipient.timeZone} placeholder="America/New_York" />
        <Field label="Observed email outcome" name="suppression" defaultValue={recipient.suppression ?? ''} empty="No suppression" options={[{ value: 'bounced', label: 'Bounced' }, { value: 'complained', label: 'Complaint' }]} />
        <Field label="Email outcome reason" name="reason" required defaultValue={recipient.reason} maxLength={500} />
        {recipient.suppression && <label className="check"><input type="checkbox" name="confirmReset" /> I confirm that clearing this outcome permits future retry emails to this address.</label>}
      </Form>
    </div>)}
  </details>
}
