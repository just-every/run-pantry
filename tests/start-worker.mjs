// Keep the OS-assigned listening socket. Reserving an ephemeral port, closing
// it and later starting workerd left a window for another proxy to take it.
// Set the exact auth origin only after binding; this changes no test request,
// host/origin check, assertion, retry policy or provider response.
import {Miniflare} from 'miniflare'
export async function startWorker(optionsFor){
 const mf=new Miniflare({...optionsFor('http://127.0.0.1:0'),host:'127.0.0.1',port:0})
 try{
  const origin=(await mf.ready).origin
  await mf.setOptions({...optionsFor(origin),host:'127.0.0.1',port:0})
  if((await mf.ready).origin!==origin)throw new Error('Worker changed its bound port while setting its authentication origin')
  return {mf,origin}
 }catch(error){await mf.dispose();throw error}
}
