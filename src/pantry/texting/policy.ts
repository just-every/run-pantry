import { requireThat, text } from '../core'

export const purposes = ['invoice','reminder','estimate','receipt'] as const
export function phoneNumber(raw: unknown) {
 const phone=text(raw,'Mobile number',20).replace(/[\s().-]/g,'')
 requireThat(/^\+[1-9]\d{7,14}$/.test(phone),'Enter an international mobile number, starting with +')
 return phone
}
export function timeZone(raw:unknown) {
 const zone=text(raw,'Customer time zone',100)
 try {new Intl.DateTimeFormat('en',{timeZone:zone}).format()} catch {requireThat(false,'Choose a valid customer time zone')}
 return zone
}
export function localClock(zone:string,at:Date) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]))
 return {day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),minute:Number(p.minute)}
}
// The owner-adopted daytime window is narrower than the contract's 08:00–21:00.
export function nextTextTime(zone:string,at:Date,businessZone=zone) {
 const open=(when:Date)=>{const customer=localClock(zone,when).hour,business=localClock(businessZone,when).hour;return customer>=8&&customer<21&&business>=8&&business<18}
 if(open(at))return at.toISOString()
 const start=Math.ceil(at.getTime()/60000)*60000
 for(let m=0;m<1800;m++){
  const when=new Date(start+m*60000)
  if(open(when))return when.toISOString()
 }
 throw new Error('Customer time zone has no next sending window')
}
export function template(raw:unknown,label:string) {
 const value=text(raw,label,900)
 const remainder=value.replace(/\{\{([a-z_]+)\}\}/g,(_,field)=>{
  requireThat(['business','customer','invoice','balance','due_date','link'].includes(field),'Use a supported text merge field');return ''
 })
 requireThat(!remainder.includes('{{')&&!remainder.includes('}}'),'Use a supported text merge field')
 requireThat(value.includes('{{link}}')&&/\bSTOP\b/i.test(value)&&/\bHELP\b/i.test(value),'Include {{link}}, STOP and HELP in the approved text')
 return value
}
export function selectedPurposes(raw:unknown) {
 requireThat(Array.isArray(raw)&&raw.length>0&&raw.every(p=>purposes.includes(p)),'Choose the consented purposes')
 return [...new Set(raw)] as string[]
}
