/* File loading, checksum verification and lookups stay off the board UI thread. */
importScripts('game.js','mini_scores.js');
const catalogURL=new URL('../Website Solutions/catalog.json',self.location.href);
const cache=new Map();
const inFlight=new Map();
const budget=64*1024*1024;
let bytes=0,catalogPromise=null,latest=null,running=false;
async function catalog() {
  if (!catalogPromise) catalogPromise=fetch(catalogURL,{cache:'no-cache'}).then(r=>{
    if (!r.ok) throw new Error(`Solution catalog could not be read (${r.status}).`);
    return r.json();
  }).catch(e=>{catalogPromise=null;throw e;});
  return catalogPromise;
}
async function database(entry) {
  const url=new URL(entry.file,catalogURL).href;
  if (cache.has(url)) {
    const saved=cache.get(url);cache.delete(url);cache.set(url,saved);return saved.db;
  }
  if (!inFlight.has(url)) {
    const promise=MancalaMini.MiniDatabase.load(url,entry.sha256).then(db=>{
      const size=db.bytes.byteLength;
      while (bytes+size>budget && cache.size) {
        const key=cache.keys().next().value;bytes-=cache.get(key).size;cache.delete(key);
      }
      cache.set(url,{db,size});bytes+=size;return db;
    }).finally(()=>inFlight.delete(url));
    inFlight.set(url,promise);
  }
  return inFlight.get(url);
}
async function lookup(state) {
  if (KalahCore.finished(state)) return 0;
  const n=KalahCore.total(state.pits),rank=MancalaMini.rank(state.pits);
  const c=await catalog();
  const entries=c.layers.filter(e=>e.stone===n && (e.rank_min===undefined || e.rank_min<=rank&&rank<=e.rank_max));
  for (const entry of entries) {
    const db=await database(entry),value=db.lookupRank(n,rank);
    if (value!==null) return value;
  }
  return null;
}
async function analyze(job) {
  const state=job.state;
  if (KalahCore.finished(state)) return {id:job.id,exactTotal:state.stores[state.turn],moves:[],optimal:[]};
  const parent=await lookup(state);
  if (latest.id!==job.id) return null;
  let exactTotal=parent===null?null:state.stores[state.turn]+parent;
  const moves=[];
  for (const move of KalahCore.legalMoves(state)) {
    if (latest.id!==job.id) return null;
    const edge=KalahCore.play(state,move);
    const childFuture=KalahCore.finished(edge.state)?0:await lookup(edge.state);
    moves.push({move,total:KalahCore.moveTotal(state,edge,childFuture)});
  }
  if (exactTotal===null && moves.length && moves.every(m=>m.total!==null)) exactTotal=Math.max(...moves.map(m=>m.total));
  if (exactTotal!==null && moves.some(m=>m.total!==null&&m.total>exactTotal)) throw new Error('The saved scores disagree for this position.');
  return {id:job.id,exactTotal,moves,optimal:KalahCore.optimalMoves(moves,exactTotal)};
}
self.onmessage=event=>{
  latest=event.data;
  if (!running) pump();
};
async function pump() {
  running=true;
  let handled=null;
  while (latest && latest.id!==handled) {
    const job=latest;handled=job.id;
    try {
      const result=await analyze(job);
      if (result&&latest.id===job.id) self.postMessage({type:'result',...result});
    } catch (error) {
      if (latest.id===job.id) self.postMessage({type:'error',id:job.id,message:error.message});
    }
  }
  running=false;
}
