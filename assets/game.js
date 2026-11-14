/* Kalah 6/4: exact rules, canonical player-to-move pit orientation. */
(function (root) {
  'use strict';
  const total = values => values.reduce((a,b) => a+b,0);
  const initial = () => ({pits:Array(12).fill(4),stores:[0,0],turn:0});
  const finished = state => !state.pits.slice(0,6).some(Boolean) || !state.pits.slice(6).some(Boolean);
  const legalMoves = state => finished(state) ? [] : [...Array(6).keys()].filter(i => state.pits[i]>0);
  function validate(state) {
    if (!state || !Array.isArray(state.pits) || state.pits.length!==12 || !Array.isArray(state.stores) || state.stores.length!==2 ||
        ![0,1].includes(state.turn) || [...state.pits,...state.stores].some(n => !Number.isInteger(n)||n<0||n>48) ||
        total(state.pits)+total(state.stores)!==48) throw new Error('Use whole numbers from 0 to 48, totaling exactly 48 stones.');
    return state;
  }
  function sweep(state) {
    if (finished(state)) {
      state.stores[state.turn] += total(state.pits.slice(0,6));
      state.stores[1-state.turn] += total(state.pits.slice(6));
      state.pits.fill(0);
    }
    return state;
  }
  function play(state,move,{trace=false}={}) {
    validate(state);
    if (!legalMoves(state).includes(move)) throw new Error('Choose a nonempty pocket on the side to move.');
    const next = {pits:state.pits.slice(),stores:state.stores.slice(),turn:state.turn};
    const frames=[];
    const emit=(kind,inHand,targets,note,view=next)=>{
      if (trace) frames.push({kind,inHand,targets,note,state:{pits:view.pits.slice(),stores:view.stores.slice(),turn:state.turn}});
    };
    let stones=next.pits[move], cursor=move, capture=0;
    next.pits[move]=0;
    emit('pickup',stones,[{player:state.turn,pit:move}],`Player ${state.turn+1} picked up ${stones} stones.`);
    while (stones>0) {
      cursor=(cursor+1)%13;
      if (cursor===6) next.stores[next.turn]++;
      else next.pits[cursor<6?cursor:cursor-1]++;
      stones--;
      const target=cursor===6?{player:state.turn,store:true}:{player:cursor<6?state.turn:1-state.turn,pit:cursor<6?cursor:cursor-7};
      emit('sow',stones,[target],`Player ${state.turn+1} sowing · ${stones} ${stones===1?'stone':'stones'} in hand.`);
    }
    const bonus=cursor===6;
    if (cursor<6 && next.pits[cursor]===1 && next.pits[11-cursor]>0) {
      capture=1+next.pits[11-cursor];
      next.stores[next.turn]+=capture;
      next.pits[cursor]=next.pits[11-cursor]=0;
      emit('capture',0,[{player:state.turn,pit:cursor},{player:1-state.turn,pit:5-cursor},{player:state.turn,store:true}],`Capture · ${capture} stones moved to Player ${state.turn+1}'s store.`);
    }
    const remaining=[total(next.pits.slice(0,6)),total(next.pits.slice(6))];
    if (!bonus) {
      next.pits=next.pits.slice(6).concat(next.pits.slice(0,6));
      next.turn=1-next.turn;
    }
    sweep(next);
    validate(next);
    if (finished(next)&&remaining.some(Boolean)) {
      const targets=remaining.flatMap((n,i)=>n?[{player:i===0?state.turn:1-state.turn,store:true}]:[]);
      emit('sweep',0,targets,'Game over · remaining stones collected into the stores.',next);
    }
    const edge={state:next,bonus:bonus&&!finished(next),capture,move,player:state.turn};
    if (trace) edge.frames=frames;
    return edge;
  }
  function playerPits(state,player) {
    return state.pits.slice(player===state.turn?0:6,player===state.turn?6:12);
  }
  function edited(p1,p2,stores,turn) {
    const pits=turn===0?[...p1,...p2]:[...p2,...p1];
    return sweep(validate({pits,stores:stores.slice(),turn}));
  }
  function moveTotal(parent,edge,childFuture) {
    if (finished(edge.state)) return edge.state.stores[parent.turn];
    if (childFuture===null) return null;
    const child=edge.state;
    return child.turn===parent.turn ? child.stores[parent.turn]+childFuture : 48-child.stores[child.turn]-childFuture;
  }
  function optimalMoves(values,exactTotal) {
    const known=values.filter(v=>v.total!==null);
    if (exactTotal===null || !known.length) return [];
    return known.filter(v=>v.total===exactTotal).map(v=>v.move);
  }
  const api={total,initial,finished,legalMoves,validate,sweep,play,playerPits,edited,moveTotal,optimalMoves};
  root.KalahCore=api;
  if (typeof module!=='undefined' && module.exports) module.exports=api;
})(globalThis);
