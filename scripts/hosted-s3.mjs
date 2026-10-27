// Conditional object writes use R2's S3 API. The administrative upload API
// does not enforce create-only headers. Credentials stay in this closure.
import {createHash,createHmac} from 'node:crypto'
const hash=value=>createHash('sha256').update(value).digest('hex')
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest()

export function conditionalObjectWriter({accountId,token,bucketName,fetcher}){
 let credentials
 const accessKey=()=>credentials??=(async()=>{
  const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,{
   headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(60_000),
  })
  if(!response.ok)throw new Error('object_credentials_refused')
  const value=await response.json()
  if(value.success!==true || !/^[a-f0-9]{32}$/.test(value.result?.id??'') || value.result.status!=='active')throw new Error('object_credentials_refused')
  return {id:value.result.id,secret:hash(token)}
 })()
 return async(key,bytes,metadata)=>{
  const credential=await accessKey()
  const url=new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`)
  const stamp=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8)
  const payloadHash=hash(bytes),scope=`${day}/auto/s3/aws4_request`
  const headers={...metadata,host:url.host,'x-amz-date':stamp,'x-amz-content-sha256':payloadHash}
  const names=Object.keys(headers).sort(),signed=names.join(';')
  const canonicalHeaders=names.map(name=>name+':'+String(headers[name]).trim()+'\n').join('')
  const canonical=['PUT',url.pathname,'',canonicalHeaders,signed,payloadHash].join('\n')
  const signingKey=hmac(hmac(hmac(hmac('AWS4'+credential.secret,day),'auto'),'s3'),'aws4_request')
  const signature=createHmac('sha256',signingKey).update(['AWS4-HMAC-SHA256',stamp,scope,hash(canonical)].join('\n')).digest('hex')
  return fetcher(url,{method:'PUT',body:bytes,headers:{...headers,authorization:`AWS4-HMAC-SHA256 Credential=${credential.id}/${scope}, SignedHeaders=${signed}, Signature=${signature}`},redirect:'error',signal:AbortSignal.timeout(120_000)})
 }
}
