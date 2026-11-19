/* Distance proofs use mover-relative pits and the mover's current store. */
(function (root) {
  'use strict';
  const RULES='kalah6-4.bounds.v1.stop25.sweep.shortest-draw.crc32-16';
  const terminal=(state,G)=>{
    if (!G.finished(state)&&Math.max(...state.stores)<25) return null;
    return {outcome:Math.sign(state.stores[state.turn]-state.stores[1-state.turn]),lo:0,hi:0,mask:0};
  };
  const fromChild=(proof,sameMover)=>proof&&({
    outcome:sameMover?proof.outcome:-proof.outcome,lo:proof.lo+1,
    hi:proof.hi===null?null:proof.hi+1,mask:0
  });
  function moveProofs(parent,moves) {
    const exact=p=>p&&p.lo===p.hi;
    if (!exact(parent)&&moves.length&&moves.every(m=>exact(m.distance))) {
      const outcome=Math.max(...moves.map(m=>m.distance.outcome));
      const candidates=moves.filter(m=>m.distance.outcome===outcome);
      const lo=(outcome<0?Math.max:Math.min)(...candidates.map(m=>m.distance.lo));
      parent={outcome,lo,hi:lo,mask:0};
    }
    const best=[];
    if (exact(parent)) {
      for (const move of moves) {
        const proof=move.distance;
        if (parent.mask&(1<<move.move)) {
          move.distance={outcome:parent.outcome,lo:parent.lo,hi:parent.hi,mask:0};
          best.push(move.move);
        } else if (proof&&proof.outcome===parent.outcome&&
                   (parent.outcome<0?proof.lo:proof.hi)===parent.lo) {
          move.distance={...proof,lo:parent.lo,hi:parent.hi};
          best.push(move.move);
        }
      }
    }
    return {distance:parent,distanceOptimal:best};
  }
  function label(proof) {
    if (!proof) return null;
    const name=proof.outcome>0?'Win':proof.outcome<0?'Loss':'Draw';
    if (proof.hi===0) {
      const text=proof.outcome>0?'Already won':proof.outcome<0?'Already lost':'Already drawn';
      return {text,name:text,amount:null,outcome:proof.outcome};
    }
    const amount=proof.lo===proof.hi?String(proof.lo):
      proof.hi===null?`≥${proof.lo}`:`${proof.lo}–${proof.hi}`;
    const unit=amount==='1'?'move':'moves';
    return {text:`${name} · ${amount} ${unit}`,name,amount,unit,outcome:proof.outcome};
  }
  function preferredLabel(proof,stoneTotal,metric) {
    return metric==='distance'||stoneTotal===null?label(proof):null;
  }
  class Pack {
    constructor(buffer,records) {
      if (buffer.byteLength!==records*12) throw new Error('Invalid distance pack length.');
      this.view=new DataView(buffer);
      this.records=records;
    }
    lookup(key) {
      let start=0,end=this.records;
      while(start<end) {
        const mid=Math.floor((start+end)/2),offset=mid*12;
        const current=this.view.getUint32(offset,true)+this.view.getUint16(offset+4,true)*4294967296;
        if (current<key) start=mid+1;
        else if (current>key) end=mid;
        else {
          const lo=this.view.getUint16(offset+6,true),hi=this.view.getUint16(offset+8,true);
          const outcome=this.view.getInt8(offset+10),mask=this.view.getUint8(offset+11);
          if (lo===65535||hi<lo||Math.abs(outcome)>1||mask>63||(mask&&lo!==hi)) {
            throw new Error('Invalid distance proof.');
          }
          return {outcome,lo,hi:hi===65535?null:hi,mask};
        }
      }
      return null;
    }
  }
  const api={RULES,terminal,fromChild,moveProofs,label,preferredLabel,Pack};
  root.KalahDistance=api;
  if (typeof module!=='undefined'&&module.exports) module.exports=api;
})(globalThis);
