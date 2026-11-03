/* Chrome smoke of distributable Windows phone test bundle. No external/photo uploads. */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const server = spawn('node', ['phone-test-dist/server.cjs'], { stdio:'ignore' });
let browser;
try {
  let live = false;
  for (let i=0;i<50;i++) {
    try { if ((await fetch('http://127.0.0.1:8765')).ok) {live = true; break;} } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if (!live) throw new Error('Local ZIP server unavailable');
  if ((await fetch('http://127.0.0.1:8765/api/design',{method:'POST'})).status !== 405)
    throw new Error('Local ZIP server must reject API/POST calls');
  browser=await puppeteer.launch({
    executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
    headless:true, args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']
  });
  const page=await browser.newPage();
  const faults=[], outbound=[];
  await page.setRequestInterception(true);
  page.on('request',request=>{
    const url=request.url();
    if (/^https?:/i.test(url)&&!url.startsWith('http://127.0.0.1:8765/')) {
      outbound.push(url); request.abort();
    } else request.continue();
  });
  page.on('pageerror',err=>faults.push(err.message));
  page.on('console',msg=>{
    if(msg.type()==='error'&&/content security policy|refused to|uncaught/i.test(msg.text()))
      faults.push(msg.text());
  });
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof YardVisionMobilePhoto==='object' && 
    typeof YardVisionHeicDecoder==='object'&&typeof YardVisionHeicProbe==='object',
    {timeout:8000});
  async function chooseHeic(url,filename) {
    await page.evaluate(async ([url,filename])=>{
      const res=await fetch(url);
      const blob=await res.blob();
      const dt=new DataTransfer();
      dt.items.add(new File([blob],filename,{type:'image/heic'}));
      const input=document.getElementById('yardFile');
      input.files=dt.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    },[url,filename]);
  }
  async function result() {
    return await page.evaluate(()=>({
      status:document.getElementById('status').textContent,
      flag:document.getElementById('status').dataset.result,
      previewHidden:document.getElementById('preview').hidden,
      width:document.getElementById('preview').naturalWidth,
      height:document.getElementById('preview').naturalHeight,
      detail:document.getElementById('details').textContent,
      saveHidden:document.getElementById('save').hidden
    }));
  }
  await chooseHeic('/sample.heic','sample.heic');
  await page.waitForFunction(()=>['pass','fail'].includes(document.getElementById('status').dataset.result),{timeout:28000});
  const heic=await result();
  if(heic.flag!=='pass'||heic.previewHidden||heic.width!==640||heic.height!==480||heic.saveHidden)
    throw new Error('Phone test genuine HEIC failed: '+JSON.stringify(heic));
  console.log('Phone ZIP actual HEIC decode PASS:',JSON.stringify(heic));

  await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=240;canvas.height=160;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#486e4e';ctx.fillRect(0,0,240,160);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const dt=new DataTransfer();dt.items.add(new File([blob],'fixture.png',{type:'image/png'}));
    const input=document.getElementById('yardFile');
    input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.getElementById('status').dataset.result==='pass'&&
    document.getElementById('details').textContent.includes('fixture.png'),{timeout:5000});
  const png=await result();
  if(png.width!==240||png.height!==160||!png.detail.includes('image/png'))
    throw new Error('Phone ZIP PNG passthrough failed: '+JSON.stringify(png));
  console.log('Phone ZIP PNG PASS');

  await page.evaluate(()=>{
    const bytes=new Uint8Array(128);
    const dt=new DataTransfer();dt.items.add(new File([bytes],'broken.heic',{type:'image/heic'}));
    const input=document.getElementById('yardFile');
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.getElementById('status').dataset.result==='fail',{timeout:5000});
  const invalid=await result();
  if(!invalid.previewHidden||!invalid.saveHidden||invalid.flag!=='fail')
    throw new Error('Phone ZIP corrupt HEIC was not rejected: '+JSON.stringify(invalid));
  console.log('Phone ZIP corrupt HEIC rejection PASS');
  if(outbound.length||faults.length)throw new Error('Unexpected external requests/errors: '+JSON.stringify({outbound,faults}));
  console.log('Phone ZIP no-external-calls CSP PASS');
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
}
