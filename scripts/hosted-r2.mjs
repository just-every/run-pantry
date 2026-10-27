// Account-scoped private R2 REST transport for owner-run backup and restore.
// No object URLs or provider diagnostics are exposed to readers or logs.
import {conditionalObjectWriter} from './hosted-s3.mjs'
const LIMIT = 25_000_000
const headersFor = metadata => Object.fromEntries(Object.entries({
  'content-type':metadata?.contentType, 'content-language':metadata?.contentLanguage,
  'content-disposition':metadata?.contentDisposition, 'content-encoding':metadata?.contentEncoding,
  'cache-control':metadata?.cacheControl,
}).filter(([,value]) => value !== undefined))
const metadataFor = headers => Object.fromEntries(Object.entries({contentType:headers.get('content-type'),contentLanguage:headers.get('content-language'),contentDisposition:headers.get('content-disposition'),contentEncoding:headers.get('content-encoding'),cacheControl:headers.get('cache-control')}).filter(([,value])=>value!==null))
export function hostedR2({ accountId, token, bucketName, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(accountId) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName) || !token) throw new Error('invalid_object_configuration')
  const conditionalPut=conditionalObjectWriter({accountId,token,bucketName,fetcher})
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects`
  const path = key => {
    if (!/^documents\/[A-Za-z0-9_-]+$/.test(key)) throw new Error('invalid_document_key')
    return base + '/' + key
  }
  async function request(url, options = {}) {
    const response = await fetcher(url, {...options, redirect:'error', headers:{authorization:`Bearer ${token}`,...options.headers}, signal:AbortSignal.timeout(120_000)})
    if (!response.ok && ![404,412].includes(response.status)) { await response.body?.cancel(); throw new Error('object_provider_failed') }
    return response
  }
  const bucket = {
    async list({prefix='',cursor,limit=1000} = {}) {
      const query = new URLSearchParams({prefix,limit:String(limit)})
      if(cursor)query.set('cursor',cursor)
      const response=await request(base+'?'+query)
      if(!response.ok)throw new Error('object_bucket_missing')
      const page=await response.json()
      if(page.success!==true || !Array.isArray(page.result))throw new Error('object_list_invalid')
      return {objects:page.result.map(o=>({key:o.key,size:Number(o.size),etag:String(o.etag).replaceAll('"',''),httpMetadata:o.http_metadata??o.httpMetadata??{},customMetadata:o.custom_metadata??o.customMetadata??{}})),truncated:!!page.result_info?.is_truncated,cursor:page.result_info?.cursor}
    },
    async get(key, options={}) {
      const range=options.range
      const response=await request(path(key),{headers:range?{range:`bytes=${range.offset}-${range.offset+range.length-1}`}:undefined})
      if(response.status===404)return null
      if(!response.ok)throw new Error('object_read_failed')
      return {key,body:response.body,size:Number(response.headers.get('content-length')),etag:(response.headers.get('etag')??'').replaceAll('"',''),httpMetadata:metadataFor(response.headers),customMetadata:{},arrayBuffer:()=>response.arrayBuffer()}
    },
    async put(key, value, options={}) {
      const bytes=value instanceof Uint8Array?value:new Uint8Array(value)
      if(bytes.length>LIMIT || Object.keys(options.customMetadata??{}).length)throw new Error('unsupported_document_object')
      path(key)
      if(options.onlyIf && (Object.keys(options.onlyIf).length!==1 || options.onlyIf.etagDoesNotMatch!=='*'))throw new Error('unsupported_object_condition')
      const response=options.onlyIf
        ?await conditionalPut(key,bytes,{...headersFor(options.httpMetadata),'if-none-match':'*'})
        :await request(path(key),{method:'PUT',body:bytes,headers:headersFor(options.httpMetadata)})
      if(response.status===412){await response.body?.cancel();return null}
      if(!response.ok)throw new Error('object_write_failed')
      await response.body?.cancel()
      return {key}
    },
    async delete(key) {
      const response=await request(path(key),{method:'DELETE'})
      await response.body?.cancel()
      if(!response.ok && response.status!==404)throw new Error('object_delete_failed')
    },
    // Base streams 5 MiB pieces during restore. Document originals are bounded
    // to 25 MB, so the REST transport assembles one bounded upload at completion.
    async createMultipartUpload(key, options) {
      const chunks=new Map();let size=0
      return {
        async uploadPart(number,bytes) {const chunk=new Uint8Array(bytes);size+=chunk.length-(chunks.get(number)?.length??0);if(size>LIMIT)throw new Error('document_too_large');chunks.set(number,chunk);return {partNumber:number,etag:String(number)}},
        async complete(parts) {const bytes=new Uint8Array(size);let offset=0;for(const part of parts){const chunk=chunks.get(part.partNumber);if(!chunk)throw new Error('document_part_missing');bytes.set(chunk,offset);offset+=chunk.length}if(offset!==size)throw new Error('document_parts_invalid');await bucket.put(key,bytes,options);chunks.clear();return {key}},
        async abort(){chunks.clear()},
      }
    },
  }
  return bucket
}
