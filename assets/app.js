/* Browser-local explorer. No automated player, search engine or server state. */
(() => {
  'use strict';
  const G=KalahCore,$=id=>document.getElementById(id);
  const storageKey='kalah-explorer-v1';
  let history=[{state:G.initial(),note:'Choose a pocket on the active side.'}],cursor=0,flipped=false;
  let scores=null,loading=true,error=null,requestId=0,worker=null;
  let animateSowing=true,animation=null,animationTimer=null;
  let metric='stones';
  const current=()=>history[cursor].state;
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if (saved?.version===1&&typeof saved.animateSowing==='boolean') animateSowing=saved.animateSowing;
    if (saved?.version===1&&saved.metric==='distance') metric='distance';
    if (saved&&saved.version===1&&Array.isArray(saved.history)&&saved.history.length&&saved.history.length<=1000&&
        Number.isInteger(saved.cursor)&&saved.cursor>=0&&saved.cursor<saved.history.length) {
      saved.history.forEach(h=>{G.validate(h.state);if(typeof h.note!=='string')throw Error();});
      history=saved.history;cursor=saved.cursor;flipped=saved.flipped===true;
    }
  } catch (_) { /* Storage is optional; a fresh board always works. */ }
  function save() {
    try {localStorage.setItem(storageKey,JSON.stringify({version:1,history,cursor,flipped,animateSowing,metric}));} catch (_) {}
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
    if (G.finished(current())||metric==='distance'&&KalahDistance.terminal(current(),G)) {
      loading=false;scores={exactTotal:G.finished(current())?current().stores[current().turn]:null,
        distance:metric==='distance'?KalahDistance.terminal(current(),G):null,moves:[],optimal:[]};
      render();return;
    }
    if (!worker) setupWorker();
    render();
    if (worker) worker.postMessage({id:requestId,state:current(),metric});
  }
  function moveDisplay(move) {
    const entry=scores?.moves.find(m=>m.move===move),total=entry?.total??null;
    const proof=KalahDistance.preferredLabel(entry?.distance,total,metric);
    if (proof) return {...proof,kind:'distance',best:metric==='distance'&&scores.distanceOptimal.includes(move),
      title:proof.amount===null?proof.text:`${proof.name} in ${proof.amount} ${proof.unit}`};
    if (total===null) return null;
    const unit=total===1?'stone':'stones';
    return {name:total>24?'Win':total<24?'Loss':'Draw',amount:total,unit,kind:'stones',
      outcome:Math.sign(total-24),best:metric==='stones'&&scores.optimal.includes(move),
      title:`Perfect play: mover finishes with ${total} ${unit}`};
  }
  function scoreMeasurement(amount,unit,kind) {
    const measurement=document.createElement('span');measurement.className='score-measurement';
    const number=document.createElement('strong');number.textContent=amount;
    const suffix=document.createElement('span');suffix.className=`score-unit unit-${kind}`;suffix.textContent=unit;
    measurement.append(number,' ',suffix);
    return measurement;
  }
  function scoreLabel(value,active,empty) {
    const label=document.createElement('div');label.className='score';
    if (!active||empty||metric==='distance'&&scores?.distance?.hi===0) {label.textContent='—';label.setAttribute('aria-hidden','true');return label;}
    label.classList.add('playable');
    const best=value?.best;
    label.classList.toggle('known',Boolean(value));
    label.classList.toggle('loss',value?.outcome===-1);
    label.classList.toggle('win',value?.outcome===1);
    label.classList.toggle('draw',value?.outcome===0);
    label.title=value?`${value.title}${best?'; an optimal move':''}`:
      loading?'Reading the saved solutions':error?'Solution data could not be read':'No saved result for this move';
    const display=document.createElement('span');display.className='score-value';
    if (!value) display.textContent=loading?'…':error?'—':'?';
    else {
      const result=document.createElement('span');result.className='score-result';result.textContent=value.name;
      display.append(result);
      if (value.amount!==null) {
        const separator=document.createElement('span');separator.className='score-separator';separator.textContent=' ·';
        separator.setAttribute('aria-hidden','true');
        display.append(separator,' ',scoreMeasurement(value.amount,value.unit,value.kind));
      }
    }
    label.append(display);
    if (best) {const star=document.createElement('span');star.className='score-star';star.textContent='★';label.append(star);}
    return label;
  }
  function makeStore(element,player,state) {
    element.className=`store store-${element.id==='left-store'?'left':'right'} player-${player+1}`;
    element.replaceChildren();
    const name=document.createElement('span');name.className='store-player';name.dataset.short=`P${player+1}`;name.textContent=`Player ${player+1}`;
    const subtitle=document.createElement('span');subtitle.className='store-name';subtitle.textContent='STORE';
    element.dataset.player=player;
    const value=document.createElement('strong');value.textContent=state.stores[player];
    const unit=document.createElement('span');unit.className='stone-word';unit.textContent='stones';
    element.append(name,subtitle,value,unit);element.setAttribute('aria-label',`Player ${player+1} store: ${state.stores[player]} stones`);
  }
  function render() {
    const frame=animation?.frame,state=frame?.state??current(),over=!animation&&G.finished(state),bottom=flipped?1:0,top=1-bottom;
    $('remaining-count').textContent=G.total(state.pits)+(frame?.inHand??0);
    $('turn-heading').replaceChildren(document.createTextNode(over?'Game complete':`Player ${state.turn+1} ${animation?'sowing':'to move'}`));
    if (!over) {const dot=document.createElement('span');dot.className='turn-dot';$('turn-heading').append(dot);}
    document.querySelector('.position-heading').classList.toggle('player-2',state.turn===1);
    const total=scores?.exactTotal??null;
    let verdict=loading?'Reading solutions…':error?'Scores unavailable':'Exact result not in this collection';
    if (total===null&&!loading&&!error&&Math.max(...state.stores)>=25) verdict=`Player ${state.stores[0]>=25?1:2} has secured a win`;
    const distance=KalahDistance.preferredLabel(scores?.distance,total,metric);
    let measurement=null;
    if (distance) {
      verdict=`Player ${state.turn+1} · ${distance.name}`;
      if (distance.amount!==null) {
        verdict+=' in ';
        measurement=scoreMeasurement(distance.amount,distance.unit,'distance');
      }
    } else if (total!==null) {
      verdict=total===24?'Draw · ':`Player ${(total>24?state.turn:1-state.turn)+1} wins · `;
      measurement=scoreMeasurement(`${Math.max(total,48-total)}–${Math.min(total,48-total)}`,'stones','stones');
    }
    if (animation) verdict=frame.kind==='capture'?`Captured ${animation.edge.capture} stones`:frame.kind==='sweep'?'Collecting remaining stones':`${frame.inHand} ${frame.inHand===1?'stone':'stones'} in hand`;
    document.querySelector('.verdict .eyebrow').textContent=animation?'MOVE IN PROGRESS':'PERFECT PLAY';
    $('position-score').replaceChildren(verdict);
    if (measurement&&!animation) $('position-score').append(measurement);
    for (const [id,player] of [['top-heading',top],['bottom-heading',bottom]]) {
      const el=$(id);el.className=`side-heading ${id==='bottom-heading'?'bottom-heading ':''}player-${player+1}`;
      el.textContent=`PLAYER ${player+1}`;
      if (player===state.turn&&!over) {const tag=document.createElement('span');tag.className='active-tag';tag.textContent=animation?'SOWING':'YOUR MOVE';el.append(tag);}
    }
    makeStore($('left-store'),top,state);makeStore($('right-store'),bottom,state);
    const grid=$('pocket-grid');grid.replaceChildren();
    for (const [player,isTop] of [[top,true],[bottom,false]]) {
      const pits=G.playerPits(state,player);
      for (let col=0;col<6;col++) {
        const move=isTop?5-col:col,n=pits[move],active=player===state.turn&&!over&&!animation;
        const cell=document.createElement('div');cell.className=`pocket player-${player+1}${active&&n?' active':''}${!n?' empty':''}`;
        const num=document.createElement('span');num.className='pit-number';num.textContent=move+1;num.setAttribute('aria-hidden','true');
        const button=document.createElement('button');button.className='pit';button.textContent=n;button.disabled=!active||!n;
        button.dataset.player=player;button.dataset.pit=move+1;
        const value=active?moveDisplay(move):null;
        button.setAttribute('aria-label',`Player ${player+1}, pocket ${move+1}, ${n} stones${value?`, ${value.title}${value.best?', optimal move':''}`:''}`);
        button.addEventListener('click',()=>play(move));
        const label=scoreLabel(value,active,!n);
        cell.append(...(isTop?[label,button,num]:[num,button,label]));grid.append(cell);
      }
    }
    $('board').setAttribute('aria-busy',String(Boolean(animation)));
    $('move-note').setAttribute('aria-live',animation?'off':'polite');
    $('move-note').textContent=frame?.note??(over?'All remaining stones have been collected.':history[cursor].note);
    if (frame) for (const target of frame.targets) {
      const selector=target.store?`.store[data-player="${target.player}"]`:`.pit[data-player="${target.player}"][data-pit="${target.pit+1}"]`;
      document.querySelector(selector)?.classList.add('sow-target');
    }
    $('previous').disabled=cursor===0;$('next').disabled=cursor===history.length-1;
    $('history-position').textContent=cursor===0?'Starting position':`Move ${cursor} of ${history.length-1}`;
    $('metric-legend').textContent=metric==='distance'?'Best proven distance':'Highest final score';
    const warning=error||scores?.warning;
    $('data-status').textContent=animation?'Sowing stones…':warning|| (loading?'Reading saved solutions…':'Saved solutions · Loaded only as needed');
    document.querySelector('.data-status').classList.toggle('error',Boolean(warning));$('retry').hidden=!warning||location.protocol==='file:';
  }
  function play(move) {
    if (animation||$('edit-dialog').open||$('rules-dialog').open||!G.legalMoves(current()).includes(move)) return;
    const edge=G.play(current(),move,{trace:animateSowing});
    const note=`Player ${edge.player+1} played pocket ${move+1}${edge.capture?` · Captured ${edge.capture} stones`:''}${edge.bonus?' · Extra turn':''}.`;
    history=history.slice(0,cursor+1);history.push({state:edge.state,note});cursor++;
    save();
    if (animateSowing) startSowing(edge);else analyze();
  }
  function cancelSowing() {
    if (animationTimer!==null) clearTimeout(animationTimer);
    animationTimer=null;animation=null;
  }
  function startSowing(edge) {
    cancelSowing();
    const job={edge,index:0,frame:edge.frames[0]};
    animation=job;requestId++;scores=null;loading=false;error=null;
    const stoneSteps=edge.frames.filter(f=>f.kind==='sow').length;
    function tick() {
      if (animation!==job) return;
      job.frame=edge.frames[job.index];
      render();
      const delay=job.frame.kind==='sow'?Math.max(55,Math.min(150,1200/stoneSteps)):job.frame.kind==='pickup'?180:350;
      animationTimer=setTimeout(()=>{
        if (animation!==job) return;
        job.index++;
        if (job.index<edge.frames.length) tick();
        else {cancelSowing();analyze();}
      },delay);
    }
    tick();
  }
  function step(amount) {cancelSowing();cursor=Math.max(0,Math.min(history.length-1,cursor+amount));save();analyze();}
  function newLine(state,note) {cancelSowing();history=[{state,note}];cursor=0;save();analyze();}
  $('new-game').onclick=()=>newLine(G.initial(),'Choose a pocket on the active side.');
  $('flip').onclick=()=>{flipped=!flipped;save();render();};
  $('previous').onclick=()=>step(-1);$('next').onclick=()=>step(1);
  $('animate-sowing').checked=animateSowing;
  $('evaluation-metric').value=metric;
  $('evaluation-metric').onchange=()=>{
    metric=$('evaluation-metric').value;
    save();
    if (!animation) analyze();
  };
  $('animate-sowing').onchange=()=>{
    animateSowing=$('animate-sowing').checked;save();
    if (!animateSowing&&animation) {cancelSowing();analyze();}
  };
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
    if (animation) {cancelSowing();analyze();}
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
