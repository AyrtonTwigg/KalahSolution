/* Browser-local explorer. No automated player, search engine or server state. */
(() => {
  'use strict';
  const G=KalahCore,$=id=>document.getElementById(id);
  const storageKey='kalah-explorer-v1';
  let history=[{state:G.initial(),note:'Choose a pocket on the active side.'}],cursor=0,flipped=false;
  let scores=null,loading=true,error=null,requestId=0,worker=null;
  const current=()=>history[cursor].state;
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if (saved&&saved.version===1&&Array.isArray(saved.history)&&saved.history.length&&saved.history.length<=1000&&
        Number.isInteger(saved.cursor)&&saved.cursor>=0&&saved.cursor<saved.history.length) {
      saved.history.forEach(h=>{G.validate(h.state);if(typeof h.note!=='string')throw Error();});
      history=saved.history;cursor=saved.cursor;flipped=saved.flipped===true;
    }
  } catch (_) { /* Storage is optional; a fresh board always works. */ }
  function save() {
    try {localStorage.setItem(storageKey,JSON.stringify({version:1,history,cursor,flipped}));} catch (_) {}
  }
  function setupWorker() {
    if (location.protocol==='file:') {
      error='Open this site with Start Local Preview.cmd to read the solution files.';loading=false;return;
    }
    try {
      worker=new Worker('assets/scores-worker.js');
      worker.onmessage=({data})=>{
        if (data.id!==requestId) return;
        loading=false;
        if (data.type==='error') {error=data.message;scores=null;}
        else {scores=data;error=null;}
        render();
      };
      worker.onerror=()=>{if(worker)worker.terminate();worker=null;loading=false;error='The solution reader could not start. You can still explore the board.';render();};
    } catch (_) {error='This browser could not open the solution reader.';loading=false;}
  }
  function analyze() {
    scores=null;error=null;loading=true;requestId++;
    if (G.finished(current())) {
      loading=false;scores={exactTotal:current().stores[current().turn],moves:[],optimal:[]};render();return;
    }
    if (!worker) setupWorker();
    render();
    if (worker) worker.postMessage({id:requestId,state:current()});
  }
  function valueText(total) {return `${total>24?'Win':total===24?'Draw':'Loss'} · ${total}`;}
  function scoreLabel(move,active,empty) {
    const label=document.createElement('div');label.className='score';
    if (!active||empty) {label.textContent='—';label.setAttribute('aria-hidden','true');return label;}
    label.classList.add('playable');
    const value=scores?.moves.find(m=>m.move===move)?.total??null;
    const best=scores?.optimal.includes(move);
    const text=loading?'…':error?'Unavailable':value===null?'?':valueText(value);
    label.classList.toggle('known',value!==null);
    label.classList.toggle('loss',value!==null&&value<24);
    label.classList.toggle('win',value!==null&&value>24);
    label.classList.toggle('draw',value===24);
    label.title=value===null?(loading?'Reading the saved solutions':error?'Solution data could not be read':'No saved score for this move'):`Perfect play: mover finishes with ${value} stones${best?'; an optimal move':''}`;
    const full=document.createElement('span');full.className='full-value';full.textContent=text;
    const compact=document.createElement('span');compact.className='compact-value';
    if (value===null) compact.textContent=error?'—':text;
    else {
      const result=document.createElement('span');result.className='compact-result';result.textContent=value>24?'Win':value===24?'Draw':'Loss';
      const number=document.createElement('strong');number.textContent=value;
      compact.append(result,number);
    }
    label.append(full,compact);
    if (best) {const star=document.createElement('span');star.className='score-star';star.textContent='★';label.append(star);}
    return label;
  }
  function makeStore(element,player) {
    element.className=`store store-${element.id==='left-store'?'left':'right'} player-${player+1}`;
    element.replaceChildren();
    const name=document.createElement('span');name.className='store-player';name.dataset.short=`P${player+1}`;name.textContent=`Player ${player+1}`;
    const subtitle=document.createElement('span');subtitle.className='store-name';subtitle.textContent='STORE';
    const value=document.createElement('strong');value.textContent=current().stores[player];
    const unit=document.createElement('span');unit.className='stone-word';unit.textContent='stones';
    element.append(name,subtitle,value,unit);element.setAttribute('aria-label',`Player ${player+1} store: ${current().stores[player]} stones`);
  }
  function render() {
    const state=current(),over=G.finished(state),bottom=flipped?1:0,top=1-bottom;
    $('remaining-count').textContent=G.total(state.pits);
    $('turn-heading').replaceChildren(document.createTextNode(over?'Game complete':`Player ${state.turn+1} to move`));
    if (!over) {const dot=document.createElement('span');dot.className='turn-dot';$('turn-heading').append(dot);}
    document.querySelector('.position-heading').classList.toggle('player-2',state.turn===1);
    const total=scores?.exactTotal??null;
    let verdict=loading?'Reading solutions…':error?'Scores unavailable':total===null?'Exact result not in this collection':total===24?'Draw · 24–24':`Player ${(total>24?state.turn:1-state.turn)+1} wins · ${Math.max(total,48-total)}–${Math.min(total,48-total)}`;
    if (total===null&&!loading&&!error&&Math.max(...state.stores)>=25) verdict=`Player ${state.stores[0]>=25?1:2} has secured a win`;
    $('position-score').textContent=verdict;
    for (const [id,player] of [['top-heading',top],['bottom-heading',bottom]]) {
      const el=$(id);el.className=`side-heading ${id==='bottom-heading'?'bottom-heading ':''}player-${player+1}`;
      el.textContent=`PLAYER ${player+1}`;
      if (player===state.turn&&!over) {const tag=document.createElement('span');tag.className='active-tag';tag.textContent='YOUR MOVE';el.append(tag);}
    }
    makeStore($('left-store'),top);makeStore($('right-store'),bottom);
    const grid=$('pocket-grid');grid.replaceChildren();
    for (const [player,isTop] of [[top,true],[bottom,false]]) {
      const pits=G.playerPits(state,player);
      for (let col=0;col<6;col++) {
        const move=isTop?5-col:col,n=pits[move],active=player===state.turn&&!over;
        const cell=document.createElement('div');cell.className=`pocket player-${player+1}${active&&n?' active':''}${!n?' empty':''}`;
        const num=document.createElement('span');num.className='pit-number';num.textContent=move+1;num.setAttribute('aria-hidden','true');
        const button=document.createElement('button');button.className='pit';button.textContent=n;button.disabled=!active||!n;
        button.dataset.player=player;button.dataset.pit=move+1;
        const value=scores?.moves.find(m=>m.move===move)?.total??null;
        button.setAttribute('aria-label',`Player ${player+1}, pocket ${move+1}, ${n} stones${active&&value!==null?`, perfect-play final total ${value}${scores?.optimal.includes(move)?', optimal move':''}`:''}`);
        button.addEventListener('click',()=>play(move));
        const label=scoreLabel(move,active,!n);
        cell.append(...(isTop?[label,button,num]:[num,button,label]));grid.append(cell);
      }
    }
    $('move-note').textContent=over?'All remaining stones have been collected.':history[cursor].note;
    $('previous').disabled=cursor===0;$('next').disabled=cursor===history.length-1;
    $('history-position').textContent=cursor===0?'Starting position':`Move ${cursor} of ${history.length-1}`;
    $('data-status').textContent=error|| (loading?'Reading saved solutions…':'Saved solutions · Loaded only as needed');
    document.querySelector('.data-status').classList.toggle('error',Boolean(error));$('retry').hidden=!error||location.protocol==='file:';
    $('coverage-note').textContent='A question mark means this collection does not have the score.';
  }
  function play(move) {
    if ($('edit-dialog').open||$('rules-dialog').open||!G.legalMoves(current()).includes(move)) return;
    const edge=G.play(current(),move);
    const note=`Player ${edge.player+1} played pocket ${move+1}${edge.capture?` · Captured ${edge.capture} stones`:''}${edge.bonus?' · Extra turn':''}.`;
    history=history.slice(0,cursor+1);history.push({state:edge.state,note});cursor++;
    save();analyze();
  }
  function step(amount) {cursor=Math.max(0,Math.min(history.length-1,cursor+amount));save();analyze();}
  function newLine(state,note) {history=[{state,note}];cursor=0;save();analyze();}
  $('new-game').onclick=()=>newLine(G.initial(),'Choose a pocket on the active side.');
  $('flip').onclick=()=>{flipped=!flipped;save();render();};
  $('previous').onclick=()=>step(-1);$('next').onclick=()=>step(1);
  $('retry').onclick=()=>{if(worker){worker.terminate();worker=null;}analyze();};
  $('rules').onclick=()=>$('rules-dialog').showModal();
  for (const dialog of [$('rules-dialog'),$('edit-dialog')]) dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();
  });
  function editTotal() {
    const values=[...$('edit-fields').querySelectorAll('input')].map(input=>input.value.trim()===''?NaN:Number(input.value));
    const valid=values.every(n=>Number.isInteger(n)&&n>=0&&n<=48),sum=values.reduce((a,b)=>a+b,0);
    $('edit-total').textContent=valid?`${sum} / 48 stones`:'Whole numbers only';$('edit-total').classList.toggle('invalid',!valid||sum!==48);
  }
  $('edit').onclick=()=>{
    const fields=$('edit-fields');fields.replaceChildren();$('edit-error').textContent='';$('edit-turn').value=current().turn;
    for (const player of [0,1]) {
      const section=document.createElement('div');section.className='edit-row';
      const heading=document.createElement('h3');heading.textContent=`Player ${player+1} · pockets from farthest to nearest their store`;
      const row=document.createElement('div');row.className='edit-pits';
      const values=[...G.playerPits(current(),player),current().stores[player]];
      values.forEach((n,i)=>{
        const label=document.createElement('label');label.textContent=i===6?'Store':String(i+1);
        const input=document.createElement('input');input.type='number';input.inputMode='numeric';input.min=0;input.max=48;input.step=1;input.required=true;
        input.value=n;input.id=`edit-p${player}-${i}`;input.setAttribute('aria-label',`Player ${player+1} ${i===6?'store':`pocket ${i+1}`}`);
        input.oninput=editTotal;input.onfocus=()=>input.select();label.append(input);row.append(label);
      });section.append(heading,row);fields.append(section);
    }
    editTotal();$('edit-dialog').showModal();
  };
  const cancelEdit=()=>$('edit-dialog').close();$('cancel-edit').onclick=cancelEdit;$('close-edit').onclick=cancelEdit;
  $('edit-form').onsubmit=event=>{
    event.preventDefault();
    try {
      const numbers=player=>Array.from({length:7},(_,i)=>{const value=$(`edit-p${player}-${i}`).value.trim();return value===''?NaN:Number(value);});
      const p1=numbers(0),p2=numbers(1),turn=Number($('edit-turn').value);
      const state=G.edited(p1.slice(0,6),p2.slice(0,6),[p1[6],p2[6]],turn);
      $('edit-dialog').close();newLine(state,'Edited starting position. Choose a pocket on the active side.');
    } catch(e) {$('edit-error').textContent=e.message;editTotal();}
  };
  document.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName)||$('rules-dialog').open||$('edit-dialog').open)return;
    if(/^[1-6]$/.test(event.key)){event.preventDefault();play(Number(event.key)-1);}
    if(event.key==='ArrowLeft'){event.preventDefault();step(-1);}
    if(event.key==='ArrowRight'){event.preventDefault();step(1);}
  });
  window.matchMedia('(max-width:900px)').addEventListener('change',render);
  analyze();
})();
