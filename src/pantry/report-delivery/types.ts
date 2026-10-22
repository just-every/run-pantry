import type { ReportIssue } from '../effects/issues'
export type Selection = { kind: 'report' | 'custom-report' | 'management-package' | 'accountant-package'; id?: string; report?: string; query?: Record<string, string>; rangeMode?: 'saved' | 'occurrence' }
export type Format = 'pdf' | 'xlsx' | 'csv'
export type Schedule = { id: string; revision: string; name: string; selection: string; format: Format; cadence: 'weekly' | 'monthly' | 'month-lock'; weekday: number; month_day: number; recipients: string; active: number; consent: number; creator_id: string; creator_email: string; creator_version: number; activated_at: string; activated_day: string; lock_watermark: number; time_zone: string }
export type Occurrence = { key: string; from: string; to: string; due: string }
export type Delivery = { bytes: Uint8Array; filename: string; contentType: string; name: string; issue: ReportIssue; from: string; to: string; basis: string }
export type MailResult = { status: 'accepted' | 'rejected' | 'rate_limited' | 'uncertain' | 'development'; provider: string; providerMessageId: string | null; code?: string }
