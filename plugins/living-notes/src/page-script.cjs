'use strict';
// Runs inside the notes page (headless Chrome): draws mind maps with rough.js, then jitters letters.
// Kept as a raw string so it can be embedded in the generated HTML. No backticks or dollar-braces inside.
module.exports = String.raw`
(async function(){
  try{ await document.fonts.load('16px Hand'); await document.fonts.load('700 16px Hand'); }catch(e){}
  const COLORS={new:['#e5e7eb','#6b7280'],shaky:['#fecaca','#b91c1c'],ok:['#fde68a','#a16207'],solid:['#bbf7d0','#15803d']};
  const measure=document.createElement('canvas').getContext('2d');
  const wrap=(text,maxW,font)=>{measure.font=font;const words=text.split(/\s+/);const lines=[];let cur='';
    // Break very long unspaced names (snake_case) at underscores so they fit the box.
    for(const w of text.split(/\s+/).flatMap(x=>measure.measureText(x).width>maxW?x.split(/(?<=_)/):[x])){const t=cur?(cur.endsWith('_')?cur+w:cur+' '+w):w;if(measure.measureText(t).width>maxW&&cur){lines.push(cur);cur=w;}else cur=t;}
    if(cur)lines.push(cur);
    if(lines.length>3){lines.length=3;lines[2]=lines[2].replace(/\s*\S*$/,'')+'…';}
    return lines;};
  // Tree mind map: root at the left, one column per depth, leaves stacked, parents centred on their children.
  for(const svg of document.querySelectorAll('svg.mindmap')){
    const m=JSON.parse(svg.dataset.map);const kids=new Map(),parent=new Map();
    for(const [p,c] of m.tree){if(parent.has(c))continue;parent.set(c,p);if(!kids.has(p))kids.set(p,[]);kids.get(p).push(c);}
    const root=m.root;const depth=new Map();const order=[];
    (function walk(n,d){depth.set(n,d);order.push(n);for(const c of kids.get(n)||[])walk(c,d+1);})(root,0);
    const maxD=Math.max(...depth.values());
    const colW=[150,170,240].slice(0,maxD+1);if(maxD===1)colW[1]=250;
    const font=d=>(d===0?'700 16px Hand':'15px Hand');
    const box={};let y=10;const GAP=9;
    const place=(n)=>{const d=depth.get(n);const lines=wrap(n,colW[d]-18,font(d));const h=lines.length*19+12;const cs=kids.get(n)||[];
      if(!cs.length){box[n]={lines,h,y:y};y+=h+GAP;}
      else{cs.forEach(place);const top=box[cs[0]].y,bot=box[cs[cs.length-1]].y+box[cs[cs.length-1]].h;box[n]={lines,h,y:(top+bot)/2-h/2};}};
    place(root);
    const xs=[];let x=10;for(const w of colW){xs.push(x);x+=w+44;}
    const W=x-44+70,H=y+4;svg.setAttribute('viewBox','0 0 '+W+' '+H);
    const scale=Math.min(1,880/H);svg.style.width=Math.min(100,W*scale/6.3)+'%';
    const rc=rough.svg(svg);const ns='http://www.w3.org/2000/svg';
    const at=n=>Object.assign({x:xs[depth.get(n)],w:colW[depth.get(n)]},box[n]);
    for(const [p,c] of m.tree){if(!box[p]||!box[c])continue;const a=at(p),b=at(c);
      svg.appendChild(rc.line(a.x+a.w,a.y+a.h/2,b.x,b.y+b.h/2,{stroke:'#1c6b8a',strokeWidth:1.8,roughness:1.2,seed:7}));}
    for(const [p,c] of m.cross){if(!box[p]||!box[c]||p===c)continue;const a=at(p),b=at(c);
      const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x+b.w,y2=b.y+b.h/2;const bulge=26+Math.min(40,Math.abs(y2-y1)/8);
      const path=document.createElementNS(ns,'path');
      path.setAttribute('d','M'+x1+' '+y1+' C'+(x1+bulge)+' '+y1+' '+(x2+bulge)+' '+y2+' '+x2+' '+y2);
      path.setAttribute('fill','none');path.setAttribute('stroke','#9a4a12');path.setAttribute('stroke-width','1.3');
      path.setAttribute('stroke-dasharray','5 4');path.setAttribute('opacity','.7');svg.appendChild(path);}
    let sd=3;
    for(const n of order){const d=at(n);const st=m.status[n];
      const cols=st?COLORS[st]:(depth.get(n)===0?['#e9d5ff','#7a2e8e']:['#dbeafe','#1c6b8a']);
      svg.appendChild(rc.rectangle(d.x,d.y,d.w,d.h,{stroke:cols[1],fill:cols[0],fillStyle:'solid',strokeWidth:1.8,roughness:1.3,seed:sd++}));
      d.lines.forEach((ln,i)=>{const t=document.createElementNS(ns,'text');t.textContent=ln;
        t.setAttribute('x',d.x+d.w/2);t.setAttribute('y',d.y+6+19*(i+1)-3);t.setAttribute('text-anchor','middle');
        if(depth.get(n)===0)t.setAttribute('font-weight','700');svg.appendChild(t);});}
  }
  // 2D map of ideas (owner, 2026-11-18): the same radial layout as the app's map. Notebook in the
  // centre, topics on the inner ring (arcs sized by their concepts), concepts on the outer ring.
  for(const svg of document.querySelectorAll('svg.graph2d')){
    const m=JSON.parse(svg.dataset.map),ns='http://www.w3.org/2000/svg',rc=rough.svg(svg);
    const topics=m.tree.filter(e=>e[0]===m.root).map(e=>e[1]);
    const kids=new Map(topics.map(t=>[t,m.tree.filter(e=>e[0]===t).map(e=>e[1])]));
    const total=Math.max(1,[...kids.values()].reduce((s,l)=>s+l.length,0));
    const S=150,pos={};pos[m.root]={x:0,y:0,kind:'root'};
    let ang=-Math.PI/2;
    for(const t of topics){const list=kids.get(t),arc=2*Math.PI*Math.max(1,list.length)/total,mid=ang+arc/2;
      pos[t]={x:Math.cos(mid)*S,y:Math.sin(mid)*S,kind:'topic'};
      list.forEach((c,i)=>{const a=list.length===1?mid:ang+arc*(i+.5)/list.length,r=(list.length>3&&i%2?2.55:2.05)*S;pos[c]={x:Math.cos(a)*r,y:Math.sin(a)*r,kind:'leaf'};});
      ang+=arc;}
    const COL={new:['#e5e7eb','#6b7280'],shaky:['#fecaca','#b91c1c'],ok:['#fde68a','#a16207'],solid:['#bbf7d0','#15803d']};
    for(const [p,c] of m.tree){const a=pos[p],q=pos[c];if(!a||!q)continue;svg.appendChild(rc.line(a.x,a.y,q.x,q.y,{stroke:'#1c6b8a',strokeWidth:1.5,roughness:.9,seed:11}));}
    for(const [p,c] of m.cross){const a=pos[p],q=pos[c];if(!a||!q||p===c)continue;
      const mx=(a.x+q.x)*.32,my=(a.y+q.y)*.32,path=document.createElementNS(ns,'path');
      path.setAttribute('d','M'+a.x+' '+a.y+' Q'+mx+' '+my+' '+q.x+' '+q.y);path.setAttribute('fill','none');path.setAttribute('stroke','#9a4a12');
      path.setAttribute('stroke-width','1.2');path.setAttribute('stroke-dasharray','5 4');path.setAttribute('opacity','.7');svg.appendChild(path);}
    let sd=5;
    for(const [n,p] of Object.entries(pos)){const st=m.status[n],cols=st?COL[st]:(p.kind==='root'?['#e9d5ff','#7a2e8e']:['#dbeafe','#1c6b8a']);
      const r=p.kind==='root'?15:p.kind==='topic'?10:6.5;
      svg.appendChild(rc.circle(p.x,p.y,r*2,{stroke:cols[1],fill:cols[0],fillStyle:'solid',strokeWidth:1.8,roughness:1,seed:sd++}));
      const t=document.createElementNS(ns,'text'),lbl=n.length>30?n.slice(0,29)+'…':n;t.textContent=lbl;
      const right=p.x>4,left=p.x<-4;
      t.setAttribute('x',p.x+(right?r+5:left?-r-5:0));t.setAttribute('y',p.kind==='root'?p.y-r-8:p.y+4);
      t.setAttribute('text-anchor',right?'start':left?'end':'middle');
      t.setAttribute('font-size',p.kind==='leaf'?'13':'15');if(p.kind!=='leaf')t.setAttribute('font-weight','700');svg.appendChild(t);}
    const bb0=svg.getBBox(),legendY=bb0.y+bb0.height+28;
    [['new','not started'],['shaky','shaky'],['ok','ok'],['solid','solid']].forEach(([k,txt],i)=>{
      const x=bb0.x+10+i*110;svg.appendChild(rc.circle(x,legendY,12,{stroke:COL[k][1],fill:COL[k][0],fillStyle:'solid',roughness:.8,seed:2}));
      const t=document.createElementNS(ns,'text');t.textContent=txt;t.setAttribute('x',x+12);t.setAttribute('y',legendY+5);t.setAttribute('font-size','13');svg.appendChild(t);});
    const bb=svg.getBBox();svg.setAttribute('viewBox',[bb.x-14,bb.y-14,bb.width+28,bb.height+28].join(' '));
  }
  // Seeded jitter so the same notes always look the same.
  let seed=1234567;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const skip=n=>n.closest&&n.closest('.katex,.mindmap,.graph2d,.badge');
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const nodes=[];
  while(w.nextNode()){const n=w.currentNode;if(n.nodeValue.trim()&&!skip(n.parentElement))nodes.push(n);}
  for(const n of nodes){const f=document.createDocumentFragment();
    // One nowrap span per word so lines only break between words, never inside one.
    for(const part of n.nodeValue.split(/(\s+)/)){
      if(!part)continue;
      if(/^\s+$/.test(part)){f.append(document.createTextNode(part));continue;}
      const word=document.createElement('span');word.className='w';
      for(const ch of part){const s=document.createElement('span');s.className='j';s.textContent=ch;
        s.style.transform='translateY('+((rnd()-.5)*2).toFixed(2)+'px) rotate('+((rnd()-.5)*2.4).toFixed(2)+'deg)';word.append(s);}
      f.append(word);}
    n.replaceWith(f);}
  document.documentElement.setAttribute('data-ready','1');
})();`;
