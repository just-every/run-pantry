import { resource } from './model'

// Owner-selected business records only. Member delegation and financial policy
// remain native; references do not grant customer, item or invoice read access.
// Read the retained native attribution directly so erasure markers stay erased.
export const timeResources = [
  resource('time-projects', 'time-projects:read', 'pt_time_projects',
    'id,customer_id,name,active,revision',
    { customerId: 'customer_id', name: 'name', active: 'active' },
    'Native customer time projects, including inactive retained projects; no member assignments or security policies.'),
  resource('time-entries', 'time-entries:read', 'pt_time_entries',
    'id,person_email,recorded_by,customer_id,project_id,item_id,work_date,minutes,note,invoice_id,revision,created_at',
    { personEmail: 'person_email', customerId: 'customer_id', projectId: 'project_id', itemId: 'item_id', date: 'work_date', invoiceId: 'invoice_id' },
    'Native recorded service minutes and attribution, notes and invoice references, preserving erased attribution; no rates, amounts or billing authority.'),
]
