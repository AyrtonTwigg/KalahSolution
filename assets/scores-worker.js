/* File loading, checksum verification and lookups stay off the board UI thread. */
importScripts('game.js','mini_scores.js','distance.js');
const catalogURL=new URL('../Website Solutions/catalog.json',self.location.href);
const distanceURL=new URL('../Website Solutions/Distance/catalog.json',self.location.href);
const cache=new Map();
const inFlight=new Map();
const budget=64*1024*1024;
let bytes=0,catalogPromise=null,latest=null,running=false;
let distanceCatalogPromise=null;
async function distanceCatalog() {
  if (!distanceCatalogPromise) distanceCatalogPromise=fetch(distanceURL,{cache:'no-cache'}).then(async r=>{
    if (r.status===404) return [];
    if (!r.ok) throw new Error('Distance catalog could not be read.');
    const c=await r.json();
    if (c.format!=='kalah-distance-web-v1'||c.rules!==KalahDistance.RULES||!Array.isArray(c.packs)) {
      throw new Error('Unsupported distance catalog.');
    }
    return c.packs;
  }).catch(e=>{distanceCatalogPromise=null;throw e;});
  return distanceCatalogPromise;
}
async function loadDistance(url,entry) {
  const response=await fetch(url);
  if (!response.ok) throw new Error('Distance pack could not be read.');
  const data=await response.arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),
                        b=>b.toString(16).padStart(2,'0')).join('');
  if (hash!==entry.sha256) throw new Error('Distance pack checksum mismatch.');
  return {db:new KalahDistance.Pack(data,entry.records),size:data.byteLength};
}
async function catalog() {
  if (!catalogPromise) catalogPromise=fetch(catalogURL,{cache:'no-cache'}).then(r=>{
    if (!r.ok) throw new Error(`Solution catalog could not be read (${r.status}).`);
    return r.json();
  }).catch(e=>{catalogPromise=null;throw e;});
  return catalogPromise;
}
async function database(entry,isDistance=false) {
  const url=new URL(entry.file,isDistance?distanceURL:catalogURL).href;
  if (cache.has(url)) {
    const saved=cache.get(url);cache.delete(url);cache.set(url,saved);return saved.db;
  }
  if (!inFlight.has(url)) {
    const load=isDistance?loadDistance(url,entry):
      MancalaMini.MiniDatabase.load(url,entry.sha256).then(db=>({db,size:db.bytes.byteLength}));
    const promise=load.then(({db,size})=>{
      while (bytes+size>budget && cache.size) {
        const key=cache.keys().next().value;bytes-=cache.get(key).size;cache.delete(key);
      }
      cache.set(url,{db,size});bytes+=size;return db;
    }).finally(()=>inFlight.delete(url));
    inFlight.set(url,promise);
  }
  return inFlight.get(url);
}
async function lookupDistance(state) {
  const terminal=KalahDistance.terminal(state,KalahCore);
  if (terminal) return terminal;
  const stone=KalahCore.total(state.pits),key=MancalaMini.rank(state.pits)*64+state.stores[state.turn];
  const entry=(await distanceCatalog()).find(e=>e.stone===stone&&e.min<=key&&key<=e.max);
  return entry?(await database(entry,true)).lookup(key):null;
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
  const terminal=KalahDistance.terminal(state,KalahCore);
  const decided=job.metric==='distance'&&terminal;
  if (decided||KalahCore.finished(state)) {
    return {id:job.id,exactTotal:KalahCore.finished(state)?state.stores[state.turn]:null,
            distance:decided||null,moves:[],optimal:[],distanceOptimal:[]};
  }
  let scoreError=null,distanceError=null;
  const score=async position=>{
    if (scoreError) return null;
    try {return await lookup(position);}
    catch(error) {scoreError=error.message;return null;}
  };
  const distance=async position=>{
    try {return await lookupDistance(position);}
    catch(error) {distanceError=error.message;return null;}
  };
  const [parent,parentDistance]=await Promise.all([score(state),job.metric==='distance'?distance(state):null]);
  if (latest.id!==job.id) return null;
  let exactTotal=parent===null?null:state.stores[state.turn]+parent;
  const moves=[],edges=[];
  for (const move of KalahCore.legalMoves(state)) {
    if (latest.id!==job.id) return null;
    const edge=KalahCore.play(state,move);
    edges.push(edge);
    const [childFuture,childDistance]=await Promise.all([
      score(edge.state),job.metric==='distance'?distance(edge.state):null
    ]);
    moves.push({move,total:KalahCore.moveTotal(state,edge,childFuture),
                distance:KalahDistance.fromChild(childDistance,state.turn===edge.state.turn)});
  }
  if (exactTotal===null && moves.length && moves.every(m=>m.total!==null)) exactTotal=Math.max(...moves.map(m=>m.total));
  if (exactTotal!==null && moves.some(m=>m.total!==null&&m.total>exactTotal)) {
    scoreError='The saved scores disagree for this position.';
    exactTotal=null;
    for (const move of moves) move.total=null;
  }
  let rootDistance=parentDistance;
  if (job.metric!=='distance'&&(exactTotal===null||moves.some(m=>m.total===null))) {
    rootDistance=terminal||await distance(state);
    if (!terminal) {
      for (const [index,edge] of edges.entries()) {
        if (latest.id!==job.id) return null;
        const move=moves[index];
        // All child proofs can establish a fallback verdict when the parent proof is missing.
        if (move.total===null||(exactTotal===null&&!rootDistance)) {
          move.distance=KalahDistance.fromChild(await distance(edge.state),state.turn===edge.state.turn);
        }
      }
    }
  }
  return {id:job.id,exactTotal,moves,optimal:KalahCore.optimalMoves(moves,exactTotal),
          ...KalahDistance.moveProofs(rootDistance,moves),warning:distanceError||scoreError};
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
