// So sánh: biểu tượng chung chung (trái) vs sơ đồ riêng cho câu (phải).
const fs=require('fs'),path=require('path');
const EDITOR=path.resolve(__dirname,'..','..'),BUNDLE=path.join(EDITOR,'nova-remotion','bundle');
const COMPOSITOR=path.join(EDITOR,'node_modules','@remotion','compositor-darwin-arm64');
function fb(root){const st=[root];while(st.length){const d=st.pop();let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch(_){continue}
  for(const x of e){const p=path.join(d,x.name);if(x.isDirectory())st.push(p);else if(x.name==='chrome-headless-shell')return p}}return null}
for(const f of fs.readdirSync(path.join(__dirname,'assets'))) fs.copyFileSync(path.join(__dirname,'assets',f),path.join(BUNDLE,'assets',f));

const T=(id,text,x,y,w,size,color,weight,align)=>({id,type:'text',text,
  box:{x,y,w,align:align||'center',anchor:'center'},
  style:{size,weight:weight||700,color,lineHeight:1.3,font:align==='mono'?'Menlo,monospace':undefined},in:{preset:'none'},z:50});
const IMG=(id,src,x,y,w)=>({id,type:'image',src:'assets/'+src,box:{x,y,w,anchor:'center'},in:{preset:'none'},z:20});
const RULE=(id,y)=>({id,type:'shape',shape:'rect',box:{x:4,y,w:92,h:0.2},style:{fill:'#e3e6ec'},in:{preset:'none'},z:5});

const layers=[
  T('h','Cùng một câu — hai cách chọn hình',50,7,80,34,'#1f2328',800),
  T('l1','BIỂU TƯỢNG CHUNG CHUNG',26,14,40,19,'#b0b6c0',800),
  T('l2','SƠ ĐỒ RIÊNG CHO CÂU',73,14,40,19,'#46a86f',800),
  {id:'div',type:'shape',shape:'rect',box:{x:49.9,y:18,w:0.12,h:74},style:{fill:'#e3e6ec'},in:{preset:'none'},z:1},

  T('s1','“No cameras in the tunnels, remember?”',50,23,70,24,'#6b7280',600),
  IMG('a1','ic_cameraNo.svg',18,36,10), IMG('a2','ic_tunnel.svg',33,36,10),
  T('n1','2 hình rời · không nói được virus đang đi',26,48,40,17,'#b0b6c0',600),
  IMG('b1','dg_tunnel.svg',73,36,38),
  T('n2','1 hình · đường hầm + virus đang đi + không camera',73,48,42,17,'#46a86f',600),
  RULE('r1',54),

  T('s2','“…shows your immune system the virus’s face using dead copies.”',50,59,74,24,'#6b7280',600),
  IMG('a3','ic_antibody.svg',18,72,10), IMG('a4','ic_virusDead.svg',33,72,10),
  T('n3','2 danh từ rời rạc · thiếu trình tự',26,84,40,17,'#b0b6c0',600),
  IMG('b2','dg_wanted.svg',73,72,40),
  T('n4','đúng trình tự câu: cho xem → ghi nhớ → bắt',73,84,42,17,'#46a86f',600),
];
const spec={durationSec:2,theme:{bg:'#ffffff',text:'#1f2328'},layers};
(async()=>{if(fs.existsSync(COMPOSITOR))process.env.DYLD_LIBRARY_PATH=COMPOSITOR+(process.env.DYLD_LIBRARY_PATH?':'+process.env.DYLD_LIBRARY_PATH:'');
const be=fb(path.join(EDITOR,'remotion-browser'))||undefined;
const {selectComposition,renderStill}=require('@remotion/renderer');
const comp=await selectComposition({serveUrl:BUNDLE,id:'NovaScene',inputProps:{spec},browserExecutable:be});
const out=path.join(__dirname,'out','compare.png');
await renderStill({composition:comp,serveUrl:BUNDLE,output:out,inputProps:{spec},browserExecutable:be,frame:1});
console.log('XONG →',out);})().catch(e=>{console.error(e);process.exit(1)});
