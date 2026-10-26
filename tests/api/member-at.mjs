import assert from 'node:assert/strict'

/** Invite and confirm on the same transport clock as the financial journey. */
export async function memberAt(h, instant, email, role, grants={}) {
  await h.command('member.save',{email,name:email.split('@')[0],role,...grants})
  const message=h.mail.findLast(m=>[m.to].flat().includes(email))
  assert.ok(message)
  const url=message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]
  const token=new URL(url).searchParams.get('token')
  const response=await h.send('/auth/confirm',{token},{headers:{'x-synthetic-pantry-clock':instant}})
  assert.equal(response.status,303,JSON.stringify(response.value))
  return response.cookie
}
