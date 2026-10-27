// Only the external identity provider is synthetic; Pantry verifies the signed
// ID token, state, nonce, PKCE and native invitation through its real routes.
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto'

export async function accountantIssuer(email) {
  const dir=await mkdtemp(join(tmpdir(),'pantry-oidc-')), codes=new Map(), failures=[]
  let issuer, server
  try {
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-subj','/CN=127.0.0.1','-days','1'],{stdio:'ignore'})
    server=createServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},(request,response)=>{
      void browserResponse(request).then(result=>{
        response.writeHead(result.status,Object.fromEntries(result.headers))
        return result.text().then(body=>response.end(body))
      }).catch(error=>{failures.push(error);response.writeHead(500);response.end('Identity fixture failed')})
    })
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    issuer=`https://127.0.0.1:${server.address().port}`
  } catch(error) { await rm(dir,{recursive:true,force:true});throw error }
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
  const jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-pantry-80',alg:'RS256',use:'sig'}
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
  let signIns=0, exchanges=0
  const config=i=>({id:'practice',preset:'legacy-rs256',label:'Practice identity',issuer,clientId:`synthetic-pantry-${100+i}`,clientSecret:'synthetic-pantry-81',tokenAuthMethod:'client_secret_basic',endpointPins:{authorization:issuer+'/authorize',token:issuer+'/token',jwks:issuer+'/jwks'}})
  async function outbound(request) {
    const url=new URL(request.url)
    if(url.origin!==issuer)return null
    if(url.pathname==='/.well-known/openid-configuration')return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],grant_types_supported:['authorization_code'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],code_challenge_methods_supported:['S256']})
    if(url.pathname==='/jwks')return Response.json({keys:[jwk]})
    assert.equal(url.pathname,'/token');assert.equal(request.method,'POST')
    const body=new URLSearchParams(await request.text()), value=codes.get(body.get('code'))
    assert.ok(value,'authorization code exists and is used once');codes.delete(body.get('code'))
    assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from(value.get('client_id')+':synthetic-pantry-81').toString('base64'))
    assert.equal(body.get('redirect_uri'),value.get('redirect_uri'))
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),value.get('code_challenge'))
    const now=Math.floor(Date.now()/1000)
    const input=encode({alg:'RS256',typ:'JWT',kid:jwk.kid})+'.'+encode({iss:issuer,sub:'synthetic-pantry-82',aud:value.get('client_id'),nonce:value.get('nonce'),iat:now,exp:now+300,email,email_verified:true,email_verified_at:now})
    exchanges++
    return Response.json({id_token:input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url'),access_token:'synthetic-pantry-83',token_type:'Bearer',expires_in:300})
  }
  async function browserResponse(request) {
    const url=new URL(request.url,issuer)
    if(url.pathname==='/login') {
      assert.equal(request.method,'POST');signIns++
      return new Response(null,{status:303,headers:{location:url.searchParams.get('request'),'set-cookie':'synthetic-pantry-session=1; Path=/; Secure; SameSite=Lax'}})
    }
    assert.equal(url.pathname,'/authorize')
    if(!(request.headers.cookie??'').includes('synthetic-pantry-session=1')) {
      return new Response(`<form method="post" action="${issuer}/login?request=${encodeURIComponent(url.href)}"><button>Sign in to practice</button></form>`,{headers:{'content-type':'text/html'}})
    }
    assert.equal(url.searchParams.get('code_challenge_method'),'S256')
    const code=randomUUID();codes.set(code,url.searchParams)
    const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('code',code);callback.searchParams.set('state',url.searchParams.get('state'))
    return new Response(null,{status:303,headers:{location:callback.href}})
  }
  const close=async()=>{
    server.closeAllConnections()
    await new Promise((resolve,reject)=>server.close(error=>error ? reject(error) : resolve()))
    await rm(dir,{recursive:true,force:true})
    assert.deepEqual(failures,[],'identity fixture requests succeed')
  }
  return {issuer,config,outbound,close,get signIns(){return signIns},get exchanges(){return exchanges}}
}
