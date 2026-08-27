// Bảng icon — soi cả bộ một lượt, đúng renderer thật (không phải preview trình duyệt khác).
const fs=require('fs'),path=require('path');
const EDITOR=path.resolve(__dirname,'..','..'),BUNDLE=path.join(EDITOR,'nova-remotion','bundle');
const COMPOSITOR=path.join(EDITOR,'node_modules','@remotion','compositor-darwin-arm64');
function fb(root){const st=[root];while(st.length){const d=st.pop();let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch(_){continue}
  for(const x of e){const p=path.join(d,x.name);if(x.isDirectory())st.push(p);else if(x.name==='chrome-headless-shell')return p}}return null}
const names=fs.readdirSync(path.join(__dirname,'assets')).filter(f=>f.startsWith('ic_')).sort();
names.forEach(f=>fs.copyFileSync(path.join(__dirname,'assets',f),path.join(BUNDLE,'assets',f)));
const COLS=7, layers=[];
names.forEach((f,i)=>{const c=i%COLS,r=Math.floor(i/COLS);
  const x=8+c*13.7, y=16+r*30;
  layers.push({id:'i'+i,type:'image',src:'assets/'+f,box:{x,y,w:9,anchor:'center'},in:{preset:'none'},z:10});
  layers.push({id:'t'+i,type:'text',text:f.replace('ic_','').replace('.svg',''),
    box:{x,y:y+11,w:14,align:'center',anchor:'center'},style:{size:16,weight:600,color:'#7b828e',font:'Menlo,monospace'},in:{preset:'none'},z:20});});
const spec={durationSec:2,theme:{bg:'#ffffff',text:'#1f2328'},layers};
(async()=>{if(fs.existsSync(COMPOSITOR))process.env.DYLD_LIBRARY_PATH=COMPOSITOR+(process.env.DYLD_LIBRARY_PATH?':'+process.env.DYLD_LIBRARY_PATH:'');
const be=fb(path.join(EDITOR,'remotion-browser'))||undefined;
const {selectComposition,renderStill}=require('@remotion/renderer');
const comp=await selectComposition({serveUrl:BUNDLE,id:'NovaScene',inputProps:{spec},browserExecutable:be});
const out=path.join(__dirname,'out','icon-sheet.png');
await renderStill({composition:comp,serveUrl:BUNDLE,output:out,inputProps:{spec},browserExecutable:be,frame:1});
console.log('XONG →',out,`(${names.length} icon)`);})().catch(e=>{console.error(e);process.exit(1)});
