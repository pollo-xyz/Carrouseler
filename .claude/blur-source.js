
// ═══════════════════════════════════
//  DATA
// ═══════════════════════════════════
const RATIOS = [
  {l:'16:9', w:16, h:9}, {l:'4:3', w:4, h:3}, {l:'1:1', w:1, h:1},
  {l:'3:4', w:3, h:4}, {l:'9:16', w:9, h:16}, {l:'2:3', w:2, h:3},
  {l:'21:9', w:21, h:9}, {l:'3:2', w:3, h:2},
];

const BG_DOTS = ['#ffffff','#F4F0E8','#E8E3D9','#1C1C1E','#0a0a0a'];

// Palettes — mix of vibrant and muted
const PALETTES = [
  // Default
  {n:'Peach',    c:['#ee9e81','#FF6B35','#ec9db1','#FFBE0B','#f39468','#ecd5cb']},
  // Vibrant
  {n:'Sunset',   c:['#FF4500','#FF6B35','#FF006E','#FFBE0B','#FB5607']},
  {n:'Ocean',    c:['#03045E','#0077B6','#00B4D8','#90E0EF','#48CAE4']},
  // Muted / earthy
  {n:'Clay',     c:['#C9A882','#B8896A','#8B6F5E','#D4B89A','#A0785A']},
  {n:'Stone',    c:['#9EA7A0','#7D8C84','#B3BCB5','#5D6B64','#CDD4CF']},
  {n:'Dusk',     c:['#7B6FA0','#A08090','#C0A0B0','#806080','#503060']},
  {n:'Sage',     c:['#87A47A','#6B8C5E','#A8C49A','#4E7043','#C4D8BC']},
  // Contrasty
  {n:'Wildfire', c:['#E63946','#F4A261','#E9C46A','#2A9D8F','#264653']},
  {n:'Midnight', c:['#10002B','#3C096C','#7B2FBE','#C77DFF','#E0AAFF']},
  // Soft / pastel
  {n:'Chalk',    c:['#F2D0A4','#E8C4A2','#D4A373','#CDB4DB','#BDE0FE']},
  {n:'Fog',      c:['#DAD7CD','#A3B18A','#588157','#3A5A40','#344E41']},
];

// ═══════════════════════════════════
//  ELEMENTS
// ═══════════════════════════════════
const canvas  = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');
const handles = document.getElementById('handles');
const wrap    = document.getElementById('canvas-wrap');

// ═══════════════════════════════════
//  STATE
// ═══════════════════════════════════
let points    = [];
let selIdx    = -1;
let dragIdx   = -1;
let dragOX=0, dragOY=0;
let bgColor   = '#ffffff';
let blurAmt   = 90;
let sizeAmt   = 200;
let grainAmt  = 16;
let seed      = Math.floor(Math.random()*99999);
let ratio     = RATIOS[0];
let palettes  = PALETTES.map(p=>({...p, c:[...p.c]}));
let palIdx    = 0;
let CW=640, CH=360;
let hintGone  = false;
let expFormat = 'png';
let renderMode = 'mesh'; // mesh | conic | burst
let originX = 0.72, originY = 0.28; // normalized origin for conic/burst
let conicRotation = 0; // extra rotation offset in radians
let draggingOrigin = false;
let resizeIdx = -1;
let hideDots = false;
let history = []; // undo stack — each entry is a deep-copy of points
const MAX_HISTORY = 50;

// ═══════════════════════════════════
//  UTILS
// ═══════════════════════════════════
function sr(s){ let x=Math.sin(s+1)*14159.27; return x-Math.floor(x); }
function hexRgb(h){
  h=h.replace('#','');
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

// ─── HISTORY ───
function pushHistory(){
  history.push(JSON.parse(JSON.stringify(points)));
  if(history.length>MAX_HISTORY) history.shift();
}
function undo(){
  if(!history.length) return;
  points=history.pop();
  selIdx=clamp(selIdx,-1,points.length-1);
  updateSwatches(); updateColorEdit(); render();
}
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){ e.preventDefault(); undo(); }
});

// ─── HIDE DOTS ───
function toggleHideDots(){
  hideDots=!hideDots;
  const btn=document.getElementById('btn-hide-dots');
  btn.textContent=hideDots?'On':'Off';
  btn.style.background=hideDots?'var(--text)':'transparent';
  btn.style.color=hideDots?'var(--cream)':'var(--mid)';
  btn.style.borderColor=hideDots?'var(--text)':'var(--line)';
  render();
}

// ═══════════════════════════════════
//  SIZING
// ═══════════════════════════════════
function calcSize(){
  const m=document.getElementById('main');
  const mw=m.clientWidth-48, mh=m.clientHeight-48;
  const r=ratio.w/ratio.h;
  let w=mw, h=mw/r;
  if(h>mh){h=mh; w=mh*r;}
  CW=Math.round(w); CH=Math.round(h);
}
function applySize(){
  canvas.width=CW; canvas.height=CH;
  canvas.style.width=CW+'px'; canvas.style.height=CH+'px';
  handles.style.width=CW+'px'; handles.style.height=CH+'px';
  handles.setAttribute('width',CW); handles.setAttribute('height',CH);
  wrap.style.width=CW+'px'; wrap.style.height=CH+'px';
}

// ═══════════════════════════════════
//  POINTS INIT
// ═══════════════════════════════════
function initPoints(colors){
  const c=colors||palettes[palIdx].c;
  points=c.map((col,i)=>({
    x: 0.08+sr(seed*11+i*17)*0.84,
    y: 0.08+sr(seed*7+i*23)*0.84,
    color: col,
    size: 1.0,
  }));
}

// ═══════════════════════════════════
//  RENDER
// ═══════════════════════════════════
function drawBlobs(tc, w, h){
  tc.fillStyle=bgColor;
  tc.fillRect(0,0,w,h);

  for(let i=0;i<points.length;i++){
    const p=points[i];
    const px=p.x*w, py=p.y*h;
    const ps=p.size!=null?p.size:1.0;
    const baseR=sizeAmt*ps*Math.min(w,h)/450;
    const [r,g,b]=hexRgb(p.color);
    const blur=blurAmt*(w/CW);

    tc.save();
    tc.filter=`blur(${blur}px)`;

    const grad=tc.createRadialGradient(px,py,0,px,py,baseR*1.8);
    grad.addColorStop(0,    `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.25, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.72)`);
    grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);

    // organic blob shape
    const ns=seed*31+i*97;
    tc.beginPath();
    const segs=9;
    for(let s=0;s<=segs;s++){
      const a=(s/segs)*Math.PI*2;
      const nx=(sr(ns+s*41)-0.5)*0.35;
      const ny=(sr(ns+s*67)-0.5)*0.35;
      const rr=baseR*(1.4+nx);
      const x=px+Math.cos(a)*rr*(1+ny*0.3);
      const y=py+Math.sin(a)*rr*(1-nx*0.3);
      s===0?tc.moveTo(x,y):tc.lineTo(x,y);
    }
    tc.closePath();
    tc.fillStyle=grad;
    tc.fill();
    tc.restore();
  }

  if(grainAmt>0){
    const g2=grainAmt/100;
    const gc=document.createElement('canvas');
    gc.width=w; gc.height=h;
    const gx=gc.getContext('2d');
    const id=gx.createImageData(w,h);
    const d=id.data;
    for(let i=0;i<d.length;i+=4){
      const v=(Math.random()-0.5)*255*g2*0.55;
      d[i]=d[i+1]=d[i+2]=128+v; d[i+3]=Math.round(g2*75);
    }
    gx.putImageData(id,0,0);
    tc.save(); tc.globalCompositeOperation='overlay'; tc.drawImage(gc,0,0); tc.restore();
  }
}
function render(){
  if(renderMode==='mesh') drawBlobs(ctx,CW,CH);
  else if(renderMode==='conic') drawConic(ctx,CW,CH);
  else drawBurst(ctx,CW,CH);
  if(renderMode==='mesh' && !hideDots) drawHandles();
  else { handles.innerHTML=''; }
  updateOriginHandle();
}

// ═══════════════════════════════════
//  CONIC RENDER — layered arcs from origin
// ═══════════════════════════════════
function drawConic(tc,w,h){
  const colors=palettes[palIdx].c;
  const ox=originX*w, oy=originY*h;
  const maxR=Math.sqrt(Math.max(ox,w-ox)**2+Math.max(oy,h-oy)**2)*1.05;
  const n=colors.length;
  const softness=blurAmt*0.6*(w/CW);

  tc.fillStyle=bgColor; tc.fillRect(0,0,w,h);

  // Draw concentric arc bands from outside in
  const bands=n*2+2;
  for(let b=bands;b>=0;b--){
    const t=b/bands;
    const r=t*maxR;
    // map to color
    const ci=Math.floor(t*n);
    const cf=(t*n)-ci;
    const c1=hexRgb(colors[ci%n]);
    const c2=hexRgb(colors[(ci+1)%n]);
    const R=Math.round(c1[0]+(c2[0]-c1[0])*cf);
    const G=Math.round(c1[1]+(c2[1]-c1[1])*cf);
    const B=Math.round(c1[2]+(c2[2]-c1[2])*cf);

    tc.save();
    tc.filter=`blur(${softness}px)`;
    const grad=tc.createRadialGradient(ox,oy,Math.max(0,r-maxR/bands*1.5),ox,oy,r);
    grad.addColorStop(0,`rgba(${R},${G},${B},1)`);
    grad.addColorStop(1,`rgba(${R},${G},${B},0)`);
    tc.beginPath(); tc.arc(ox,oy,r,0,Math.PI*2); tc.fillStyle=grad; tc.fill();
    tc.restore();
  }

  // Add gentle grain
  applyGrain(tc,w,h);
}

// ═══════════════════════════════════
//  BURST RENDER — angular rays from focal point
// ═══════════════════════════════════
function drawBurst(tc,w,h){
  const colors=palettes[palIdx].c;
  const ox=originX*w, oy=originY*h;
  const maxR=Math.sqrt(w*w+h*h)*1.1;
  const n=colors.length;
  const rayCount=n*3; // rays per full circle
  const angleStep=(Math.PI*2)/rayCount;
  const softness=blurAmt*0.5*(w/CW);

  tc.fillStyle=bgColor; tc.fillRect(0,0,w,h);

  for(let i=0;i<rayCount;i++){
    const angle=i*angleStep+conicRotation;
    const col=hexRgb(colors[i%n]);
    const [r,g,b]=col;

    tc.save();
    tc.filter=`blur(${softness}px)`;

    // wedge shape
    const spread=angleStep*0.9;
    tc.beginPath();
    tc.moveTo(ox,oy);
    tc.arc(ox,oy,maxR,angle-spread/2,angle+spread/2);
    tc.closePath();

    const grad=tc.createRadialGradient(ox,oy,0,ox,oy,maxR);
    grad.addColorStop(0,   `rgba(${r},${g},${b},0.92)`);
    grad.addColorStop(0.18,`rgba(${r},${g},${b},0.85)`);
    grad.addColorStop(0.6, `rgba(${r},${g},${b},0.5)`);
    grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    tc.fillStyle=grad; tc.fill();
    tc.restore();
  }

  // bright core at origin
  tc.save();
  tc.filter=`blur(${softness*1.5}px)`;
  const core=tc.createRadialGradient(ox,oy,0,ox,oy,maxR*0.15);
  core.addColorStop(0,'rgba(255,255,255,0.85)');
  core.addColorStop(1,'rgba(255,255,255,0)');
  tc.beginPath(); tc.arc(ox,oy,maxR*0.15,0,Math.PI*2);
  tc.fillStyle=core; tc.fill(); tc.restore();

  applyGrain(tc,w,h);
}

// ═══════════════════════════════════
//  SHARED GRAIN
// ═══════════════════════════════════
function applyGrain(tc,w,h){
  if(grainAmt<=0) return;
  const g2=grainAmt/100;
  const gc=document.createElement('canvas'); gc.width=w; gc.height=h;
  const gx=gc.getContext('2d');
  const id=gx.createImageData(w,h); const d=id.data;
  for(let i=0;i<d.length;i+=4){
    const v=(Math.random()-0.5)*255*g2*0.55;
    d[i]=d[i+1]=d[i+2]=128+v; d[i+3]=Math.round(g2*75);
  }
  gx.putImageData(id,0,0);
  tc.save(); tc.globalCompositeOperation='overlay'; tc.drawImage(gc,0,0); tc.restore();
}

// ═══════════════════════════════════
//  ORIGIN HANDLE
// ═══════════════════════════════════
const originEl=document.getElementById('origin-handle');
function updateOriginHandle(){
  originEl.style.left=(originX*CW)+'px';
  originEl.style.top=(originY*CH)+'px';
}

// Origin drag
originEl.addEventListener('mousedown',e=>{
  e.preventDefault(); e.stopPropagation(); draggingOrigin=true;
});
window.addEventListener('mousemove',e=>{
  if(!draggingOrigin) return;
  const rect=canvas.getBoundingClientRect();
  originX=clamp((e.clientX-rect.left)/CW,0,1);
  originY=clamp((e.clientY-rect.top)/CH,0,1);
  render();
});
window.addEventListener('mouseup',()=>{ draggingOrigin=false; });

// ═══════════════════════════════════
//  SVG HANDLES
// ═══════════════════════════════════
const SVG='http://www.w3.org/2000/svg';
function el(tag,attrs){
  const e=document.createElementNS(SVG,tag);
  for(const k in attrs) e.setAttribute(k,attrs[k]);
  return e;
}
function pointRadius(p, w, h){
  const ps=p.size!=null?p.size:1.0;
  return sizeAmt*ps*Math.min(w,h)/450*1.8;
}

function drawHandles(){
  handles.innerHTML='';
  for(let i=0;i<points.length;i++){
    const p=points[i];
    const px=p.x*CW, py=p.y*CH, sel=i===selIdx;
    const ringR=Math.max(22, pointRadius(p,CW,CH));
    const g=el('g',{});

    // Size ring — only visible on selected point
    if(sel){
      const ring=el('circle',{
        cx:px, cy:py, r:ringR,
        fill:'none',
        stroke:'rgba(255,255,255,0.75)',
        'stroke-width':1.5,
        'stroke-dasharray':'4 3',
        style:'cursor:ew-resize',
      });
      g.appendChild(ring);
    }

    // Resize grab dot on ring (top of ring) — only when selected
    if(sel){
      const grabAngle=-Math.PI/2;
      const gx2=px+Math.cos(grabAngle)*ringR;
      const gy2=py+Math.sin(grabAngle)*ringR;
      const grabDot=el('circle',{cx:gx2,cy:gy2,r:5,fill:'white',stroke:p.color,'stroke-width':1.5,style:'cursor:n-resize'});
      g.appendChild(grabDot);
    }

    // Outer glow ring when selected
    if(sel) g.appendChild(el('circle',{cx:px,cy:py,r:15,fill:'none',stroke:'rgba(255,255,255,0.35)','stroke-width':1.2}));

    // Center dot (white ring + color fill)
    g.appendChild(el('circle',{cx:px,cy:py,r:sel?10.5:8,fill:'white',stroke:sel?p.color:'rgba(255,255,255,0.5)','stroke-width':sel?2.5:1.5}));
    g.appendChild(el('circle',{cx:px,cy:py,r:sel?6:4.5,fill:p.color}));

    handles.appendChild(g);
  }
}

// ═══════════════════════════════════
//  INTERACTION
// ═══════════════════════════════════
function onCanvas(cx,cy){ const r=canvas.getBoundingClientRect(); return{x:cx-r.left,y:cy-r.top}; }

// Returns index of point whose resize ring was hit (annular zone around ring)
function hitRing(mx,my,th=10){
  for(let i=points.length-1;i>=0;i--){
    const p=points[i];
    const px=p.x*CW, py=p.y*CH;
    const ringR=Math.max(22, pointRadius(p,CW,CH));
    const dx=px-mx, dy=py-my;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if(Math.abs(dist-ringR)<th) return i;
  } return -1;
}

function hitTest(mx,my,th=18){
  for(let i=points.length-1;i>=0;i--){
    const dx=points[i].x*CW-mx, dy=points[i].y*CH-my;
    if(dx*dx+dy*dy<th*th) return i;
  } return -1;
}

function startDrag(cx,cy,touch=false){
  const {x,y}=onCanvas(cx,cy);
  // Check ring first (only for selected point to avoid accidental triggers)
  const ringHit=hitRing(x,y,touch?14:9);
  if(ringHit>=0){
    pushHistory();
    resizeIdx=ringHit; selIdx=ringHit;
    updateSwatches(); updateColorEdit(); render(); killHint();
    return;
  }
  const hit=hitTest(x,y,touch?26:18);
  if(hit>=0){
    pushHistory();
    dragIdx=hit; selIdx=hit;
    dragOX=x-points[hit].x*CW; dragOY=y-points[hit].y*CH;
  } else {
    pushHistory();
    const pal=palettes[palIdx];
    const col=pal.c[Math.floor(Math.random()*pal.c.length)];
    points.push({x:x/CW,y:y/CH,color:col,size:1.0});
    selIdx=points.length-1; dragIdx=selIdx; dragOX=0; dragOY=0;
  }
  updateSwatches(); updateColorEdit(); render(); killHint();
}

function moveDrag(cx,cy){
  const {x,y}=onCanvas(cx,cy);
  if(resizeIdx>=0){
    const p=points[resizeIdx];
    const px=p.x*CW, py=p.y*CH;
    const dist=Math.sqrt((x-px)**2+(y-py)**2);
    // Convert pixel distance to size value
    // base radius at size=1: sizeAmt*1*min(CW,CH)/450*1.8
    const baseRadiusAtOne=sizeAmt*Math.min(CW,CH)/450*1.8;
    const newSize=clamp(dist/Math.max(baseRadiusAtOne,1), 0.08, 4.0);
    points[resizeIdx].size=newSize;
    render(); return;
  }
  if(dragIdx<0) return;
  points[dragIdx].x=clamp((x-dragOX)/CW,0,1);
  points[dragIdx].y=clamp((y-dragOY)/CH,0,1);
  render(); showTip(cx,cy,points[dragIdx].color);
}

wrap.addEventListener('mousedown',e=>{e.preventDefault();startDrag(e.clientX,e.clientY);});
window.addEventListener('mousemove',e=>{
  if(resizeIdx>=0||dragIdx>=0){moveDrag(e.clientX,e.clientY);return;}
  const {x,y}=onCanvas(e.clientX,e.clientY);
  if(e.target===canvas||e.target===handles){
    const ringHit=hitRing(x,y,9);
    const h=hitTest(x,y);
    if(ringHit>=0) wrap.style.cursor='ew-resize';
    else if(h>=0){ wrap.style.cursor='grab'; showTip(e.clientX,e.clientY,points[h].color); }
    else { wrap.style.cursor='crosshair'; hideTip(); }
    if(ringHit<0&&h<0) hideTip();
  } else hideTip();
});
window.addEventListener('mouseup',()=>{dragIdx=-1; resizeIdx=-1; hideTip();});

wrap.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];startDrag(t.clientX,t.clientY,true);},{passive:false});
window.addEventListener('touchmove',e=>{if(dragIdx>=0){e.preventDefault();const t=e.touches[0];moveDrag(t.clientX,t.clientY);}},{passive:false});
window.addEventListener('touchend',()=>{dragIdx=-1; resizeIdx=-1; hideTip();});

window.addEventListener('mousedown',e=>{
  if(!wrap.contains(e.target)&&!document.getElementById('sidebar').contains(e.target)){
    selIdx=-1;updateSwatches();updateColorEdit();drawHandles();
  }
});

// ═══════════════════════════════════
//  TOOLTIP
// ═══════════════════════════════════
const tip=document.getElementById('tooltip');
function showTip(cx,cy,color){
  tip.textContent=color.toUpperCase();
  tip.style.left=cx+'px'; tip.style.top=cy+'px';
  tip.classList.add('show');
}
function hideTip(){tip.classList.remove('show');}

// ═══════════════════════════════════
//  HINT
// ═══════════════════════════════════
function killHint(){
  if(hintGone)return; hintGone=true;
  document.getElementById('hint').style.opacity='0';
}

// ═══════════════════════════════════
//  UI — SWATCHES
// ═══════════════════════════════════
function updateSwatches(){
  const c=document.getElementById('swatches'); c.innerHTML='';
  points.forEach((p,i)=>{
    const s=document.createElement('div');
    s.className='swatch'+(i===selIdx?' sel':'');
    s.style.background=p.color;
    s.onclick=()=>{selIdx=i;updateSwatches();updateColorEdit();drawHandles();};
    c.appendChild(s);
  });
}

// ═══════════════════════════════════
//  UI — COLOR EDITOR
// ═══════════════════════════════════
function updateColorEdit(){
  const ce=document.getElementById('color-edit');
  if(selIdx<0||selIdx>=points.length){ce.classList.remove('on');return;}
  ce.classList.add('on');
  const col=points[selIdx].color;
  document.getElementById('clr-preview').style.background=col;
  document.getElementById('clr-hex').value=col;
  document.getElementById('clr-native').value=col;
}
document.getElementById('clr-preview').onclick=()=>document.getElementById('clr-native').click();
document.getElementById('clr-native').addEventListener('input',e=>{
  if(selIdx<0)return;
  const v=e.target.value; points[selIdx].color=v;
  document.getElementById('clr-hex').value=v;
  document.getElementById('clr-preview').style.background=v;
  updateSwatches(); render();
});
document.getElementById('clr-hex').addEventListener('input',e=>{
  const v=e.target.value;
  if(/^#[0-9a-fA-F]{6}$/.test(v)&&selIdx>=0){
    points[selIdx].color=v;
    document.getElementById('clr-preview').style.background=v;
    document.getElementById('clr-native').value=v;
    updateSwatches(); render();
  }
});
document.getElementById('del-pt').onclick=()=>{
  if(selIdx<0)return;
  pushHistory();
  points.splice(selIdx,1);
  selIdx=points.length>0?clamp(selIdx,0,points.length-1):-1;
  updateSwatches(); updateColorEdit(); render();
};

// ═══════════════════════════════════
//  MODE BUTTONS
// ═══════════════════════════════════
document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    renderMode=btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    document.body.dataset.mode=renderMode;
    // reset origin to sensible default per mode
    if(renderMode==='conic'){ originX=0.72; originY=0.28; }
    if(renderMode==='burst'){ originX=0.5; originY=0.5; }
    render();
  });
});

// ═══════════════════════════════════
//  SHUFFLE / COLORS
// ═══════════════════════════════════
document.getElementById('btn-shuffle').onclick=()=>{
  pushHistory();
  seed=Math.floor(Math.random()*99999);
  document.getElementById('seed-num').textContent=String(seed).padStart(5,'0');
  if(renderMode==='mesh'){
    const cols=points.map(p=>p.color);
    points.forEach((p,i)=>{p.x=0.05+sr(seed*11+i*17)*0.9; p.y=0.05+sr(seed*7+i*23)*0.9; p.color=cols[i];});
  } else {
    // randomize origin position
    originX=0.1+sr(seed*17)*0.8; originY=0.1+sr(seed*31)*0.8;
    conicRotation=sr(seed*53)*Math.PI*2;
  }
  render();
};
// ═══════════════════════════════════
//  SLIDERS
// ═══════════════════════════════════
document.getElementById('sl-blur').addEventListener('input',e=>{blurAmt=+e.target.value;document.getElementById('vl-blur').textContent=blurAmt;render();});
document.getElementById('sl-size').addEventListener('input',e=>{sizeAmt=+e.target.value;document.getElementById('vl-size').textContent=sizeAmt;render();});
document.getElementById('sl-grain').addEventListener('input',e=>{grainAmt=+e.target.value;document.getElementById('vl-grain').textContent=grainAmt;render();});

// ═══════════════════════════════════
//  RATIO
// ═══════════════════════════════════
function buildRatios(){
  const g=document.getElementById('ratio-grid'); g.innerHTML='';
  RATIOS.forEach((r,i)=>{
    const b=document.createElement('button');
    b.className='chip'+(r===ratio?' on':'');
    b.textContent=r.l;
    b.onclick=()=>{
      ratio=r;
      document.querySelectorAll('#ratio-grid .chip').forEach((x,j)=>x.classList.toggle('on',j===i));
      // sync export dims
      const ew=+document.getElementById('exp-w').value;
      document.getElementById('exp-h').value=Math.round(ew*r.h/r.w);
      calcSize(); applySize(); render();
    };
    g.appendChild(b);
  });
}

// ═══════════════════════════════════
//  BACKGROUND
// ═══════════════════════════════════
function buildBgDots(){
  const row=document.getElementById('bg-dots'); row.innerHTML='';
  BG_DOTS.forEach((col,i)=>{
    const d=document.createElement('div');
    d.className='bg-dot'+(col===bgColor?' on':'');
    d.style.background=col;
    if(col==='#ffffff') d.style.border='1px solid rgba(0,0,0,0.1)';
    d.onclick=()=>{
      bgColor=col;
      document.getElementById('bg-hex').value=col;
      document.getElementById('bg-thumb').style.background=col;
      document.getElementById('bg-picker').value=col;
      document.querySelectorAll('.bg-dot').forEach((x,j)=>x.classList.toggle('on',j===i));
      render();
    };
    row.appendChild(d);
  });
  document.getElementById('bg-thumb').style.background=bgColor;
}
document.getElementById('bg-hex').addEventListener('input',e=>{
  const v=e.target.value;
  if(/^#[0-9a-fA-F]{6}$/.test(v)){
    bgColor=v;
    document.getElementById('bg-thumb').style.background=v;
    document.getElementById('bg-picker').value=v;
    document.querySelectorAll('.bg-dot').forEach(x=>x.classList.remove('on'));
    render();
  }
});
document.getElementById('bg-thumb').onclick=()=>document.getElementById('bg-picker').click();
document.getElementById('bg-picker').addEventListener('input',e=>{
  bgColor=e.target.value;
  document.getElementById('bg-hex').value=bgColor;
  document.getElementById('bg-thumb').style.background=bgColor;
  render();
});

// ═══════════════════════════════════
//  PALETTES
// ═══════════════════════════════════
function buildPalettes(){
  const list=document.getElementById('pal-list'); list.innerHTML='';
  palettes.forEach((pal,i)=>{
    const row=document.createElement('div');
    row.className='pal-row'+(i===palIdx?' on':'');
    const sw=document.createElement('div'); sw.className='pal-swatches';
    pal.c.slice(0,5).forEach(c=>{
      const s=document.createElement('div'); s.className='ps'; s.style.background=c; sw.appendChild(s);
    });
    const nm=document.createElement('span'); nm.className='pal-name'; nm.textContent=pal.n;
    row.appendChild(sw); row.appendChild(nm);
    row.onclick=()=>{
      palIdx=i; buildPalettes();
      const cols=pal.c;
      while(points.length<cols.length&&points.length<8){
        points.push({x:0.1+sr(seed*3+points.length*19)*0.8,y:0.1+sr(seed*5+points.length*29)*0.8,color:cols[points.length],size:1.0});
      }
      points.forEach((p,j)=>{p.color=cols[j%cols.length];});
      updateSwatches(); updateColorEdit(); render();
    };
    list.appendChild(row);
  });
}
document.getElementById('save-pal').onclick=()=>{
  if(!points.length) return;
  const name=prompt('Name this palette:','My palette '+(palettes.length+1));
  if(!name) return;
  palettes.push({n:name, c:points.map(p=>p.color)});
  palIdx=palettes.length-1; buildPalettes();
};

// ═══════════════════════════════════
//  FORMAT TOGGLE
// ═══════════════════════════════════
['fmt-png','fmt-svg','fmt-css'].forEach(id=>{
  document.getElementById(id).addEventListener('click',()=>{
    expFormat=id.replace('fmt-','');
    document.querySelectorAll('.fmt-btn').forEach(b=>b.style.background='');
    document.getElementById(id).style.background='rgba(0,0,0,0.07)';
  });
});

// keep h in sync with w when ratio locked
document.getElementById('exp-w').addEventListener('change',e=>{
  const ew=+e.target.value||1920;
  document.getElementById('exp-h').value=Math.round(ew*ratio.h/ratio.w);
});
document.getElementById('exp-h').addEventListener('change',e=>{
  const eh=+e.target.value||1080;
  document.getElementById('exp-w').value=Math.round(eh*ratio.w/ratio.h);
});

// ═══════════════════════════════════
//  EXPORT
// ═══════════════════════════════════
document.getElementById('export-btn').onclick=()=>{
  const ew=clamp(+document.getElementById('exp-w').value||1920,1,8000);
  const eh=clamp(+document.getElementById('exp-h').value||1080,1,8000);
  if(expFormat==='png') exportPNG(ew,eh,null);
  else if(expFormat==='svg') exportSVG(ew,eh);
  else copyCSS();
};

function exportPNG(ew,eh,s){
  // s = optional seed override for iterate
  const tmp=document.createElement('canvas');
  tmp.width=ew; tmp.height=eh;
  const tc=tmp.getContext('2d');
  const oCW=CW,oCH=CH; CW=ew; CH=eh;
  if(s!=null && renderMode==='mesh'){
    // render with this seed's positions, keeping current colors
    const savedPoints=JSON.parse(JSON.stringify(points));
    const cols=points.map(p=>p.color);
    const sizes=points.map(p=>p.size!=null?p.size:1.0);
    points.forEach((p,i)=>{
      p.x=0.05+sr(s*11+i*17)*0.9;
      p.y=0.05+sr(s*7+i*23)*0.9;
    });
    drawBlobs(tc,ew,eh);
    points=savedPoints;
  } else if(s!=null && renderMode!=='mesh'){
    const oX=originX, oY=originY, oR=conicRotation;
    originX=0.1+sr(s*17)*0.8; originY=0.1+sr(s*31)*0.8;
    conicRotation=sr(s*53)*Math.PI*2;
    if(renderMode==='conic') drawConic(tc,ew,eh);
    else drawBurst(tc,ew,eh);
    originX=oX; originY=oY; conicRotation=oR;
  } else {
    if(renderMode==='mesh') drawBlobs(tc,ew,eh);
    else if(renderMode==='conic') drawConic(tc,ew,eh);
    else drawBurst(tc,ew,eh);
  }
  CW=oCW; CH=oCH;
  const a=document.createElement('a');
  const label=s!=null?s:seed;
  a.download=`blur-${label}.png`; a.href=tmp.toDataURL('image/png'); a.click();
}

async function iterateExport(){
  const btn=document.getElementById('iterate-btn');
  const ew=clamp(+document.getElementById('exp-w').value||1920,1,8000);
  const eh=clamp(+document.getElementById('exp-h').value||1080,1,8000);
  btn.disabled=true;
  const total=10;
  for(let i=0;i<total;i++){
    btn.textContent=`Exporting ${i+1} / ${total}…`;
    const iterSeed=Math.floor(Math.random()*99999);
    exportPNG(ew,eh,iterSeed);
    await new Promise(r=>setTimeout(r,300)); // stagger downloads
  }
  btn.textContent='Iterate × 10';
  btn.disabled=false;
}

document.getElementById('iterate-btn').onclick=iterateExport;

function exportSVG(ew,eh){
  const defs=points.map((p,i)=>{
    const [r,g,b]=hexRgb(p.color);
    const rx=(p.x*ew).toFixed(1),ry=(p.y*eh).toFixed(1);
    const rad=(sizeAmt*Math.min(ew,eh)/450*1.8).toFixed(1);
    const bl=(blurAmt*(ew/CW)).toFixed(1);
    return `<radialGradient id="rg${i}" gradientUnits="userSpaceOnUse" cx="${rx}" cy="${ry}" r="${rad}">
  <stop offset="0%" stop-color="rgb(${r},${g},${b})" stop-opacity="1"/>
  <stop offset="25%" stop-color="rgb(${r},${g},${b})" stop-opacity="1"/>
  <stop offset="60%" stop-color="rgb(${r},${g},${b})" stop-opacity="0.65"/>
  <stop offset="100%" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/>
</radialGradient>`;
  }).join('\n');
  const circles=points.map((p,i)=>{
    const rad=(sizeAmt*Math.min(ew,eh)/450*1.8).toFixed(1);
    const bl=(blurAmt*(ew/CW)).toFixed(1);
    return `<circle cx="${(p.x*ew).toFixed(1)}" cy="${(p.y*eh).toFixed(1)}" r="${rad}" fill="url(#rg${i})" filter="url(#b${i})"/>`;
  }).join('\n');
  const filters=points.map((p,i)=>{
    const bl=(blurAmt*(ew/CW)).toFixed(1);
    return `<filter id="b${i}"><feGaussianBlur stdDeviation="${bl}"/></filter>`;
  }).join('\n');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${ew}" height="${eh}" viewBox="0 0 ${ew} ${eh}">
<defs>${filters}\n${defs}</defs>
<rect width="${ew}" height="${eh}" fill="${bgColor}"/>
${circles}
</svg>`;
  const a=document.createElement('a');
  a.download=`blur-${seed}.svg`;
  a.href='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); a.click();
}

async function copyCSS(){
  const grads=points.map(p=>{
    const [r,g,b]=hexRgb(p.color);
    return `radial-gradient(ellipse ${Math.round(sizeAmt*0.55)}% ${Math.round(sizeAmt*0.55)}% at ${(p.x*100).toFixed(1)}% ${(p.y*100).toFixed(1)}%, rgb(${r},${g},${b}) 0%, transparent 70%)`;
  });
  const css=`background-color: ${bgColor};\nbackground-image:\n  ${grads.join(',\n  ')};`;
  try {
    await navigator.clipboard.writeText(css);
    const btn=document.getElementById('export-btn'),orig=btn.textContent;
    btn.textContent='Copied!'; setTimeout(()=>btn.textContent=orig,1800);
  } catch { alert('Could not copy'); }
}

// ═══════════════════════════════════
//  RESIZE
// ═══════════════════════════════════
let rt;
window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{calcSize();applySize();render();},80);});

// ═══════════════════════════════════
//  INIT
// ═══════════════════════════════════
window.addEventListener('load',()=>{
  document.body.dataset.mode='mesh';
  buildRatios(); buildBgDots(); buildPalettes();
  calcSize(); applySize();
  initPoints();
  render();
  updateSwatches();
  document.getElementById('seed-num').textContent=String(seed).padStart(5,'0');
  document.getElementById('bg-hex').value=bgColor;
  document.getElementById('bg-thumb').style.background=bgColor;
  // set default export dims from ratio
  document.getElementById('exp-w').value=1920;
  document.getElementById('exp-h').value=1080;
});

