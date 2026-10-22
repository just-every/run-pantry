import { requireThat, sha256, text, type Data } from '../../core'
export type Provider='inkwell'|'platter'
export type Source={provider:Provider;origin:string;remoteId:string;token:string}
export type Evidence={remoteRevision:string;summary:Data;proof:Data;proofHash:string;pdf?:Uint8Array<ArrayBuffer>;pdfHash?:string}
export class SourceFailure extends Error {constructor(public code:string){super(code)}}
export function sourceNeed(value:unknown,code:string):asserts value{if(!value)throw new SourceFailure(code)}
export const object=(v:unknown):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)
export const canonical=(v:any):string=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v)
export const hashProof=(v:Data)=>sha256(canonical(v))
export function sourceString(v:unknown,max=300){sourceNeed(typeof v==='string'&&v.length>0&&v.length<=max,'source_invalid');return v}
export const hash=(v:unknown)=>{const value=sourceString(v,64);sourceNeed(/^[a-f0-9]{64}$/.test(value),'source_invalid');return value}
export function remoteId(raw:unknown){const id=text(raw,'Remote record',100);requireThat(/^[A-Za-z0-9_-]+$/.test(id),'Use the sibling record ID, not a link');return id}
export function timestamp(v:unknown){sourceNeed(typeof v==='string'&&v.length<=50&&Number.isFinite(Date.parse(v)),'source_invalid');return v}
export function money(v:unknown){sourceNeed(Number.isSafeInteger(v)&&Number(v)>=0,'source_invalid');return Number(v)}
