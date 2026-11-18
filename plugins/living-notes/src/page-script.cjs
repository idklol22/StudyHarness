'use strict';
// Runs inside the notes page (headless Chrome): draws mind maps with rough.js, then jitters letters.
// Kept as a raw string so it can be embedded in the generated HTML. No backticks or dollar-braces inside.
const { graphKit } = require('./graph-kit.cjs');
module.exports = 'const kit = (' + graphKit.toString() + ')();\n' + String.raw`
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
  // 3D graph: force layout in 3D, camera angle chosen to minimise overlapping edges and labels.
  for(const svg of document.querySelectorAll('svg.graph3d')){
    const m=JSON.parse(svg.dataset.map),W=760,H=720;
    const topics=new Set(m.tree.filter(e=>e[0]===m.root).map(e=>e[1]));
    const groupOf=new Map();for(const [p,c] of m.tree){if(topics.has(p))groupOf.set(c,p);}
    const names=[...new Set([m.root,...m.tree.flat()])];
    const kindOf=n=>n===m.root?'root':topics.has(n)?'topic':'leaf';
    const nodes=names.map(n=>({id:n,kind:kindOf(n),group:kindOf(n)==='leaf'?(groupOf.get(n)||n):n}));
    const edges=[...m.tree.map(e=>({a:e[0],b:e[1],kind:'tree'})),...m.cross.map(e=>({a:e[0],b:e[1],kind:'cross'}))];
    const label=n=>{const max=kindOf(n)==='leaf'?28:32;return n.length>max?n.slice(0,max-1)+'…':n;};
    const labelW={};for(const n of names){measure.font=(kindOf(n)==='leaf'?'':'700 ')+'14px Hand';labelW[n]=measure.measureText(label(n)).width+8;}
    const {pos,view}=kit.arrange(nodes,edges,labelW,{W,H});
    const proj=kit.project(pos,{yaw:view.yaw,pitch:view.pitch,zoom:.95,W,H});
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    const rc=rough.svg(svg),ns='http://www.w3.org/2000/svg';
    const zs=names.map(n=>proj[n].z),zmin=Math.min(...zs),zmax=Math.max(...zs)||1;
    const depth=z=>(zmax===zmin?1:.3+.7*(z-zmin)/(zmax-zmin));
    // faint orbit ring (the "equator" of the sphere) for a sense of depth
    const ring=[];for(let k=0;k<=64;k++){const a=k/64*Math.PI*2;const p=kit.project({r:[Math.cos(a),0,Math.sin(a)]},{yaw:view.yaw,pitch:view.pitch,zoom:.95,W,H}).r;ring.push(p.x.toFixed(1)+','+p.y.toFixed(1));}
    const pl=document.createElementNS(ns,'polyline');pl.setAttribute('points',ring.join(' '));pl.setAttribute('fill','none');pl.setAttribute('stroke','#1c6b8a');pl.setAttribute('stroke-width','1');pl.setAttribute('stroke-dasharray','2 6');pl.setAttribute('opacity','.35');svg.appendChild(pl);
    const cx=names.reduce((t,n)=>t+proj[n].x,0)/names.length;
    const order=[...names].sort((a,b)=>proj[a].z-proj[b].z);
    for(const e of [...edges].sort((a,b)=>(proj[a.a].z+proj[a.b].z)-(proj[b.a].z+proj[b.b].z))){
      const p=proj[e.a],q=proj[e.b];if(!p||!q)continue;
      const g=rc.line(p.x,p.y,q.x,q.y,{stroke:e.kind==='cross'?'#9a4a12':'#1c6b8a',strokeWidth:e.kind==='cross'?1.2:1.6,roughness:.9,seed:11,strokeLineDash:e.kind==='cross'?[5,4]:undefined});
      g.setAttribute('opacity',(depth((p.z+q.z)/2)*(e.kind==='cross'?.75:.9)).toFixed(2));svg.appendChild(g);}
    const COL={new:['#e5e7eb','#6b7280'],shaky:['#fecaca','#b91c1c'],ok:['#fde68a','#a16207'],solid:['#bbf7d0','#15803d']};
    let sd=5;
    for(const n of order){const p=proj[n],k=kindOf(n),st=m.status[n];
      const cols=st?COL[st]:(k==='root'?['#e9d5ff','#7a2e8e']:['#dbeafe','#1c6b8a']);
      const r=(k==='root'?15:k==='topic'?10:6.5)*p.s;
      const dot=rc.circle(p.x,p.y,r*2,{stroke:cols[1],fill:cols[0],fillStyle:'solid',strokeWidth:1.8,roughness:1,seed:sd++});
      dot.setAttribute('opacity',depth(p.z).toFixed(2));svg.appendChild(dot);
      }
    // Labels: split left/right of the centre, then push apart vertically so none overlap; short leader lines when displaced.
    const lab={};for(const n of names){const p=proj[n];lab[n]={n,right:p.x>=cx,y:p.y,h:kindOf(n)==='leaf'?15:18};}
    for(const side of [true,false]){
      const g=names.filter(n=>lab[n].right===side).sort((x,y)=>lab[x].y-lab[y].y);
      for(let i=1;i<g.length;i++){const need=lab[g[i-1]].y+(lab[g[i-1]].h+lab[g[i]].h)/2;if(lab[g[i]].y<need)lab[g[i]].y=need;}
      const over=Math.max(0,(g.length?lab[g[g.length-1]].y:0)-(H-34));
      if(over>0)for(const n of g)lab[n].y-=over; // keep the stack inside the page
    }
    for(const n of order){const p=proj[n],k=kindOf(n),L=lab[n];
      const r=(k==='root'?15:k==='topic'?10:6.5)*p.s,right=L.right,tx=p.x+(right?r+6:-r-6);
      if(Math.abs(L.y-p.y)>7){const ln=rc.line(p.x+(right?r:-r),p.y,tx,L.y-4,{stroke:'#8a93a8',strokeWidth:.8,roughness:.4,seed:3});ln.setAttribute('opacity','.6');svg.appendChild(ln);}
      const t=document.createElementNS(ns,'text');t.textContent=label(n);
      t.setAttribute('x',tx);t.setAttribute('y',L.y+1);t.setAttribute('text-anchor',right?'start':'end');
      t.setAttribute('font-size',((k==='leaf'?13.5:15)*(.9+.1*p.s)).toFixed(1));if(k!=='leaf')t.setAttribute('font-weight','700');
      t.setAttribute('opacity',Math.min(1,.6+depth(p.z)*.45).toFixed(2));svg.appendChild(t);}
    // legend, just below the lowest drawn element
    const legendY=Math.max(...names.map(n=>Math.max(lab[n].y,proj[n].y)))+40;
    [['new','not started'],['shaky','shaky'],['ok','ok'],['solid','solid']].forEach(([k,txt],i)=>{
      const x=20+i*110,y=legendY;svg.appendChild(rc.circle(x,y,12,{stroke:COL[k][1],fill:COL[k][0],fillStyle:'solid',roughness:.8,seed:2}));
      const t=document.createElementNS(ns,'text');t.textContent=txt;t.setAttribute('x',x+12);t.setAttribute('y',y+5);t.setAttribute('font-size','13');svg.appendChild(t);});
    // Fit the viewBox to what was actually drawn so nothing is clipped and no space is wasted.
    const bb=svg.getBBox();svg.setAttribute('viewBox',[bb.x-14,bb.y-14,bb.width+28,bb.height+28].join(' '));
  }
  // Seeded jitter so the same notes always look the same.
  let seed=1234567;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const skip=n=>n.closest&&n.closest('.katex,.mindmap,.graph3d,.badge');
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
