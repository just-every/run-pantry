declare module '@runeditrun/rer/modules/portability/journal' {
  type Prepared = {statement:string; params:unknown[]}
  export function redactionStatements(db:D1Database):Promise<Prepared[]>
  export function erasureStatements(db:D1Database,table:string,key:Record<string,unknown>):Promise<Prepared[]>
  export function invalidateTransfersStatements(db:D1Database):Promise<Prepared[]>
}
