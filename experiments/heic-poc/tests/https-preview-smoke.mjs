/* Headless Chrome checks the exact HTTPS-ready static payload under a
 * project-style subpath. Static local HTTP mirrors Pages' lack of custom CSP
 * response headers; this is NOT production Helmet acceptance.
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const name='yardvision-ai-staging';
const root=resolve('https-preview-test-server');
await mkdir(root,{recursive:true});
await cp(resolve('https-preview-dist'),resolve(root,name),{recursive:true,force:true});
const server=spawn('python3',['-m','http.server','8108','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<40;i++){
    try{if((await fetch('http://127.0.0.1:8108/'+name+'/')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw Error('Test web server unavailable');
  browser=await puppeteer.launch({
    executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
    headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const badRequests=[],errors=[];
  await page.setRequestInterception(true);
  page.on('request',req=>{
    if(!req.url().startsWith('http://127.0.0.1:8108/')){badRequests.push(req.url());req.abort();}
    else req.continue();
  });
  page.on('pageerror',err=>errors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error'&&/Content Security Policy|Refused to|Uncaught/.test(msg.text()))errors.push(msg.text());});
  await page.goto('http://127.0.0.1:8108/'+name+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof YardVisionMobilePhoto==='object'&&
    typeof YardVisionHeicDecoder==='object'&&typeof YardVisionHeicProbe==='object',{timeout:10000});

  const noEval=await page.evaluate(()=>{
    try{new Function('return 11');return false;}catch{return true;}
  });
  if(!noEval)throw Error('Main-page CSP did not block unsafe-eval');
  console.log('Pages preview main document unsafe-eval blocked: PASS');

  async function choose(url,fileName,type){
    await page.evaluate(async ({url,fileName,type})=>{
      const data=await (await fetch(url)).blob();
      const dt=new DataTransfer();
      dt.items.add(new File([data],fileName,{type}));
      const input=document.getElementById('yardFile');
      input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    },{url,fileName,type});
  }
  async function check(){
    return page.evaluate(()=>({
      flag:document.getElementById('status').dataset.result,
      text:document.getElementById('status').textContent,
      width:document.getElementById('preview').naturalWidth,
      height:document.getElementById('preview').naturalHeight,
      hidden:document.getElementById('preview').hidden,
      saveHidden:document.getElementById('save').hidden,
      details:document.getElementById('details').textContent
    }));
  }
  await choose('./sample.heic','CI_public_640x480.heic','image/heic');
  await page.waitForFunction(()=>['pass','fail'].includes(document.getElementById('status').dataset.result),{timeout:28000});
  const r=await check();
  if(r.flag!=='pass'||r.hidden||r.width!==640||r.height!==480||r.saveHidden||!r.details.includes('image/jpeg'))
    throw Error('HTTPS Pages preview genuine HEIC failed: '+JSON.stringify({r,errors}));
  console.log('Pages HTTPS preview HEIC-JPEG PASS',JSON.stringify(r));

  await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=240;c.height=160;
    const ctx=c.getContext('2d');ctx.fillStyle='#208764';ctx.fillRect(0,0,240,160);
    const b=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
    const dt=new DataTransfer();dt.items.add(new File([b],'normal.png',{type:'image/png'}));
    const e=document.getElementById('yardFile');e.files=dt.files;e.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(()=>document.getElementById('status').dataset.result==='pass'&&
    document.getElementById('details').textContent.includes('normal.png'),{timeout:5000});
  const png=await check();
  if(png.hidden||png.width!==240||png.height!==160||!png.details.includes('image/png'))
    throw Error('HTTPS Pages preview PNG regression failed: '+JSON.stringify(png));
  console.log('Pages HTTPS preview PNG PASS');

  await page.evaluate(()=>{
    const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(100)],'broken.heic',{type:'image/heic'}));
    const e=document.getElementById('yardFile');e.files=dt.files;e.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(()=>document.getElementById('status').dataset.result==='fail',{timeout:5000});
  const broken=await check();
  if(!broken.hidden||!broken.saveHidden)throw Error('Broken HEIC must not show photo/save control');
  if(badRequests.length||errors.length)throw Error('Unexpected external requests/runtime errors: '+JSON.stringify({badRequests,errors}));
  console.log('Pages HTTPS preview corrupt HEIC and outbound blocks PASS');
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
  await rm(root,{recursive:true,force:true});
}
