// Economic-nexus thresholds for remote sellers, kept as one versioned table.
// Each row names the state's revenue agency as its source. Alerts and the
// accountant's decisions record the version they were measured against.
// Pantry watches; whether to register stays the accountant's decision.

/** How a state measures: `calendar` the previous calendar year or the current one;
 *  `trailing-12` the 12 months ending today; `ny-quarters` four NY sales tax quarters
 *  (Mar–May, Jun–Aug, Sep–Nov, Dec–Feb); `ct-september` 12 months ending September 30. */
export type Measure = 'calendar' | 'trailing-12' | 'ny-quarters' | 'ct-september'
/** `or`: either figure reaches its threshold; `and`: both must. */
export type Test = 'sales' | 'or' | 'and'
export type Threshold = { state: string; sales: number; transactions: number | null; test: Test; measure: Measure; rule: string; source: string }

export const NEXUS_VERSION = '2026-10-19'
export const NEXUS_NOTE = 'Thresholds as Pantry recorded them from each state revenue agency’s remote-seller guidance on 19 October 2026. Your accountant confirms them before deciding.'
/** States with no statewide sales tax; Pantry does not watch local remote-seller rules. */
export const NO_STATE_TAX = ['AK', 'DE', 'MT', 'NH', 'OR']

const K = 100_000_00
const rows: [string, number, number | null, Test, Measure, string, string][] = [
  ['AL', 250_000_00, null, 'sales', 'calendar', 'Previous calendar year', 'Alabama Department of Revenue · https://www.revenue.alabama.gov'],
  ['AZ', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Arizona Department of Revenue · https://azdor.gov'],
  ['AR', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Arkansas Department of Finance and Administration · https://www.dfa.arkansas.gov'],
  ['CA', 500_000_00, null, 'sales', 'calendar', 'Previous or current calendar year', 'California Department of Tax and Fee Administration · https://www.cdtfa.ca.gov'],
  ['CO', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Colorado Department of Revenue · https://tax.colorado.gov'],
  ['CT', K, 200, 'and', 'ct-september', '12 months ending September 30', 'Connecticut Department of Revenue Services · https://portal.ct.gov/drs'],
  ['DC', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'DC Office of Tax and Revenue · https://otr.cfo.dc.gov'],
  ['FL', K, null, 'sales', 'calendar', 'Previous calendar year', 'Florida Department of Revenue · https://floridarevenue.com'],
  ['GA', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Georgia Department of Revenue · https://dor.georgia.gov'],
  ['HI', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Hawaii Department of Taxation · https://tax.hawaii.gov'],
  ['ID', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Idaho State Tax Commission · https://tax.idaho.gov'],
  ['IL', K, null, 'sales', 'trailing-12', 'Preceding 12-month period', 'Illinois Department of Revenue · https://tax.illinois.gov'],
  ['IN', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Indiana Department of Revenue · https://www.in.gov/dor'],
  ['IA', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Iowa Department of Revenue · https://tax.iowa.gov'],
  ['KS', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Kansas Department of Revenue · https://www.ksrevenue.gov'],
  ['KY', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Kentucky Department of Revenue · https://revenue.ky.gov'],
  ['LA', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Louisiana Department of Revenue · https://revenue.louisiana.gov'],
  ['ME', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Maine Revenue Services · https://www.maine.gov/revenue'],
  ['MD', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Comptroller of Maryland · https://www.marylandtaxes.gov'],
  ['MA', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Massachusetts Department of Revenue · https://www.mass.gov/dor'],
  ['MI', K, 200, 'or', 'calendar', 'Previous calendar year', 'Michigan Department of Treasury · https://www.michigan.gov/taxes'],
  ['MN', K, 200, 'or', 'trailing-12', 'Preceding 12 months', 'Minnesota Department of Revenue · https://www.revenue.state.mn.us'],
  ['MS', 250_000_00, null, 'sales', 'trailing-12', 'Preceding 12 months', 'Mississippi Department of Revenue · https://www.dor.ms.gov'],
  ['MO', K, null, 'sales', 'trailing-12', 'Preceding 12 months', 'Missouri Department of Revenue · https://dor.mo.gov'],
  ['NE', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Nebraska Department of Revenue · https://revenue.nebraska.gov'],
  ['NV', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Nevada Department of Taxation · https://tax.nv.gov'],
  ['NJ', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'New Jersey Division of Taxation · https://www.nj.gov/treasury/taxation'],
  ['NM', K, null, 'sales', 'calendar', 'Previous calendar year', 'New Mexico Taxation and Revenue Department · https://www.tax.newmexico.gov'],
  ['NY', 500_000_00, 100, 'and', 'ny-quarters', 'Preceding four sales tax quarters', 'New York State Department of Taxation and Finance · https://www.tax.ny.gov'],
  ['NC', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'North Carolina Department of Revenue · https://www.ncdor.gov'],
  ['ND', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'North Dakota Office of State Tax Commissioner · https://www.tax.nd.gov'],
  ['OH', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Ohio Department of Taxation · https://tax.ohio.gov'],
  ['OK', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Oklahoma Tax Commission · https://oklahoma.gov/tax'],
  ['PA', K, null, 'sales', 'calendar', 'Previous calendar year', 'Pennsylvania Department of Revenue · https://www.revenue.pa.gov'],
  ['RI', K, 200, 'or', 'calendar', 'Previous calendar year', 'Rhode Island Division of Taxation · https://tax.ri.gov'],
  ['SC', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'South Carolina Department of Revenue · https://dor.sc.gov'],
  ['SD', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'South Dakota Department of Revenue · https://dor.sd.gov'],
  ['TN', K, null, 'sales', 'trailing-12', 'Preceding 12 months', 'Tennessee Department of Revenue · https://www.tn.gov/revenue'],
  ['TX', 500_000_00, null, 'sales', 'trailing-12', 'Preceding 12 calendar months', 'Texas Comptroller of Public Accounts · https://comptroller.texas.gov'],
  ['UT', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Utah State Tax Commission · https://tax.utah.gov'],
  ['VT', K, 200, 'or', 'trailing-12', 'Preceding 12 months', 'Vermont Department of Taxes · https://tax.vermont.gov'],
  ['VA', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'Virginia Department of Taxation · https://www.tax.virginia.gov'],
  ['WA', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Washington Department of Revenue · https://dor.wa.gov'],
  ['WV', K, 200, 'or', 'calendar', 'Previous or current calendar year', 'West Virginia Tax Division · https://tax.wv.gov'],
  ['WI', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Wisconsin Department of Revenue · https://www.revenue.wi.gov'],
  ['WY', K, null, 'sales', 'calendar', 'Previous or current calendar year', 'Wyoming Department of Revenue · https://revenue.wyo.gov'],
  ['PR', K, 200, 'or', 'calendar', 'Previous calendar year', 'Puerto Rico Department of the Treasury · https://hacienda.pr.gov'],
]

export const THRESHOLDS: Threshold[] = rows.map(([state, sales, transactions, test, measure, rule, source]) => ({ state, sales, transactions, test, measure, rule, source }))
