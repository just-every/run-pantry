export const NOTICE_SUBJECT = 'Automatic payment failed: invoice {{invoice}}'
export const NOTICE_BODY = '{{business}}\nInvoice {{invoice}}\n\nThe automatic payment of {{amount}} failed. {{next_retry}}\nYou can revoke automatic payment from your invoice’s autopay controls or contact the business.\n'

export function renderNotice(template: string, values: Record<string,string>) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => values[key] ?? '')
}
