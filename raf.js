// 📷 Raf Asistanı — markette şişeye telefonu tut: etiket/barkod → katalogdaki şişe,
// fiyat kontrolü, damak uyumu, alternatif. Üç sitede (Viski/Bira/Rakı) aynı dosya kullanılır;
// siteye özgü sözcükler window.RAF ile gelir. Yazı tanıma tamamen telefonda (Tesseract.js),
// barkod tanıma tarayıcının BarcodeDetector'ı ile; barkod → şişe eşleşmeleri ortak depoda (/api/barkod)
// kullanıcı onayıyla birikir. Sitenin global yardımcılarını kullanır: allBottles, priceOf, fmt,
// flavorsOf, userFlavorProfile, openDetay, toggle, state, olay.
(function(){
const R=Object.assign({birim:'şişe',birimi:'şişeyi'},window.RAF||{});
const TESS='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let tessYuk=null,isci=null,sonBarkod=null,secili=null;

// ---------- metin eşleştirme ----------
const TR={'ı':'i','İ':'i','ş':'s','Ş':'s','ç':'c','Ç':'c','ğ':'g','Ğ':'g','ö':'o','Ö':'o','ü':'u','Ü':'u'};
function norm(s){return String(s||'').replace(/ß/g,'ss').replace(/[ıİşŞçÇğĞöÖüÜ]/g,c=>TR[c]).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
const DOLGU=new Set(['the','and','of','de','la','le','single','whisky','whiskey','scotch','bira','beer','raki','year','years','old','yil','yillik','cl','ml','vol','alc','edition','series','seri']);
function kelimeler(s){return norm(s).split(' ').filter(w=>(w.length>=2||/^\d$/.test(w))&&!DOLGU.has(w));}
let INDEKS=null;
function indeks(){
  if(INDEKS)return INDEKS;
  const L=allBottles().map(b=>({b,ad:kelimeler(b.ad),dam:kelimeler(b.dam||b.marka||'')}));
  const df={};L.forEach(x=>new Set([...x.ad,...x.dam]).forEach(w=>{df[w]=(df[w]||0)+1;}));
  const N=L.length;L.forEach(x=>{x.w={};[...x.ad,...x.dam].forEach(w=>{x.w[w]=Math.log(1+N/(df[w]||1));});});
  return INDEKS=L;
}
function yakin(a,b){ // tek harf hatasına izin ver (OCR)
  if(a===b)return true;if(Math.abs(a.length-b.length)>1||a.length<5)return false;
  let i=0,j=0,f=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;}else{if(++f>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}}
  return f+(a.length-i)+(b.length-j)<=1;
}
function eslestir(metin,adet){
  const ok=kelimeler(metin);if(!ok.length)return [];
  const L=indeks(),sozluk=L.idf||(L.idf=(()=>{const m={};L.forEach(x=>Object.assign(m,x.w));return m;})());
  const okSoz=[...new Set(ok)].filter(w=>sozluk[w]),okTop=okSoz.reduce((a,w)=>a+sozluk[w],0)||1;
  const okSet=new Set(ok),sayilar=new Set(ok.filter(w=>/^\d+$/.test(w)));
  const var_=w=>okSet.has(w)||(!/^\d+$/.test(w)&&ok.some(o=>yakin(o,w)));
  return L.map(x=>{
    const tum=[...new Set([...x.ad,...x.dam])];let s=0,top=0;
    tum.forEach(w=>{top+=x.w[w];if(var_(w))s+=x.w[w];});
    const adSay=x.ad.filter(w=>/^\d+$/.test(w));
    if(adSay.length&&!adSay.some(n=>sayilar.has(n)))s*=0.55; // yaş/numara tutmuyorsa düşür
    if(!x.ad.some(var_))s*=0.4; // sadece marka tuttuysa
    const kap=okSoz.filter(w=>x.w[w]).reduce((a,w)=>a+sozluk[w],0)/okTop; // etiketteki kelimelerin ne kadarını açıklıyor
    return {b:x.b,p:top?(s/top)*0.7+kap*0.3:0};
  }).filter(r=>r.p>0.25).sort((a,c)=>c.p-a.p||(c.b.puan||0)-(a.b.puan||0)).slice(0,adet||3);
}

// ---------- damak uyumu, fiyat, alternatif ----------
function uyum(b){
  const prof=userFlavorProfile(),fl=flavorsOf(b);const tum=Object.values(prof).reduce((a,c)=>a+c,0);
  if(!tum||!fl.length)return null;
  const mx=Math.max(...Object.values(prof));
  const s=fl.reduce((a,f)=>a+(prof[f]||0)/mx,0)/fl.length;
  return Math.round(35+65*Math.min(1,s));
}
function fiyatYorum(raf,b){
  const ref=priceOf(b);if(!(raf>0))return '';if(!(ref>0))return `<div class="raf-not">Bu ${R.birim} için referans fiyatımız yok; yazdığın fiyat kaydedilmedi.</div>`;
  const f=Math.round((raf-ref)/ref*100);
  const [cls,yazi]=f<=-10?['iyi','👍 İyi fiyat']:f<=10?['orta','👌 Normal fiyat']:['kotu','💸 Pahalı'];
  return `<div class="raf-fiyat ${cls}"><b>${yazi}</b> · Türkiye referansı ${fmt(ref)} · raf ${fmt(raf)} (${f>0?'+':''}${f}%)</div>`;
}
function alternatifler(b,butce){
  const p=butce>0?butce:priceOf(b);if(!(p>0))return [];
  const ulas=new Set(['kolay','tekel','dutyfree','craft']);
  return allBottles().filter(x=>x.id!==b.id&&ulas.has(x.bul)&&priceOf(x)>0&&priceOf(x)<=p*1.1&&priceOf(x)>=p*0.6)
    .map(x=>({x,s:(uyum(x)||60)+((x.puan||80)-80)*1.5}))
    .filter(o=>o.s>=(uyum(b)||60)+((b.puan||80)-80)*1.5).sort((a,c)=>c.s-a.s).slice(0,2).map(o=>o.x);
}

// ---------- arayüz ----------
const css=`.raf-fab{position:fixed;right:16px;bottom:84px;z-index:60;border:1px solid var(--amber-soft);background:var(--panel2);color:var(--amber2);border-radius:999px;padding:11px 16px;font-weight:800;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.45);cursor:pointer}
@media(min-width:761px){.raf-fab{bottom:24px}}
.raf-ort{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;align-items:flex-end;justify-content:center}
.raf-kutu{background:var(--bg2);border:1px solid var(--line);border-radius:16px 16px 0 0;width:100%;max-width:560px;max-height:92vh;overflow:auto;padding:16px}
@media(min-width:761px){.raf-ort{align-items:center}.raf-kutu{border-radius:16px}}
.raf-kutu h3{margin:0 0 6px;color:var(--amber2)}.raf-kapat{float:right;background:none;border:0;color:var(--muted);font-size:22px;cursor:pointer}
.raf-sat{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.raf-sat>*{flex:1;min-width:140px}
.raf-btn{background:var(--panel);border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:11px 12px;font-weight:700;cursor:pointer;text-align:center}
.raf-btn.ana{background:linear-gradient(180deg,var(--amber2),var(--amber));color:var(--bg);border-color:var(--amber)}
.raf-kutu input{background:var(--panel);border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:10px 12px;font-size:15px;width:100%}
.raf-aday{display:flex;align-items:center;gap:10px;padding:9px;border:1px solid var(--line);border-radius:10px;margin:6px 0;cursor:pointer;background:var(--panel)}.raf-aday:hover{border-color:var(--amber-soft)}
.raf-aday small{color:var(--muted)}.raf-not{color:var(--muted);font-size:13px;margin:6px 0}
.raf-fiyat{border-radius:10px;padding:9px 11px;margin:8px 0;font-size:14px;border:1px solid var(--line)}.raf-fiyat.iyi{border-color:var(--have)}.raf-fiyat.kotu{border-color:var(--red)}
.raf-uyum{font-size:28px;font-weight:800;color:var(--amber2)}.raf-ilerle{height:6px;background:var(--panel);border-radius:4px;overflow:hidden;margin:6px 0}.raf-ilerle>div{height:100%;background:var(--amber2);transition:width .2s}
.raf-onizle{max-width:100%;max-height:180px;border-radius:10px;display:block;margin:8px auto}`;
function kur(){
  if(document.getElementById('rafFab'))return;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  const b=document.createElement('button');b.id='rafFab';b.className='raf-fab';b.textContent='📷 Raf Asistanı';b.title='Markette şişeyi tanı';
  b.onclick=ac;document.body.appendChild(b);
}
function kutu(html){
  let o=document.getElementById('rafOrt');
  if(!o){o=document.createElement('div');o.id='rafOrt';o.className='raf-ort';o.onclick=e=>{if(e.target===o)kapat();};document.body.appendChild(o);}
  o.innerHTML=`<div class="raf-kutu"><button class="raf-kapat" aria-label="Kapat">×</button>${html}</div>`;
  o.querySelector('.raf-kapat').onclick=kapat;return o;
}
function kapat(){const o=document.getElementById('rafOrt');if(o)o.remove();}
function ac(){
  try{olay('raf-ac');}catch(e){}
  const o=kutu(`<h3>📷 Raf Asistanı</h3>
    <div class="raf-not">Şişenin <b>etiketinin</b> ya da <b>barkodunun</b> fotoğrafını çek; ${R.birimi} bulup puanını, fiyatın iyi olup olmadığını ve damağına uyup uymadığını söyleyelim. Fotoğraf telefonundan dışarı gönderilmez.</div>
    <div class="raf-sat"><label class="raf-btn ana">📸 Fotoğraf çek<input id="rafFoto" type="file" accept="image/*" capture="environment" hidden></label></div>
    <div class="raf-sat"><input id="rafAra" type="search" placeholder="…ya da adını yaz (ör. ${R.ornek||'Glenfiddich 12'})"></div>
    <div id="rafDurum"></div><div id="rafSonuc"></div>`);
  o.querySelector('#rafFoto').onchange=e=>{const f=e.target.files&&e.target.files[0];if(f)fotoIsle(f);};
  const ara=o.querySelector('#rafAra');ara.oninput=()=>{const r=eslestir(ara.value,5);adaylar(r,ara.value.length>2&&!r.length?'Bulamadık; farklı yazmayı dene.':'');};
}
function durum(h){const d=document.getElementById('rafDurum');if(d)d.innerHTML=h;}
function adaylar(liste,bos){
  const s=document.getElementById('rafSonuc');if(!s)return;
  if(!liste.length){s.innerHTML=bos?`<div class="raf-not">${bos}</div>`:'';return;}
  s.innerHTML=`<div class="raf-not">Hangisi?</div>`+liste.map(r=>`<div class="raf-aday" data-raf="${r.b.id}">${typeof thumb==='function'?thumb(r.b):''}<div><b>${r.b.ad}</b><br><small>${r.b.dam||''}${priceOf(r.b)>0?' · '+fmt(priceOf(r.b)):''}</small></div></div>`).join('');
  s.querySelectorAll('[data-raf]').forEach(el=>el.onclick=()=>sonuc(el.dataset.raf,true));
}
async function fotoIsle(dosya){
  const url=URL.createObjectURL(dosya);
  document.getElementById('rafSonuc').innerHTML=`<img class="raf-onizle" src="${url}" alt="">`;
  const img=new Image();img.src=url;await img.decode().catch(()=>{});
  // 1) Barkod (destekleyen tarayıcılarda anında)
  sonBarkod=null;
  if('BarcodeDetector' in window){
    try{const d=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e']});const k=await d.detect(img);
      if(k.length){sonBarkod=k[0].rawValue;durum(`<div class="raf-not">🔎 Barkod: ${sonBarkod} — aranıyor…</div>`);
        const r=await fetch('/api/barkod?kod='+encodeURIComponent(sonBarkod)).then(x=>x.ok?x.json():null).catch(()=>null);
        if(r&&r.id&&allBottles().some(b=>b.id===r.id)){durum('');return sonuc(r.id,false,r.oy);}
      }}catch(e){}
  }
  // 2) Etiket yazısı (telefonda OCR)
  durum(`<div class="raf-not">🔤 Etiket okunuyor… (ilk seferde okuma motoru indirilir)</div><div class="raf-ilerle"><div id="rafIl" style="width:5%"></div></div>`);
  try{
    if(!tessYuk)tessYuk=new Promise((ok,red)=>{const s=document.createElement('script');s.src=TESS;s.onload=ok;s.onerror=red;document.head.appendChild(s);});
    await tessYuk;
    if(!isci)isci=await Tesseract.createWorker('eng',1,{logger:m=>{const el=document.getElementById('rafIl');if(el&&m.progress)el.style.width=Math.round(m.progress*100)+'%';}});
    const {data}=await isci.recognize(img);
    const r=eslestir(data.text,3);
    durum(sonBarkod?`<div class="raf-not">Barkod ${sonBarkod} henüz tanınmıyor; doğru ${R.birimi} seçersen bir dahaki sefere herkes için anında tanınır.</div>`:'');
    adaylar(r,`Etiketi okuyamadık 😕 Daha yakından, ışıklı ve düz çekmeyi dene ya da adını yaz.`);
  }catch(e){durum(`<div class="raf-not">Okuma motoru yüklenemedi; adını yazarak arayabilirsin.</div>`);}
}
function sonuc(id,kullaniciSecti,oy){
  const b=allBottles().find(x=>x.id===id);if(!b)return;secili=b;
  try{olay('raf-bulundu');}catch(e){}
  if(kullaniciSecti&&sonBarkod){fetch('/api/barkod',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kod:sonBarkod,id})}).catch(()=>{});}
  const u=uyum(b),h=state.have.includes(id),t=state.target.includes(id);
  const s=document.getElementById('rafSonuc');
  s.innerHTML=`<div class="raf-aday" style="cursor:default">${typeof thumb==='function'?thumb(b):''}<div><b>${b.ad}</b><br><small>${b.dam||''} · ⭐ ${b.puan||'—'}${oy?` · barkod ${oy} kişi onayladı`:''}</small></div></div>
    <div class="raf-sat"><div><div class="raf-not">🎯 Damak uyumu</div>${u===null?`<div class="raf-not">Birkaç ${R.birimi} "Denedim/Elimde" işaretleyince hesaplanır.</div>`:`<div class="raf-uyum">%${u}</div><div class="raf-not">${u>=80?'Tam senlik':u>=60?'Büyük ihtimalle seversin':'Senin tarzından biraz uzak'}</div>`}</div>
      <div><div class="raf-not">💰 Raftaki fiyat</div><input id="rafFiyat" type="number" inputmode="numeric" placeholder="TL"></div></div>
    <div id="rafFy">${priceOf(b)>0?`<div class="raf-not">Türkiye referans fiyatı: <b>${fmt(priceOf(b))}</b></div>`:''}</div>
    <div id="rafAlt"></div>
    <div class="raf-sat"><button class="raf-btn" id="rafHave">${h?'✓ Listende':'✓ '+(R.have||'Denedim')}</button><button class="raf-btn" id="rafTarget">${t?'★ Hedefte':'☆ '+(R.target||'Deneyeceğim')}</button><button class="raf-btn ana" id="rafKart">Kartı aç</button></div>
    <div class="raf-sat"><button class="raf-btn" id="rafYeni">📷 Başka bir tane</button></div>`;
  const alt=()=>{const fy=+document.getElementById('rafFiyat').value;const a=alternatifler(b,fy);
    document.getElementById('rafFy').innerHTML=fiyatYorum(fy,b)||(priceOf(b)>0?`<div class="raf-not">Türkiye referans fiyatı: <b>${fmt(priceOf(b))}</b></div>`:'');
    document.getElementById('rafAlt').innerHTML=a.length?`<div class="raf-not">🔄 Aynı paraya sana daha uygun olabilir:</div>`+a.map(x=>`<div class="raf-aday" data-raf2="${x.id}">${typeof thumb==='function'?thumb(x):''}<div><b>${x.ad}</b><br><small>${fmt(priceOf(x))}${uyum(x)!==null?' · uyum %'+uyum(x):''} · ⭐ ${x.puan||'—'}</small></div></div>`).join(''):'';
    document.querySelectorAll('[data-raf2]').forEach(el=>el.onclick=()=>sonuc(el.dataset.raf2,false));};
  alt();document.getElementById('rafFiyat').oninput=alt;
  document.getElementById('rafHave').onclick=()=>{toggle('have',id);sonuc(id,false);};
  document.getElementById('rafTarget').onclick=()=>{toggle('target',id);sonuc(id,false);};
  document.getElementById('rafKart').onclick=()=>{kapat();openDetay(id);};
  document.getElementById('rafYeni').onclick=ac;
}
window.rafEslestir=eslestir; // test için
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kur);else kur();
})();
