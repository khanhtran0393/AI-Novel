/* ═══ 4. Motion engine ══════════════════════════════════════ */
function bezier(x1,y1,x2,y2){
  const cx=3*x1, bx=3*(x2-x1)-cx, ax=1-cx-bx;
  const cy=3*y1, by=3*(y2-y1)-cy, ay=1-cy-by;
  const fx=t=>((ax*t+bx)*t+cx)*t, dfx=t=>(3*ax*t+2*bx)*t+cx;
  return x=>{ let t=x; for(let i=0;i<6;i++){const e=fx(t)-x, d=dfx(t); if(Math.abs(e)<1e-5)break; if(!d)break; t-=e/d;}
    return ((ay*t+by)*t+cy)*t; };
}
const EASINGS = {
  'linear': t=>t,
  'ease-out': bezier(0,0,.58,1),
  'ease-in-out': bezier(.42,0,.58,1),
  'cubic-bezier(0.22, 1, 0.36, 1)': bezier(.22,1,.36,1),
  'cubic-bezier(0.16, 1, 0.3, 1)': bezier(.16,1,.3,1),
  'cubic-bezier(0.34, 1.56, 0.64, 1)': bezier(.34,1.56,.64,1),
  'cubic-bezier(0.7, 0, 0.84, 0)': bezier(.7,0,.84,0)
};
function easeFn(name){
  if(EASINGS[name]) return EASINGS[name];
  const m = /cubic-bezier\(([^)]+)\)/.exec(name||'');
  if(m){ const n = m[1].split(',').map(Number); if(n.length===4 && n.every(v=>!isNaN(v))) return EASINGS[name]=bezier(...n); }
  return EASINGS['cubic-bezier(0.22, 1, 0.36, 1)'];
}
const cl01 = v => v<0?0:v>1?1:v;
const seg = (t,a,b) => cl01((t-a)/Math.max(1e-6,b-a));
const lerp = (a,b,t) => a+(b-a)*t;
const el = (tag,css,html) => { const n=document.createElement(tag); if(css)n.style.cssText=css; if(html!=null)n.innerHTML=html; return n; };
const px = v => v+'px';

/* --- archetype resolution --- */
function archetype(it){
  const d = it.data, id = d.id, cat = d.category || '';
  if(it.lib==='transition') return 'transitionAB';
  if(it.lib==='remotion'){
    const by = {titles_typography:'title', lower_thirds:'lowerThird', transitions_wipes:'wipe',
      callouts_badges:'callout', social_cta:'cta', logo_brand:'logo', timers_counters:'counter',
      hud_tech:'hud', shapes_lines:'shape', lists_bullets:'list', photo_video_frames:'frame',
      backgrounds_atmosphere:'background'};
    return by[cat] || 'title';
  }
  if(/avatar|presenter/.test(id)) return 'avatar';
  if(/browser/.test(id)) return 'browser';
  if(/search/.test(id)) return 'search';
  if(/chart|pie|pyramid|box-chart|dashboard/.test(id)) return 'chart';
  if(/node-path|milestone|link-line|link-circles|overlap|progress-line|phase-line|story-rail|point-burst/.test(id)) return 'nodePath';
  if(/card-lane|triptych|collage|stack|frame|video-frame|cutout|profile|social-post/.test(id)) return 'cards';
  if(/newspaper|article|classical|opener-card/.test(id)) return 'newspaper';
  if(/highlight/.test(id)) return 'highlight';
  if(/outro/.test(id)) return 'outro';
  if(/opener|logo|aperture|slam|shatter/.test(id)) return 'logo';
  return 'title';
}

/* --- shared bits --- */
function media(w,h,tone,seed){
  const hues=[210,262,28,168,340], hu=hues[seed%hues.length];
  return `background:
    radial-gradient(120% 90% at 22% 18%, hsl(${hu} 62% 46% / .85), transparent 62%),
    radial-gradient(110% 80% at 82% 88%, hsl(${(hu+58)%360} 58% 38% / .8), transparent 58%),
    linear-gradient(150deg,#1a2330,#0d131c);width:${w}px;height:${h}px`;
}
function stripes(c){ return `repeating-linear-gradient(115deg, ${c}22 0 18px, transparent 18px 40px)`; }

/* --- renderers: build(stage,P) -> nodes ; update(nodes,t,P) --- */
const AR = {};

AR.title = {
  build(st,P){
    const words = (P.headline||'Headline').split(/\s+/).slice(0,6);
    const wrap = el('div',`position:absolute;inset:0;display:grid;place-items:center;background:${P.bg}`);
    const line = el('div','display:flex;gap:22px;flex-wrap:wrap;justify-content:center;max-width:1500px;position:relative');
    const plate = el('div',`position:absolute;inset:-26px -40px;border-radius:18px;background:${P.accent};opacity:0;z-index:0`);
    line.appendChild(plate);
    const ws = words.map((w,i)=>{
      const n = el('div',`position:relative;z-index:1;font-size:118px;font-weight:800;letter-spacing:-3px;color:${P.fg};white-space:nowrap`);
      const bar = el('div',`position:absolute;left:-10px;right:-10px;top:14%;bottom:14%;background:${P.accent};transform-origin:left;transform:scaleX(0);z-index:-1;border-radius:4px`);
      const tx = el('span','position:relative;display:inline-block',w);
      n.append(bar,tx); line.appendChild(n); return {n,bar,tx};
    });
    const sub = el('div',`position:absolute;bottom:250px;left:0;right:0;text-align:center;font-size:30px;
      letter-spacing:7px;text-transform:uppercase;color:${P.fg}99`, P.dek||'');
    wrap.append(line,sub); st.appendChild(wrap);
    return {ws,sub,plate,line};
  },
  update(N,t,P){
    const E=P.ease, v=P.variant;
    N.ws.forEach((w,i)=>{
      const a = P.delay + i*P.stagger, p = E(seg(t*P.dur, a, a+P.aDur));
      w.n.style.opacity = v==='tracking'?p:p;
      if(v==='typewriter'){ w.n.style.opacity=1;
        const chars = Math.round(p*w.tx.textContent.length);
        w.tx.style.clipPath=`inset(0 ${100-100*p}% 0 0)`;
      } else if(v==='mask'){ w.n.style.opacity=1; w.tx.style.clipPath=`inset(0 ${100-100*p}% 0 0)`; }
      else if(v==='tracking'){ w.n.style.letterSpacing = px(lerp(46,-3,p)); w.n.style.transform='none'; }
      else if(v==='pop'){ w.n.style.transform=`scale(${lerp(.72,1,p)})`; }
      else { w.n.style.transform=`translateY(${lerp(P.dist,0,p)}px)`; }
      if(v==='highlight' && i===Math.min(1,N.ws.length-1)){
        const h = E(seg(t*P.dur, a+.42, a+.42+.4)); w.bar.style.transform=`scaleX(${h})`;
        w.n.style.color = h>.5? '#0B0F14' : P.fg;
      }
      if(v==='duotone') w.n.style.color = i%2 ? P.accent : P.fg;
    });
    if(v==='plate'){ const p=E(seg(t*P.dur,0,.5)); N.plate.style.opacity=.16*p; N.plate.style.transform=`scale(${lerp(.9,1,p)})`; }
    N.sub.style.opacity = E(seg(t*P.dur,.5,1.1));
  }
};

AR.lowerThird = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg}`);
    wrap.appendChild(el('div',media(1920,1080,P.bg,3)+';position:absolute;inset:0;opacity:.5'));
    const box = el('div','position:absolute;left:150px;bottom:200px;display:flex;align-items:stretch;gap:0');
    const bar = el('div',`width:12px;background:${P.accent};border-radius:6px 0 0 6px`);
    const body = el('div',`background:rgba(9,13,19,.86);backdrop-filter:blur(6px);padding:26px 54px 26px 34px;border-radius:0 8px 8px 0`);
    const nm = el('div',`font-size:64px;font-weight:700;color:${P.fg};letter-spacing:-1px`, P.headline||'Tên nhân vật');
    const role = el('div',`font-size:30px;letter-spacing:5px;text-transform:uppercase;color:${P.accent};margin-top:8px`, P.dek||'Chức danh · Vai trò');
    body.append(nm,role); box.append(bar,body); wrap.appendChild(box);
    const cover = el('div',`position:absolute;left:150px;bottom:200px;height:160px;background:${P.accent};border-radius:8px`);
    wrap.appendChild(cover);
    st.appendChild(wrap); return {box,cover,nm,role,bar};
  },
  update(N,t,P){
    const E=P.ease, p = E(seg(t*P.dur, P.delay, P.delay+P.aDur));
    N.box.style.transform = `translateX(${lerp(-P.dist-120,0,p)}px)`; N.box.style.opacity = cl01(p*1.4);
    const w = N.box.offsetWidth||760;
    const q = E(seg(t*P.dur, P.delay+.25, P.delay+.25+.45));
    N.cover.style.width = px(w * (q<.5 ? q*2 : (1-q)*2));
    N.cover.style.left = px(150 + (q<.5?0:w*(q-.5)*2));
    N.cover.style.opacity = q>0 && q<1 ? 1 : 0;
    const o = E(seg(t*P.dur,.72,1)); N.box.style.opacity = p*(1-o*.98);
  }
};

AR.wipe = {
  build(st,P){
    const wrap = el('div','position:absolute;inset:0;overflow:hidden');
    const a = el('div', media(1920,1080,P.bg,1)+';position:absolute;inset:0');
    const b = el('div', media(1920,1080,P.bg,4)+';position:absolute;inset:0');
    const cover = el('div',`position:absolute;inset:0;background:${P.accent}`);
    const lbl = el('div',`position:absolute;left:0;right:0;bottom:120px;text-align:center;font-size:34px;
      letter-spacing:8px;text-transform:uppercase;color:${P.fg};text-shadow:0 4px 20px rgba(0,0,0,.6)`,P.headline||'');
    wrap.append(a,b,cover,lbl); st.appendChild(wrap); return {a,b,cover,lbl};
  },
  update(N,t,P){
    const E=P.ease, p=E(cl01(t*1.05));
    const dir = P.variant;
    const set = (n,ins)=>{ n.style.clipPath=`inset(${ins})`; };
    if(dir==='up')      { set(N.b,`${(1-p)*100}% 0 0 0`); N.cover.style.clipPath=`inset(${(1-p)*100}% 0 ${Math.max(0,p*100-6)}% 0)`; }
    else if(dir==='down'){ set(N.b,`0 0 ${(1-p)*100}% 0`); N.cover.style.clipPath=`inset(${Math.max(0,p*100-6)}% 0 ${(1-p)*100}% 0)`; }
    else if(dir==='right'){ set(N.b,`0 0 0 ${(1-p)*100}%`); N.cover.style.clipPath=`inset(0 ${(1-p)*100}% 0 ${Math.max(0,p*100-6)}%)`; }
    else if(dir==='circle'){ const r=p*130; N.b.style.clipPath=`circle(${r}% at 50% 50%)`; N.cover.style.clipPath=`circle(${Math.max(0,r-4)}% at 50% 50%)`; N.cover.style.opacity=p<1?.35:0; }
    else if(dir==='split'){ N.b.style.clipPath=`inset(0 ${50-p*50}% 0 ${50-p*50}%)`; N.cover.style.clipPath=`inset(0 ${50-p*50}% 0 ${50-p*50}%)`; N.cover.style.opacity=.25; }
    else if(dir==='flash'){ N.b.style.clipPath='inset(0)'; N.b.style.opacity = t>.5?1:0; N.cover.style.opacity = Math.max(0,1-Math.abs(t-.5)*9); N.cover.style.background='#fff'; N.cover.style.clipPath='inset(0)'; }
    else if(dir==='blurzoom'){ N.b.style.clipPath='inset(0)'; N.b.style.opacity=E(seg(t,.35,.75));
      const z=1+Math.sin(cl01(t)*Math.PI)*.25, bl=Math.sin(cl01(t)*Math.PI)*14;
      N.a.style.transform=N.b.style.transform=`scale(${z})`; N.a.style.filter=N.b.style.filter=`blur(${bl}px)`; N.cover.style.opacity=0; }
    else if(dir==='stripe'){ let c=''; for(let i=0;i<8;i++){ const q=cl01((p-i*.05)*1.6)*100; c+= `${q}%`; }
      N.b.style.clipPath=`inset(0 ${(1-p)*100}% 0 0)`; N.cover.style.background=stripes(P.accent); N.cover.style.opacity=1-p; N.cover.style.clipPath='inset(0)'; }
    else if(dir==='diagonal'){ N.b.style.clipPath=`polygon(0 0, ${p*180}% 0, ${p*180-80}% 100%, 0 100%)`; N.cover.style.clipPath=`polygon(${p*180-6}% 0, ${p*180}% 0, ${p*180-80}% 100%, ${p*180-86}% 100%)`; }
    else                { set(N.b,`0 ${(1-p)*100}% 0 0`); N.cover.style.clipPath=`inset(0 ${Math.max(0,(1-p)*100-6)}% 0 ${p*100}%)`; }
    N.lbl.style.opacity = cl01(1-Math.abs(t-.5)*2.4);
  }
};

AR.callout = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg}`);
    wrap.appendChild(el('div',media(1920,1080,P.bg,2)+';position:absolute;inset:0;opacity:.6'));
    const ring = el('div',`position:absolute;left:640px;top:380px;width:300px;height:300px;border-radius:50%;
      border:8px solid ${P.accent};box-sizing:border-box`);
    const ring2 = el('div',`position:absolute;left:640px;top:380px;width:300px;height:300px;border-radius:50%;
      border:4px solid ${P.accent};opacity:.5`);
    const line = el('div',`position:absolute;left:940px;top:530px;height:4px;background:${P.accent};transform-origin:left;width:340px`);
    const tag = el('div',`position:absolute;left:1290px;top:472px;padding:20px 34px;border-radius:12px;
      background:${P.accent};color:#0B0F14;font-size:44px;font-weight:800;white-space:nowrap`, P.headline||'Callout');
    wrap.append(ring2,ring,line,tag); st.appendChild(wrap); return {ring,ring2,line,tag};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    const p = E(seg(T,P.delay,P.delay+P.aDur));
    N.ring.style.transform=`scale(${lerp(.4,1,p)})`; N.ring.style.opacity=p;
    const pulse = (T*1.4)%1; N.ring2.style.transform=`scale(${lerp(1,1.5,pulse)})`; N.ring2.style.opacity=(1-pulse)*.55*p;
    const q = E(seg(T,P.delay+.25,P.delay+.75)); N.line.style.transform=`scaleX(${q})`;
    const r = E(seg(T,P.delay+.5,P.delay+1.05));
    N.tag.style.opacity=r; N.tag.style.transform=`translateX(${lerp(-40,0,r)}px) scale(${lerp(.9,1,r)})`;
  }
};

AR.cta = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center`);
    wrap.appendChild(el('div',media(1920,1080,P.bg,0)+';position:absolute;inset:0;opacity:.45'));
    const pill = el('div',`position:relative;display:flex;align-items:center;gap:26px;padding:30px 56px;border-radius:999px;
      background:${P.accent};box-shadow:0 24px 60px ${P.accent}55`);
    const ico = el('div',`width:66px;height:66px;border-radius:50%;background:rgba(0,0,0,.24);display:grid;place-items:center;
      font-size:34px`,'▲');
    const tx = el('div','font-size:54px;font-weight:800;color:#0B0F14;white-space:nowrap', P.headline||'Subscribe');
    pill.append(ico,tx); wrap.appendChild(pill);
    const halo = el('div',`position:absolute;width:640px;height:180px;border-radius:999px;border:5px solid ${P.accent}`);
    wrap.appendChild(halo);
    st.appendChild(wrap); return {pill,ico,halo};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, p=E(seg(T,P.delay,P.delay+P.aDur));
    N.pill.style.transform=`translateY(${lerp(P.dist,0,p)}px) scale(${lerp(.85,1,p)})`; N.pill.style.opacity=p;
    const b = Math.sin(T*4)*.03+1; if(p>=1) N.pill.style.transform=`scale(${b})`;
    const h=(T*.9)%1; N.halo.style.transform=`scale(${lerp(1,1.6,h)})`; N.halo.style.opacity=(1-h)*.5*p;
    N.ico.style.transform=`rotate(${Math.sin(T*6)*12}deg)`;
  }
};

AR.logo = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center;overflow:hidden`);
    const stripe = el('div',`position:absolute;inset:0;background:${stripes(P.accent)};opacity:0`);
    const mark = el('div',`position:relative;width:210px;height:210px;border-radius:26px;
      background:linear-gradient(140deg,${P.accent},${P.accent}77);display:grid;place-items:center`);
    mark.appendChild(el('div',`width:78px;height:78px;border-radius:8px;background:${P.bg}`));
    const col = el('div','display:grid;justify-items:center;gap:34px;position:relative');
    const word = el('div',`font-size:96px;font-weight:800;letter-spacing:-2px;color:${P.fg};overflow:hidden`, P.headline||'BRAND');
    const rule = el('div',`height:5px;width:0;background:${P.accent};border-radius:3px`);
    const tag = el('div',`font-size:28px;letter-spacing:9px;text-transform:uppercase;color:${P.fg}99`, P.dek||'motion identity');
    col.append(mark,word,rule,tag); wrap.append(stripe,col); st.appendChild(wrap);
    return {mark,word,rule,tag,stripe};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    const a=E(seg(T,P.delay,P.delay+P.aDur));
    N.mark.style.transform=`scale(${lerp(.2,1,a)}) rotate(${lerp(-24,0,a)}deg)`; N.mark.style.opacity=a;
    const b=E(seg(T,P.delay+.3,P.delay+.3+P.aDur));
    N.word.style.clipPath=`inset(0 ${100-100*b}% 0 0)`; N.word.style.opacity=b>0?1:0;
    N.rule.style.width=px(E(seg(T,P.delay+.55,P.delay+1.05))*420);
    N.tag.style.opacity=E(seg(T,P.delay+.8,P.delay+1.3));
    N.stripe.style.opacity=.12*E(seg(T,.2,1.2));
    N.stripe.style.transform=`translateX(${(T*40)%80}px)`;
  }
};

AR.counter = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center;gap:0`);
    const col = el('div','display:grid;justify-items:center;gap:22px');
    const num = el('div',`font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:230px;
      font-weight:800;color:${P.fg};letter-spacing:-8px;line-height:1`,'0');
    const lbl = el('div',`font-size:32px;letter-spacing:10px;text-transform:uppercase;color:${P.accent}`, P.headline||'Counter');
    const track = el('div',`width:760px;height:10px;border-radius:6px;background:${P.fg}1f;overflow:hidden`);
    const fill = el('div',`height:100%;width:0;background:${P.accent};border-radius:6px`);
    track.appendChild(fill); col.append(num,lbl,track); wrap.appendChild(col); st.appendChild(wrap);
    return {num,lbl,fill,col};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, p=E(seg(T,P.delay,Math.max(P.delay+.4,P.dur*.75)));
    N.num.textContent = Math.round(p*(P.variant==='pct'?100:1247)).toLocaleString('en-US');
    N.fill.style.width = (p*100)+'%';
    const i = E(seg(T,0,P.aDur)); N.col.style.transform=`scale(${lerp(.94,1,i)})`; N.col.style.opacity=i;
  }
};

AR.hud = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};overflow:hidden`);
    wrap.appendChild(el('div',`position:absolute;inset:0;opacity:.35;
      background-image:linear-gradient(${P.accent}33 1px,transparent 1px),linear-gradient(90deg,${P.accent}33 1px,transparent 1px);
      background-size:80px 80px`));
    const ret = el('div',`position:absolute;left:760px;top:340px;width:400px;height:400px;border:3px solid ${P.accent}`);
    ['0 0 auto auto','0 auto auto 0','auto 0 0 auto','auto auto 0 0'].forEach(pos=>{
      const [t,r,b,l]=pos.split(' ');
      ret.appendChild(el('div',`position:absolute;top:${t};right:${r};bottom:${b};left:${l};width:56px;height:56px;
        border:6px solid ${P.fg};border-radius:2px;margin:-14px`));
    });
    const scan = el('div',`position:absolute;left:0;right:0;height:4px;background:linear-gradient(90deg,transparent,${P.accent},transparent)`);
    const bars = el('div','position:absolute;left:150px;bottom:180px;display:flex;align-items:flex-end;gap:14px;height:180px');
    const bs=[]; for(let i=0;i<9;i++){ const b=el('div',`width:26px;background:${P.accent};border-radius:3px;height:10px`); bars.appendChild(b); bs.push(b); }
    const rd = el('div',`position:absolute;right:150px;top:170px;font-family:ui-monospace,monospace;font-size:30px;
      color:${P.accent};text-align:right;line-height:1.7;font-variant-numeric:tabular-nums`);
    wrap.append(ret,scan,bars,rd); st.appendChild(wrap); return {ret,scan,bs,rd};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, p=E(seg(T,P.delay,P.delay+P.aDur));
    N.ret.style.transform=`scale(${lerp(1.25,1,p)}) rotate(${lerp(6,0,p)}deg)`; N.ret.style.opacity=p;
    N.scan.style.top = px(((T*.5)%1)*1080); N.scan.style.opacity=.85*p;
    N.bs.forEach((b,i)=>{ b.style.height = px(20+Math.abs(Math.sin(T*3+i*.7))*150*p); });
    N.rd.innerHTML = `SIG ${(p*99.4).toFixed(1)}%<br>FRM ${String(Math.round(t*P.dur*30)).padStart(3,'0')}<br>LOCK ${p>.9?'OK':'…'}`;
    N.rd.style.opacity=p;
  }
};

AR.shape = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 1920 1080'); svg.style.cssText='position:absolute;inset:0;width:100%;height:100%';
    const mk=(t,a)=>{ const n=document.createElementNS('http://www.w3.org/2000/svg',t); for(const k in a)n.setAttribute(k,a[k]); return n; };
    const line = mk('path',{d:'M360 700 L960 380 L1560 700', fill:'none', stroke:P.accent, 'stroke-width':14, 'stroke-linecap':'round'});
    const circ = mk('circle',{cx:960, cy:540, r:230, fill:'none', stroke:P.fg, 'stroke-width':8, opacity:.4});
    svg.append(circ,line); wrap.appendChild(svg);
    const dots = el('div','position:absolute;bottom:200px;left:0;right:0;display:flex;justify-content:center;gap:34px');
    const ds=[]; for(let i=0;i<7;i++){ const d=el('div',`width:34px;height:34px;border-radius:50%;background:${P.accent}`); dots.appendChild(d); ds.push(d); }
    wrap.appendChild(dots); st.appendChild(wrap);
    const L = line.getTotalLength ? line.getTotalLength() : 1400;
    line.style.strokeDasharray = L; line.style.strokeDashoffset = L;
    return {line,circ,ds,L};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, p=E(seg(T,P.delay,P.delay+.9));
    N.line.style.strokeDashoffset = N.L*(1-p);
    N.circ.setAttribute('r', lerp(60,230,E(seg(T,P.delay+.1,P.delay+.8))));
    N.circ.style.opacity = .45*E(seg(T,P.delay,P.delay+.5));
    N.ds.forEach((d,i)=>{ const a=P.delay+.4+i*P.stagger, q=E(seg(T,a,a+.4));
      d.style.transform=`scale(${lerp(0,1,q)})`; d.style.opacity=q; });
  }
};

AR.list = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;align-content:center;padding:0 220px;gap:34px`);
    const h = el('div',`font-size:64px;font-weight:800;color:${P.fg};margin-bottom:14px`, P.headline||'Key points');
    wrap.appendChild(h);
    const rows = ['Điểm nội dung thứ nhất','Điểm nội dung thứ hai','Điểm nội dung thứ ba','Điểm nội dung thứ tư'].map((tx,i)=>{
      const r = el('div','display:flex;align-items:center;gap:30px');
      const b = el('div',`width:56px;height:56px;border-radius:14px;background:${P.accent};color:#0B0F14;
        display:grid;place-items:center;font-size:30px;font-weight:800;flex:0 0 auto`, String(i+1));
      const s = el('div',`font-size:48px;color:${P.fg}dd`, tx);
      r.append(b,s); wrap.appendChild(r); return r;
    });
    st.appendChild(wrap); return {rows,h};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    N.h.style.opacity=E(seg(T,P.delay,P.delay+P.aDur));
    N.h.style.transform=`translateY(${lerp(P.dist*.5,0,E(seg(T,P.delay,P.delay+P.aDur)))}px)`;
    N.rows.forEach((r,i)=>{ const a=P.delay+.22+i*Math.max(P.stagger,.08), p=E(seg(T,a,a+P.aDur));
      r.style.opacity=p; r.style.transform=`translateX(${lerp(P.dist,0,p)}px)`; });
  }
};

AR.frame = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center;overflow:hidden`);
    wrap.appendChild(el('div',media(1920,1080,P.bg,4)+';position:absolute;inset:-40px;filter:blur(46px) saturate(.7);opacity:.55'));
    const fr = el('div',`position:relative;border-radius:14px;overflow:hidden;border:14px solid ${P.fg};
      box-shadow:0 40px 90px rgba(0,0,0,.6)`);
    fr.appendChild(el('div', media(1160,652,P.bg,1)));
    const cap = el('div',`position:absolute;bottom:150px;left:0;right:0;text-align:center;font-size:38px;
      letter-spacing:6px;text-transform:uppercase;color:${P.fg}`, P.headline||'');
    const cover = el('div',`position:absolute;inset:0;background:${P.accent}`);
    fr.appendChild(cover);
    wrap.append(fr,cap); st.appendChild(wrap); return {fr,cap,cover};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, p=E(seg(T,P.delay,P.delay+P.aDur));
    N.fr.style.transform=`scale(${lerp(.86,1,p)}) rotate(${lerp(-3,0,p)}deg)`; N.fr.style.opacity=p;
    const q=E(seg(T,P.delay+.25,P.delay+.85)); N.cover.style.transform=`translateX(${q*100}%)`;
    N.cap.style.opacity=E(seg(T,P.delay+.55,P.delay+1.1));
  }
};

AR.background = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};overflow:hidden`);
    const g = el('div',`position:absolute;inset:-10%;background:radial-gradient(60% 60% at 40% 35%,${P.accent}55,transparent 70%),
      radial-gradient(50% 50% at 75% 75%,${P.accent}33,transparent 68%)`);
    const grid = el('div',`position:absolute;inset:0;opacity:.14;background-image:
      linear-gradient(${P.fg}44 1px,transparent 1px),linear-gradient(90deg,${P.fg}44 1px,transparent 1px);background-size:96px 96px`);
    const vig = el('div','position:absolute;inset:0;background:radial-gradient(70% 70% at 50% 50%,transparent 40%,rgba(0,0,0,.72))');
    const dots = el('div','position:absolute;inset:0');
    const ds=[]; for(let i=0;i<38;i++){ const d=el('div',`position:absolute;width:${6+i%5*3}px;height:${6+i%5*3}px;border-radius:50%;
      background:${P.fg};left:${(i*97)%1900}px;top:${(i*211)%1050}px;opacity:.3`); dots.appendChild(d); ds.push(d); }
    const tx = el('div',`position:absolute;inset:0;display:grid;place-items:center;font-size:82px;font-weight:800;color:${P.fg}`, P.headline||'');
    wrap.append(g,grid,dots,vig,tx); st.appendChild(wrap); return {g,grid,ds,tx,vig};
  },
  update(N,t,P){
    const T=t*P.dur;
    N.g.style.transform=`translate(${Math.sin(T*.5)*70}px,${Math.cos(T*.4)*46}px) scale(${1+Math.sin(T*.6)*.06})`;
    N.grid.style.transform=`translateX(${(T*16)%96}px)`;
    N.ds.forEach((d,i)=>{ d.style.opacity=.14+Math.abs(Math.sin(T*1.3+i))*.4;
      d.style.transform=`translateY(${Math.sin(T*.7+i*.5)*22}px)`; });
    N.tx.style.opacity=P.ease(seg(T,.2,1));
  }
};

AR.avatar = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};overflow:hidden`);
    wrap.appendChild(el('div',`position:absolute;inset:0;opacity:.2;background-image:
      linear-gradient(${P.accent}44 1px,transparent 1px),linear-gradient(90deg,${P.accent}44 1px,transparent 1px);background-size:110px 110px`));
    const card = el('div',`position:absolute;left:170px;top:250px;width:820px;height:580px;border-radius:26px;overflow:hidden;
      box-shadow:0 40px 90px rgba(0,0,0,.55)`);
    card.appendChild(el('div', media(820,580,P.bg,1)+';position:absolute;inset:0'));
    card.appendChild(el('div',`position:absolute;inset:0;background:${stripes(P.accent)};opacity:.5`));
    const av = el('div','position:absolute;left:1120px;bottom:0;width:520px;height:760px;transform-origin:50% 100%');
    av.appendChild(el('div',`position:absolute;left:50%;bottom:470px;transform:translateX(-50%);width:250px;height:250px;
      border-radius:60px;background:linear-gradient(150deg,${P.accent},${P.accent}88)`));
    av.appendChild(el('div',`position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:430px;height:500px;
      border-radius:120px 120px 0 0;background:linear-gradient(180deg,${P.fg}ee,${P.fg}66)`));
    const head = el('div',`position:absolute;left:170px;top:120px;font-size:74px;font-weight:800;color:${P.fg};max-width:900px`, P.headline||'Headline');
    wrap.append(card,av,head); st.appendChild(wrap); return {card,av,head};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    const a=E(seg(T,P.delay,P.delay+P.aDur+.2));
    N.av.style.transform=`translateY(${lerp(760,0,a)}px) rotate(${Math.sin(T*1.6)*2.4}deg)`;
    const b=E(seg(T,P.delay+.15,P.delay+.15+P.aDur));
    N.card.style.transform=`translateX(${lerp(-P.dist-200,0,b)}px) rotate(${lerp(-4,0,b)}deg)`; N.card.style.opacity=b;
    const c=E(seg(T,P.delay+.5,P.delay+1.1));
    N.head.style.opacity=c; N.head.style.transform=`translateY(${lerp(40,0,c)}px)`;
  }
};

AR.browser = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center;perspective:1800px`);
    wrap.appendChild(el('div',`position:absolute;inset:0;background:radial-gradient(50% 50% at 50% 45%,${P.accent}33,transparent 68%)`));
    const win = el('div',`position:relative;width:1280px;border-radius:16px;overflow:hidden;background:#151B24;
      box-shadow:0 50px 120px rgba(0,0,0,.65);border:1px solid ${P.fg}22`);
    const bar = el('div','display:flex;align-items:center;gap:14px;padding:20px 26px;background:#1D2531');
    ['#FB7185','#F5A524','#3ECF8E'].forEach(c=>bar.appendChild(el('div',`width:22px;height:22px;border-radius:50%;background:${c}`)));
    bar.appendChild(el('div',`flex:1;height:38px;border-radius:19px;background:#0F141C;margin-left:16px;
      display:flex;align-items:center;padding:0 20px;font-family:ui-monospace,monospace;font-size:20px;color:${P.fg}88`, 'https://example.com'));
    win.appendChild(bar);
    win.appendChild(el('div', media(1280,700,P.bg,0)));
    wrap.appendChild(win); st.appendChild(wrap); return {win};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, p=E(seg(T,P.delay,P.delay+P.aDur+.5));
    const drift = Math.sin(T*.6)*3;
    N.win.style.transform = `scale(${lerp(.28,1,p)}) rotateY(${lerp(34,drift,p)}deg) rotateX(${lerp(-12,1.5,p)}deg)`;
    N.win.style.opacity = cl01(p*1.6);
  }
};

AR.search = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center`);
    const col = el('div','display:grid;justify-items:center;gap:44px');
    const brand = el('div',`font-size:96px;font-weight:800;color:${P.fg};letter-spacing:-3px`, P.headline||'Tìm kiếm');
    const pill = el('div',`display:flex;align-items:center;gap:24px;width:0;overflow:hidden;height:104px;
      border-radius:52px;background:${P.fg}12;border:2px solid ${P.fg}2a;padding:0 34px`);
    const ico = el('div',`width:40px;height:40px;border-radius:50%;border:5px solid ${P.accent};flex:0 0 auto`);
    const q = el('div',`font-size:40px;color:${P.fg};white-space:nowrap;font-family:ui-monospace,monospace`,'');
    pill.append(ico,q);
    const cursor = el('div',`position:absolute;width:36px;height:36px;border-radius:50%;border:3px solid ${P.fg};opacity:0`);
    col.append(brand,pill); wrap.append(col,cursor); st.appendChild(wrap);
    return {brand,pill,q,cursor,col};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    const a=E(seg(T,P.delay,P.delay+P.aDur)); N.brand.style.opacity=a; N.brand.style.transform=`scale(${lerp(.9,1,a)})`;
    const b=E(seg(T,P.delay+.25,P.delay+.95)); N.pill.style.width=px(lerp(120,980,b));
    const txt = (P.dek||'preset motion graphics'), c=seg(T,P.delay+.8,P.delay+2.1);
    N.q.textContent = txt.slice(0,Math.round(c*txt.length)) + (c<1 && Math.floor(T*4)%2 ? '▌':'');
    const d=seg(T,P.delay+2.2,P.delay+2.8); N.cursor.style.opacity=d>0?1:0;
    N.cursor.style.transform=`translate(${lerp(400,60,d)}px,${lerp(340,180,d)}px) scale(${d>.9?.8:1})`;
    N.col.style.transform=`scale(${lerp(1,1.08,E(seg(T,P.delay+1.6,P.dur)))})`;
  }
};

AR.chart = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;align-content:center;padding:0 200px;gap:56px`);
    const h = el('div',`font-size:60px;font-weight:800;color:${P.fg}`, P.headline||'Số liệu');
    const row = el('div','display:flex;align-items:flex-end;gap:40px;height:460px');
    const vals=[.42,.66,.38,.88,.55,.74];
    const bars = vals.map((v,i)=>{
      const c = el('div','flex:1;display:grid;justify-items:center;gap:16px;align-content:end');
      const b = el('div',`width:100%;height:0;border-radius:12px 12px 0 0;background:${i===3?P.accent:P.fg+'33'}`);
      const l = el('div',`font-family:ui-monospace,monospace;font-size:26px;color:${P.fg}99`, 'Q'+(i+1));
      c.append(b,l); row.appendChild(c); return {b,v,l};
    });
    wrap.append(h,row); st.appendChild(wrap); return {bars,h};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    N.h.style.opacity=E(seg(T,P.delay,P.delay+P.aDur));
    N.bars.forEach((o,i)=>{ const a=P.delay+.15+i*Math.max(P.stagger,.06), p=E(seg(T,a,a+P.aDur+.15));
      o.b.style.height = px(p*o.v*420); o.l.style.opacity=p; });
  }
};

AR.nodePath = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg}`);
    wrap.appendChild(el('div',`position:absolute;inset:0;opacity:.16;background-image:
      linear-gradient(${P.accent}55 1px,transparent 1px),linear-gradient(90deg,${P.accent}55 1px,transparent 1px);background-size:120px 120px`));
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 1920 1080'); svg.style.cssText='position:absolute;inset:0;width:100%;height:100%';
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d','M300 780 L640 780 L640 540 L1000 540 L1000 320 L1620 320');
    p.setAttribute('fill','none'); p.setAttribute('stroke',P.fg); p.setAttribute('stroke-width','8');
    p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-linejoin','round');
    svg.appendChild(p); wrap.appendChild(svg);
    const pts=[[300,780],[640,540],[1000,320],[1620,320]];
    const nodes = pts.map((c,i)=>{
      const n = el('div',`position:absolute;left:${c[0]-46}px;top:${c[1]-46}px;width:92px;height:92px;border-radius:50%;
        background:${P.accent};color:#0B0F14;display:grid;place-items:center;font-size:38px;font-weight:800`, String(i+1));
      const l = el('div',`position:absolute;left:${c[0]-140}px;top:${c[1]+62}px;width:280px;text-align:center;
        font-size:30px;letter-spacing:3px;text-transform:uppercase;color:${P.fg}cc`, ['Bắt đầu','Xử lý','Kiểm tra','Kết quả'][i]);
      wrap.append(n,l); return {n,l};
    });
    st.appendChild(wrap);
    const L = p.getTotalLength?p.getTotalLength():2000; p.style.strokeDasharray=L; p.style.strokeDashoffset=L;
    return {path:p,L,nodes};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, p=E(seg(T,P.delay,Math.max(P.delay+.6,P.dur*.7)));
    N.path.style.strokeDashoffset = N.L*(1-p);
    N.nodes.forEach((o,i)=>{ const a=P.delay+i*.22, q=E(seg(T,a,a+P.aDur));
      o.n.style.transform=`scale(${lerp(0,1,q)})`; o.n.style.opacity=q; o.l.style.opacity=E(seg(T,a+.15,a+.6)); });
  }
};

AR.cards = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center;overflow:hidden`);
    const row = el('div','display:flex;gap:34px;align-items:center');
    const cs=[0,1,2,3,4].map(i=>{
      const c = el('div',`position:relative;width:300px;height:420px;border-radius:20px;overflow:hidden;
        box-shadow:0 30px 70px rgba(0,0,0,.5)`);
      c.appendChild(el('div', media(300,420,P.bg,i)+';position:absolute;inset:0'));
      if(i===2) c.appendChild(el('div',`position:absolute;inset:0;background:${stripes(P.accent)};opacity:.7`));
      row.appendChild(c); return c;
    });
    const cap = el('div',`position:absolute;bottom:120px;left:0;right:0;text-align:center;font-size:52px;
      font-weight:800;color:${P.fg}`, P.headline||'');
    wrap.append(row,cap); st.appendChild(wrap); return {cs,row,cap};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    N.cs.forEach((c,i)=>{ const a=P.delay+i*Math.max(P.stagger,.06), p=E(seg(T,a,a+P.aDur));
      const hero = i===2 ? 1+ E(seg(T,.3,P.dur*.6))*.22 : 1;
      c.style.transform=`translateY(${lerp(P.dist+60,0,p)}px) scale(${lerp(.86,hero,p)})`; c.style.opacity=p; });
    N.row.style.transform=`translateX(${lerp(160,0,E(seg(T,0,P.dur*.8)))}px)`;
    N.cap.style.opacity=E(seg(T,P.dur*.45,P.dur*.85));
  }
};

AR.newspaper = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:#EFEAE0;overflow:hidden`);
    const plate = el('div',`position:absolute;inset:-8%;opacity:.9;
      background:repeating-linear-gradient(0deg,#0B0F1418 0 3px,transparent 3px 13px),
                 repeating-linear-gradient(90deg,#0B0F140f 0 2px,transparent 2px 260px)`);
    const chip = el('div',`position:absolute;left:190px;top:220px;padding:12px 26px;border-radius:6px;
      background:${P.accent};color:#0B0F14;font-size:26px;font-weight:800;letter-spacing:4px;text-transform:uppercase`, 'Nguồn');
    const head = el('div',`position:absolute;left:190px;top:300px;width:1500px;font-size:104px;line-height:1.06;
      font-weight:800;color:#0B0F14;letter-spacing:-3px`, P.headline||'Tiêu đề bài viết');
    const mark = el('div',`position:absolute;left:180px;top:430px;height:96px;width:0;background:${P.accent};opacity:.55;mix-blend-mode:multiply`);
    const rule = el('div','position:absolute;left:190px;top:640px;width:0;height:6px;background:#0B0F14');
    const dek = el('div',`position:absolute;left:190px;top:700px;width:1200px;font-size:34px;color:#0B0F14aa;line-height:1.55`, P.dek||'Dòng mô tả ngắn dưới tiêu đề.');
    wrap.append(plate,chip,head,mark,rule,dek); st.appendChild(wrap);
    return {plate,chip,head,mark,rule,dek};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur;
    N.plate.style.transform=`translate(${-(T*26)%260}px,${Math.sin(T*.5)*16}px)`;
    const a=E(seg(T,P.delay,P.delay+P.aDur)); N.chip.style.opacity=a; N.chip.style.transform=`translateX(${lerp(-60,0,a)}px)`;
    const b=E(seg(T,P.delay+.15,P.delay+.15+P.aDur)); N.head.style.opacity=b; N.head.style.transform=`translateY(${lerp(30,0,b)}px)`;
    N.rule.style.width=px(E(seg(T,P.delay+.5,P.delay+1))*1500);
    N.dek.style.opacity=E(seg(T,P.delay+.7,P.delay+1.2));
    N.mark.style.width=px(E(seg(T,P.dur*.55,P.dur*.9))*880);
  }
};

AR.highlight = {
  build(st,P){ return AR.title.build(st,{...P, variant:'highlight'}); },
  update(N,t,P){ return AR.title.update(N,t,{...P, variant:'highlight'}); }
};
AR.outro = {
  build(st,P){
    const wrap = el('div',`position:absolute;inset:0;background:${P.bg};display:grid;place-items:center`);
    const col = el('div','display:grid;justify-items:center;gap:36px');
    const h = el('div',`font-size:92px;font-weight:800;color:${P.fg};text-align:center;max-width:1400px`, P.headline||'Cảm ơn đã xem');
    const r = el('div',`width:0;height:6px;border-radius:3px;background:${P.accent}`);
    const s = el('div',`font-size:32px;letter-spacing:8px;text-transform:uppercase;color:${P.fg}88`, P.dek||'subscribe · follow');
    col.append(h,r,s); wrap.appendChild(col); st.appendChild(wrap); return {h,r,s};
  },
  update(N,t,P){
    const E=P.ease, T=t*P.dur, a=E(seg(T,P.delay,P.delay+P.aDur));
    N.h.style.opacity=a; N.h.style.transform=`translateY(${lerp(P.dist*.6,0,a)}px)`;
    N.r.style.width=px(E(seg(T,P.delay+.3,P.delay+.9))*480);
    N.s.style.opacity=E(seg(T,P.delay+.55,P.delay+1.1));
  }
};

/* transitions A→B */
AR.transitionAB = {
  build(st,P){
    const wrap = el('div','position:absolute;inset:0;overflow:hidden;background:#000');
    const mkClip=(seed,label)=>{
      const c = el('div', media(1920,1080,P.bg,seed)+';position:absolute;inset:0;display:grid;place-items:center');
      c.appendChild(el('div',`font-size:200px;font-weight:800;color:#ffffffcc;letter-spacing:-8px`, label));
      return c;
    };
    const a = mkClip(1,'A'), b = mkClip(4,'B');
    const flash = el('div','position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none');
    const gA = el('div','position:absolute;inset:0;overflow:hidden'), gB = el('div','position:absolute;inset:0;overflow:hidden');
    gA.appendChild(a); gB.appendChild(b);
    wrap.append(gA,gB,flash);
    const name = el('div',`position:absolute;left:0;right:0;bottom:70px;text-align:center;font-family:ui-monospace,monospace;
      font-size:30px;letter-spacing:6px;text-transform:uppercase;color:#ffffff88`, P.headline||'');
    wrap.appendChild(name); st.appendChild(wrap);
    return {a,b,gA,gB,flash,name};
  },
  update(N,t,P){
    const id = P.tid||'', E=P.ease;
    // p = transition progress centered in the middle 55% of the clip
    const p = cl01((t-.24)/.52), q = E(p);
    const A=N.gA, B=N.gB, a=N.a, bb=N.b, F=N.flash;
    // reset
    A.style.clipPath=B.style.clipPath='none'; A.style.opacity=1; B.style.opacity=1;
    a.style.transform=bb.style.transform='none'; a.style.filter=bb.style.filter='none';
    a.style.opacity=bb.style.opacity=1; F.style.opacity=0; F.style.background='#fff';
    B.style.zIndex=2; A.style.zIndex=1;
    const bell = Math.sin(cl01(p)*Math.PI);

    if(/-cut$/.test(id))            { B.style.opacity = p>.5?1:0; }
    else if(/-fade$/.test(id))      { B.style.opacity = q; }
    else if(/dip-black|dip-white/.test(id)){
      const white=/white/.test(id); F.style.background = white?'#fff':'#000';
      F.style.opacity = bell; B.style.opacity = p>.5?1:0; }
    else if(/cross-zoom/.test(id))  { B.style.opacity=q; a.style.transform=`scale(${1+q*.3})`; bb.style.transform=`scale(${lerp(1.3,1,q)})`; }
    else if(/slide-left/.test(id))  { a.style.transform=`translateX(${-q*100}%)`; bb.style.transform=`translateX(${(1-q)*100}%)`; }
    else if(/slide-right/.test(id)) { a.style.transform=`translateX(${q*100}%)`; bb.style.transform=`translateX(${-(1-q)*100}%)`; }
    else if(/slide-up/.test(id))    { a.style.transform=`translateY(${-q*100}%)`; bb.style.transform=`translateY(${(1-q)*100}%)`; }
    else if(/slide-down/.test(id))  { a.style.transform=`translateY(${q*100}%)`; bb.style.transform=`translateY(${-(1-q)*100}%)`; }
    else if(/wipe-left/.test(id))   { B.style.clipPath=`inset(0 0 0 ${(1-q)*100}%)`; }
    else if(/wipe-right/.test(id))  { B.style.clipPath=`inset(0 ${(1-q)*100}% 0 0)`; }
    else if(/wipe-up/.test(id))     { B.style.clipPath=`inset(${(1-q)*100}% 0 0 0)`; }
    else if(/wipe-down/.test(id))   { B.style.clipPath=`inset(0 0 ${(1-q)*100}% 0)`; }
    else if(/split-vertical/.test(id)){ B.style.clipPath=`inset(${50-q*50}% 0 ${50-q*50}% 0)`; }
    else if(/split-horizontal/.test(id)){ B.style.clipPath=`inset(0 ${50-q*50}% 0 ${50-q*50}%)`; }
    else if(/whip-(left|right)/.test(id)){ const s=/left/.test(id)?-1:1;
      a.style.transform=`translateX(${s*-q*130}%)`; bb.style.transform=`translateX(${s*(1-q)*130}%)`;
      a.style.filter=bb.style.filter=`blur(${bell*36}px)`; }
    else if(/whip-(up|down)/.test(id)){ const s=/up/.test(id)?-1:1;
      a.style.transform=`translateY(${s*-q*130}%)`; bb.style.transform=`translateY(${s*(1-q)*130}%)`;
      a.style.filter=bb.style.filter=`blur(${bell*32}px)`; }
    else if(/flip-right/.test(id))  { A.style.transform=`perspective(2400px) rotateY(${q*-90}deg)`;
      B.style.transform=`perspective(2400px) rotateY(${(1-q)*90}deg)`; B.style.opacity=p>.5?1:0; A.style.opacity=p<.5?1:0; }
    else if(/-iris$/.test(id))      { B.style.clipPath=`circle(${q*75}% at 50% 50%)`; }
    else if(/clock-wipe/.test(id))  { const deg=q*360;
      B.style.clipPath = `polygon(50% 50%, 50% 0%, ${deg>90?'100% 0%,':''} ${deg>90?'100% '+Math.min(100,(deg-90)/90*100)+'%,':''} ${clockPt(deg)})`;
      if(q>=1) B.style.clipPath='none'; }
    else if(/glare|burn/.test(id))  { B.style.opacity=q; F.style.opacity=bell*.85;
      F.style.background=/burn/.test(id)?'radial-gradient(60% 60% at 50% 50%,#FFD08A,#FF6A2A)':'linear-gradient(105deg,transparent 30%,#fff 50%,transparent 70%)'; }
    else if(/flashbang/.test(id))   { F.style.opacity=Math.pow(bell,.4); B.style.opacity=p>.5?1:0; }
    else if(/strobe/.test(id))      { const k=Math.floor(p*7); F.style.opacity = k%2?.92:0; B.style.opacity=p>.5?1:0; }
    else if(/lens-glitch|glitch-blur/.test(id)){
      const j=bell; B.style.opacity=q;
      a.style.filter=`blur(${j*10}px) saturate(${1+j*2})`; bb.style.filter=`blur(${j*10}px)`;
      a.style.transform=`translateX(${Math.sin(p*44)*j*40}px)`; bb.style.transform=`translateX(${Math.cos(p*38)*j*34}px)`;
      F.style.background=`linear-gradient(90deg,#FF2D5522,#00E5FF22)`; F.style.opacity=j*.8; }
    else if(/radial-blur|blur-zoom/.test(id)){ B.style.opacity=q;
      a.style.filter=bb.style.filter=`blur(${bell*26}px)`;
      a.style.transform=`scale(${1+bell*.35})`; bb.style.transform=`scale(${1+bell*.35})`; }
    else if(/streamer/.test(id))    { B.style.clipPath=`polygon(0 0, ${q*190}% 0, ${q*190-90}% 100%, 0 100%)`;
      F.style.background=`linear-gradient(105deg,transparent 46%,#fff 50%,transparent 54%)`;
      F.style.opacity=.9; F.style.transform=`translateX(${lerp(-100,100,p)}%)`; }
    else if(/gradient-wipe/.test(id)){ const s=q*140;
      B.style.clipPath=`polygon(0 0, ${s}% 0, ${s-40}% 100%, 0 100%)`; B.style.filter=`blur(0px)`; }
    else if(/-erase$/.test(id))     { B.style.clipPath=`inset(0 ${(1-q)*100}% 0 0)`;
      F.style.background=`linear-gradient(90deg,transparent,${P.accent})`;
      F.style.clipPath=`inset(0 ${(1-q)*100}% 0 ${Math.max(0,q*100-5)}%)`; F.style.opacity=p>0&&p<1?.9:0; }
    else if(/film-roll/.test(id))   { const off=bell;
      a.style.transform=`translateY(${-q*115}%) skewY(${off*2}deg)`; bb.style.transform=`translateY(${(1-q)*115}%)`;
      F.style.background='repeating-linear-gradient(0deg,#0000 0 26px,#0006 26px 32px)'; F.style.opacity=off*.9; }
    else if(/reverse-shutter/.test(id)){ B.style.clipPath=`polygon(50% 50%, ${50-q*90}% ${50-q*70}%, ${50+q*90}% ${50-q*70}%, ${50+q*90}% ${50+q*70}%, ${50-q*90}% ${50+q*70}%)`; }
    else if(/-shutter$/.test(id))   { const k=p<.5? p*2 : (p-.5)*2;
      if(p<.5){ A.style.clipPath=`inset(${k*50}% ${k*50}% ${k*50}% ${k*50}%)`; B.style.opacity=0; }
      else { B.style.clipPath=`inset(${(1-k)*50}% ${(1-k)*50}% ${(1-k)*50}% ${(1-k)*50}%)`; A.style.opacity=0; } }
    else if(/superimpose/.test(id)) { B.style.opacity=q; A.style.opacity=1-q*.35; a.style.transform=`scale(${1+q*.08})`; }
    else if(/converge/.test(id))    { A.style.clipPath=`inset(0 ${q*50}% 0 ${q*50}%)`; a.style.transform=`scaleX(${lerp(1,.15,q)})`;
      B.style.clipPath=`inset(0 ${(1-q)*50}% 0 ${(1-q)*50}%)`; }
    else                            { B.style.opacity=q; }
    N.name.style.opacity = .9;
  }
};
function clockPt(deg){
  const r=deg*Math.PI/180, x=50+Math.sin(r)*80, y=50-Math.cos(r)*80;
  return `${x}% ${y}%`;
}

