import assert from 'node:assert/strict'
import { textingJourney } from '../api/texting-journey.mjs'

const testAccountSid=process.env.TWILIO_TEST_ACCOUNT_SID,testAuthToken=process.env.TWILIO_TEST_AUTH_TOKEN
assert.ok(testAccountSid&&testAuthToken,'Inject the held Twilio TEST account SID and TEST auth token')
const cleanup=[]
try {
 const evidence=await textingJourney({after:fn=>cleanup.push(fn)},{credentials:{testAccountSid,testAuthToken},provider:async(request,count)=>{
  assert.ok(count<=2,'Only one invoice and one reminder test request are authorized')
  const form=new URLSearchParams(await request.clone().text())
  assert.equal(form.get('From'),'+15005550006');assert.equal(form.get('To'),'+15005550006')
  const response=await fetch(request.url,{method:'POST',headers:{authorization:request.headers.get('authorization'),'content-type':'application/x-www-form-urlencoded'},body:form,redirect:'error',signal:AbortSignal.timeout(15000)})
  const value=await response.json()
  console.log(JSON.stringify({provider:'twilio',httpStatus:response.status,messageId:value.sid??null,status:value.status??null,testOnly:true}))
  return Response.json(value,{status:response.status})
 }})
 console.log(JSON.stringify(evidence))
} finally {for(const close of cleanup.reverse())await close()}
