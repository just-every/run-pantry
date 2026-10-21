import { decoded, pick, resource } from './model'

export const definitionResources = [
  resource('custom-reports', 'custom-reports:read', 'pt_custom_reports', 'id,name,definition,revision,created_at,updated_at', { name: 'name' }, 'Saved custom-report definitions under explicit owner-delegated consent. Native person sharing is separate; no shares, creator identity or calculated report snapshot.', { project: row => {
    const definition = decoded(row.definition)
    row.definition = pick(definition, 'name,source,from,to,basis,columns,allColumns,comparison,grouping,notes')
    if (definition.filters) row.definition.filters = pick(definition.filters, 'accountIds,accountTypes,contactIds')
    if (definition.layout) row.definition.layout = definition.layout.map((r: Record<string, unknown>) => pick(r, 'id,kind,label,accountIds,accountTypes,rowIds,expression,unit,text'))
    return row
  } }),
  resource('management-packages', 'management-packages:read', 'pt_management_packages', 'id,name,definition,revision,created_at,updated_at', { name: 'name' }, 'Management package definition and report references; no report calculations, role sharing or delivery data.', { project: row => { row.definition = pick(decoded(row.definition), 'name,cover,commentary,reportIds'); return row } }),
]

// Only business subject families. Owner/security/credential/erasure/retention/
// subscription audit rows never become discoverable through this metadata door.
const businessKinds = "'account','customer','vendor','contact','invoice','credit','bill','payment','vendor-credit','journal','document','statement','bank-account','bank-line','match','reconciliation','reconciliation-undo','bank-rule','rule','transfer','transfer-pair','recurring','recurring-bill','recurring-journal','recognition','recognition-schedule','budget','check','check-batch','period','close-task','fiscal-year','question','proposal','note','review-note','reclassification','item','tax-code','exemption','exemption-certificate','contractor','custom-report','management-package','receipt','cutover','nexus-decision'"
export const metadataResources = [
  resource('audit-events', 'audit-events:read', 'pt_audit', 'id,at,actor_kind,action,subject_kind,subject_id,subject_revision,approval_id,origin_kind', { subjectKind: 'subject_kind', subjectId: 'subject_id', action: 'action' }, 'Business event metadata only: no actor email, credential authority, detail, before-state or arbitrary snapshots. Owner/security events excluded.', { where: `subject_kind IN (${businessKinds})` }),
  resource('approvals', 'approvals:read', 'pt_approvals', 'id,subject_kind,subject_id,subject_revision,action,decision,at', { subjectKind: 'subject_kind', subjectId: 'subject_id', decision: 'decision' }, 'Business approval metadata only: no actor identity, decision note, security actions or approval capability.', { where: `subject_kind IN (${businessKinds})` }),
]
