// Auto-video: chủ đề → Claude(kịch bản+keyword) → clip YouTube thật (cookies Nova) làm nền + chữ + giọng.
// Fallback nền gradient nếu không tải được clip. Export make(topic,n,onProgress,opts).
const path=require('path'),fs=require('fs'),os=require('os'),{spawn,execSync}=require('child_process');
const { FFMPEG, FFPROBE } = require('./ff-path');   // đường dẫn đã gỡ khỏi app.asar (spawn được)
const { search, downloadOne, searchPexels, downloadPexels, searchPexelsPhotos, downloadPhoto } = require('./ipc-clips');
const { scoreCandidates, bannedRanges, smartStart } = require('./smart-clip');
const FONT=(()=>{for(const f of["/System/Library/Fonts/Supplemental/Arial Unicode.ttf","/System/Library/Fonts/Supplemental/Arial.ttf","/System/Library/Fonts/Helvetica.ttc"]){try{if(fs.existsSync(f))return f;}catch(_){}}return"";})();
const TMP=path.join(os.tmpdir(),'nova-auto2'); fs.mkdirSync(TMP,{recursive:true});
const run=(b,a,timeoutMs=900000)=>new Promise((res,rej)=>{const p=spawn(b,a,{windowsHide:true});let e='';p.stderr.on('data',d=>e+=d);p.on('error',rej);const _to=setTimeout(()=>{try{p.kill('SIGKILL');}catch(_){}rej(new Error('ffmpeg quá '+Math.round(timeoutMs/60000)+' phút — nghi treo, đã kill'));},timeoutMs);p.on('close',c=>{clearTimeout(_to);c===0?res():rej(new Error(e.slice(-250)));});});
const durOf=f=>{try{const o=execSync(`"${FFPROBE}" -v quiet -print_format json -show_format "${f}"`).toString();return parseFloat(JSON.parse(o).format.duration)||3;}catch(_){return 3;}};
async function say(t,out){const aiff=out+'.aiff',tf=out+'.txt';fs.writeFileSync(tf,t);await run('say',['-v','Linh','-o',aiff,'-f',tf]);await run(FFMPEG,['-i',aiff,'-codec:a','libmp3lame','-y',out]);try{fs.unlinkSync(aiff);fs.unlinkSync(tf);}catch(_){}return out;}
async function claude(sys,u){const r=await fetch('http://127.0.0.1:8790/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:sys},{role:'user',content:u}],model:'sonnet'})});const d=await r.json();return (d.choices&&d.choices[0]&&d.choices[0].message.content)||'';}
function wrap(t,n=34){const w=t.split(' ');let L=[],c='';for(const x of w){if((c+' '+x).trim().length>n){L.push(c.trim());c=x;}else c+=' '+x;}if(c.trim())L.push(c.trim());return L.join('\n');}
const COLORS=[['#1a2980','#26d0ce'],['#c31432','#240b36'],['#0f2027','#2c5364'],['#42275a','#734b6d'],['#141e30','#243b55'],['#c2410c','#7c2d12']];
const esc=p=>String(p).replace(/'/g,"\\'").replace(/:/g,'\\:');
const CAP_STYLES={
  nova:"fontsize=56:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=22",
  vien:"fontsize=62:fontcolor=white:bordercolor=black:borderw=5",
  vang:"fontsize=66:fontcolor=#ffd24a:bordercolor=black:borderw=6:shadowcolor=black@0.7:shadowx=3:shadowy=3",
  cam:"fontsize=54:fontcolor=white:box=1:boxcolor=#c2410c@0.92:boxborderw=24",
  toigian:"fontsize=54:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2"
};
function capChain(narration, dur, tag, style){
  const st=CAP_STYLES[style]||CAP_STYLES.nova;
  const words=String(narration).split(/\s+/).filter(Boolean);
  const per=4; let chunks=[]; for(let i=0;i<words.length;i+=per) chunks.push(words.slice(i,i+per).join(' '));
  if(!chunks.length) chunks=[String(narration)];
  const slot=dur/chunks.length;
  return chunks.map((ch,idx)=>{
    const a=(idx*slot).toFixed(2), b=(idx===chunks.length-1?(dur+0.6):((idx+1)*slot)).toFixed(2);
    const cf=path.join(TMP,`cap_${tag}_${idx}.txt`); fs.writeFileSync(cf,ch);
    return `drawtext=fontfile='${esc(FONT)}':textfile='${esc(cf)}':${st}:line_spacing=10:x=(w-text_w)/2:y=h-155:enable='between(t,${a},${b})'`;
  }).join(',');
}
const DT=(txt)=>`drawtext=fontfile='${esc(FONT)}':textfile='${esc(txt)}':fontcolor=white:fontsize=50:line_spacing=14:x=(w-text_w)/2:y=h-text_h-70:box=1:boxcolor=black@0.45:boxborderw=22`;

async function getBgm(sec){
  try{ const found=await search("no copyright calm background music instrumental",3); for(const f of found){ const p=await downloadOne(f.url, Math.ceil(sec)+2).catch(()=>null); if(p&&durOf(p)>1) return p; } }catch(_){}
  return null;
}
function cleanJson(t){ return String(t).replace(/```json?/gi,'').replace(/```/g,'').replace(/[""]/g,'"').replace(/['']/g,"'").trim(); }
async function safeParseScenes(topic,n){
  for(let attempt=0;attempt<2;attempt++){
    try{
      const raw=await claude('Tạo kịch bản video faceless tiếng Việt. Trả JSON THUẦN, KHÔNG markdown, KHÔNG dấu ngoặc kép bên trong chuỗi.',`Chủ đề "${topic}". ${n} cảnh, mỗi cảnh: "narration" (1 câu tiếng Việt 12-22 từ, KHÔNG dùng dấu ngoặc kép) + "keyword" (2-4 từ tiếng Anh tìm clip stock). Trả JSON: [{"narration":"...","keyword":"..."}]. CHỈ JSON.`);
      const m=cleanJson(raw).match(/\[[\s\S]*\]/); if(!m) continue;
      const arr=JSON.parse(m[0]); if(Array.isArray(arr)&&arr.length) return arr;
    }catch(e){ if(attempt===1) throw new Error('script JSON: '+String(e.message||e).slice(0,80)); }
  }
  throw new Error('không sinh được kịch bản');
}
async function make(topic,n=4,onProgress=()=>{},opts={}){
  const useClips = opts.clips !== false;
  onProgress(5,'Claude đang viết kịch bản…');
  const scenes=await safeParseScenes(topic, n);
  onProgress(12,`Có ${scenes.length} cảnh, đang dựng…`);
  const segs=[]; let nClip=0;
  for(let i=0;i<scenes.length;i++){
    const tag=Date.now()+'_'+i;
    const voice=await say(scenes[i].narration,path.join(TMP,`v${tag}.mp3`));
    const d=Math.max(2,durOf(voice));
    const cap=capChain(scenes[i].narration, d, tag, opts.capStyle);
    const seg=path.join(TMP,`seg${tag}.mp4`);
    let clip=null, csrc="", clipStart=0;
    const useVision = opts.vision !== false, useScore = opts.score !== false;
    if(useClips && scenes[i].keyword){
      let cands=[];
      try{ cands=cands.concat(await search(scenes[i].keyword+' stock footage',5)); }catch(_){}
      try{ cands=cands.concat(await searchPexels(scenes[i].keyword,3)); }catch(_){}
      if(cands.length){
        let bi=0; if(useScore){ try{ bi=await scoreCandidates(scenes[i].narration, scenes[i].keyword, cands); }catch(_){} }
        const order=[bi, ...cands.map((_,k)=>k).filter(k=>k!==bi)];
        for(const k of order.slice(0,3)){
          const c=cands[k]; let raw=null;
          if(c.source==='pexels'){ const out=path.join(TMP,`px${tag}_${k}.mp4`); raw=await downloadPexels(c.url,out).catch(()=>null); }
          else { raw=await downloadOne(c.url, useVision?30:(Math.ceil(d)+3), useVision?0:2).catch(()=>null); }
          if(raw && durOf(raw)>1.5){
            if(useVision){ const mediaDur=durOf(raw); const banned=await bannedRanges(raw, mediaDur).catch(()=>[]); clipStart=smartStart(mediaDur, d, banned)||0; csrc=(c.source||'yt')+(banned.length?'+vision':''); }
            else { clipStart=0; csrc=(c.source||'yt')+'-fast'; }
            clip=raw; break;
          }
        }
      }
    }
    let photo=null;
    if(!clip && useClips && scenes[i].keyword){
      try{ const ph=await searchPexelsPhotos(scenes[i].keyword,4); for(const p of ph){ const out=path.join(TMP,`ph${tag}.jpg`); photo=await downloadPhoto(p.url,out); if(photo){csrc="pexels-photo+kenburns";break;} } }catch(_){}
    }
    if(clip){
      nClip++;
      // clip thật làm nền: scale/crop đầy khung + chữ + tiếng
      await run(FFMPEG,['-stream_loop','-1','-ss',String(clipStart),'-t',String(d),'-i',clip,'-i',voice,'-filter_complex',
        `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30,${cap}[v]`,
        '-map','[v]','-map','1:a','-t',String(d),'-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-c:a','aac','-y',seg]);
    }else if(photo){
      nClip++;
      // ảnh tĩnh + Ken Burns (zoom nhẹ)
      const frames=Math.max(30,Math.ceil(d*30));
      await run(FFMPEG,['-loop','1','-i',photo,'-i',voice,'-filter_complex',
        `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0012,1.14)':d=${frames}:s=1280x720:fps=30,setsar=1,${cap}[v]`,
        '-map','[v]','-map','1:a','-t',String(d),'-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-c:a','aac','-y',seg]);
    }else{
      const [c1,c2]=COLORS[i%COLORS.length];
      await run(FFMPEG,['-f','lavfi','-i',`gradients=s=1280x720:c0=${c1}:c1=${c2}:duration=${d}:speed=0.02`,'-i',voice,
        '-vf',cap,'-t',String(d),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',seg]);
    }
    segs.push(seg);
    onProgress(12+Math.round((i+1)/scenes.length*80),`Cảnh ${i+1}/${scenes.length} ${clip?('('+csrc+')'):'(nền màu)'}…`);
  }
  const out=path.join(process.env.HOME||os.homedir(),'Documents',`nova-auto-${Date.now()}.mp4`);
  onProgress(90,'Chuyển cảnh + ghép…');
  const merged=path.join(TMP,`merged${Date.now()}.mp4`);
  const cfx=0.4; const durs=segs.map(x=>durOf(x));
  if(segs.length<=1){ fs.copyFileSync(segs[0],merged); }
  else {
    const inputs=[]; segs.forEach(x=>inputs.push('-i',x));
    let vf='',af='',vlab='[0:v]',alab='[0:a]',off=0;
    for(let k=1;k<segs.length;k++){ off+=Math.max(0.1,durs[k-1]-cfx); vf+=`${vlab}[${k}:v]xfade=transition=fade:duration=${cfx}:offset=${off.toFixed(3)}[vx${k}];`; af+=`${alab}[${k}:a]acrossfade=d=${cfx}[ax${k}];`; vlab=`[vx${k}]`; alab=`[ax${k}]`; }
    const fc=(vf+af).replace(/;$/,'');
    await run(FFMPEG,[...inputs,'-filter_complex',fc,'-map',vlab,'-map',alab,'-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-c:a','aac','-y',merged]);
  }
  const totalSec=durOf(merged);
  let bgm=null; if(opts.bgm!==false){ onProgress(94,'Thêm nhạc nền…'); bgm=await getBgm(totalSec).catch(()=>null); }
  if(bgm){
    await run(FFMPEG,['-i',merged,'-stream_loop','-1','-t',String(totalSec),'-i',bgm,'-filter_complex','[1:a]volume=0.14[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]','-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-t',String(totalSec),'-shortest','-y',out]);
  } else { fs.copyFileSync(merged,out); }
  onProgress(100,'Xong');
  return { ok:true, path:out, scenes:scenes.length, clips:nClip, bgm:!!bgm };
}
module.exports={ make };
if(require.main===module) make(process.argv[2]||'2 mẹo pha cà phê ngon',Number(process.argv[3])||3,(p,m)=>console.log(p+'% '+m)).then(r=>console.log('→',r.path,'| clip thật:',r.clips+'/'+r.scenes)).catch(e=>console.log('ERR',String(e.message||e).slice(0,300)));
