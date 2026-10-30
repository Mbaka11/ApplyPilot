import fs from 'node:fs';
import path from 'node:path';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function testDocumentPreparation({ panel, site, sw, apiBase, out, restoreId, check }) {
  const originalUrl = site.url(), markersDir = path.join(out,'fake-pi'), delayFile=markersDir+'-letter-delay.json';
  const markers=()=>new Set(fs.existsSync(markersDir)?fs.readdirSync(markersDir).filter(name=>/^\d+\.json$/.test(name)):[]);
  const api=async(method,url,body)=>fetch(apiBase+url,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}).then(r=>r.json());
  const {application:app}=await api('POST','/applications',{job:{url:'https://careers.example.com/job/document-demo',jobKey:'fixture-documents-demo',company:'Nordic Analytics',title:'Machine Learning Intern — Document demo',language:'en',description:'This fictional internship involves Python, SQL, machine learning evaluation and clear technical documentation. The candidate will work with a small team on reproducible experiments and reliable data pipelines.'}});
  const complete=()=>panel.waitForFunction(()=>!document.querySelector('#fillCard .busy'),{timeout:30000});
  const start=async(accept=true)=>{panel.once('dialog',dialog=>accept?dialog.accept():dialog.dismiss());await panel.click('[data-action="prepareDocuments"]');};
  try {
    await site.goto(new URL('/successfactors-form.html', originalUrl).href);
    const tabId=await sw.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,site.url());
    for(let attempt=0;attempt<100;attempt++) {
      const ready=await sw.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>{
        if(!globalThis.ApplyPilot?.sfDocuments)return false;ApplyPilot.platform=()=> 'successfactors';return true;
      }}))[0]?.result,tabId);
      if(ready)break;await sleep(40);
    }
    await site.evaluate(()=>{sfUploads.enable();document.getElementById('first').value='Preserved document-demo input';});
    await panel.click('#serverStatus'); await panel.waitForFunction(()=>document.querySelector('#pageCard')?.textContent.includes('SuccessFactors'));
    await panel.click('[data-tab="home"]'); await panel.waitForSelector(`[data-activate="${app.id}"]`); await panel.click(`[data-activate="${app.id}"]`);
    await panel.waitForSelector('[data-action="prepareDocuments"]',{visible:true});
    const initialMarkers=markers().size;
    await start(false); await sleep(100);
    check('declining the destination confirmation makes no model call or employer click',markers().size===initialMarkers && await site.evaluate(()=>sfFixture.clicks.length===0));
    await site.$eval('#cv-trigger',element=>element.click());
    await start(); await complete();
    check('an already open anonymous upload dialog blocks preparation before generation',markers().size===initialMarkers && (await panel.$eval('#fillCard',e=>e.textContent)).includes('Close the open dialog'));
    await site.$eval('#upload-dialog',element=>element.remove());
    fs.writeFileSync(delayFile,JSON.stringify({delay:4000}));
    const beforeStop=markers(); await start();
    await panel.waitForFunction(()=>document.querySelector('#fillCard')?.textContent.includes('Generating cover letter'));
    let pid;
    for(let i=0;i<100&&!pid;i++){const name=[...markers()].find(name=>!beforeStop.has(name));if(name)pid=JSON.parse(fs.readFileSync(path.join(markersDir,name),'utf8')).pid;else await sleep(40);}
    check('automatic generation shows requested model and keeps Stop available',!!pid && (await panel.$eval('#letterCard',e=>e.textContent)).includes('fixture/requested') && await panel.$eval('#headerStop',e=>!e.classList.contains('hidden')));
    await panel.click('#headerStop');
    const alive=()=>{try{process.kill(pid,0);return true;}catch{return false;}};
    for(let i=0;i<100&&alive();i++)await sleep(40);
    check('Stop kills letter generation, preserves input and never starts an upload',!!pid && !alive() && !(await api('GET',`/applications/${app.id}`)).application.letter?.body && await site.evaluate(()=>sfUploads.uploads.length===0&&document.getElementById('first').value==='Preserved document-demo input'));
    fs.rmSync(delayFile,{force:true}); await sleep(100);
    const beforeSuccess=markers().size;
    await start(); await panel.waitForSelector('#fillCard .busy'); await complete();
    const saved=(await api('GET',`/applications/${app.id}`)).application;
    const uploads=await site.evaluate(()=>sfUploads.uploads);
    check('one action generates exactly one letter and attaches the selected CV and actual PDF',markers().size===beforeSuccess+1 && saved.letter?.fileName && uploads.length===2 && uploads[0].kind==='cv' && uploads[0].name==='Marie_Tremblay_CV.pdf' && uploads[1].kind==='letter' && uploads[1].name===saved.letter.fileName && uploads.every(upload=>upload.content.startsWith('%PDF-')),JSON.stringify({markers:markers().size,beforeSuccess,letter:saved.letter?.fileName,uploads:uploads.map(u=>[u.kind,u.name])}));
    check('both uploads are visibly confirmed but still flagged for human review',(await panel.$eval('#fillCard',e=>e.textContent)).split('File displayed in the correct field').length===3);
    check('documents never click cloud, confirmation, Add or Submit controls',await site.evaluate(()=>sfUploads.dialogButtons===0&&sfFixture.submissions===0&&!sfFixture.clicks.some(id=>/^(other-trigger|add-education|add-language|save|submit)$/.test(id))));
    const beforeRepeat=markers().size;
    await start(); await panel.waitForSelector('#fillCard .busy'); await complete();
    check('a second run reuses the saved letter and preserves same-name attachments',markers().size===beforeRepeat && await site.evaluate(()=>sfUploads.uploads.length===2) && (await panel.$eval('#fillCard',e=>e.textContent)).includes('Filename already present'));
    await panel.$eval('#letterSubject',element=>{element.value+=' Unsaved';element.dispatchEvent(new Event('input',{bubbles:true}));});
    await panel.click('[data-action="prepareDocuments"]'); await sleep(100);
    check('unsaved letter drafts block automatic regeneration or attachment',markers().size===beforeRepeat && (await panel.$eval('#toast',e=>e.textContent)).includes('Save your cover letter draft') && await panel.$eval('#letterSubject',e=>e.value.endsWith('Unsaved')));
    await panel.click('[data-action="saveLetter"]'); await panel.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('PDF updated'));
    await panel.select('#uiLanguage','fr');
    check('automatic document action is localized and fits the narrow panel',await panel.$eval('[data-action="prepareDocuments"]',e=>e.textContent==='Préparer et joindre CV + lettre'&&e.getBoundingClientRect().right<=innerWidth));
    await panel.select('#uiLanguage','en');
    await panel.evaluate(()=>{globalThis.__documentFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await __documentFetch(...args);if(String(args[0]).endsWith('/health')){const health=await response.json();delete health.features;return new Response(JSON.stringify(health),{headers:{'content-type':'application/json'}});}return response;};});
    await panel.click('#serverStatus'); await sleep(150); await panel.click('[data-action="prepareDocuments"]');
    check('an old same-version server cannot silently run unsafe automatic generation',(await panel.$eval('#toast',e=>e.textContent)).includes('Restart the ApplyPilot server')&&markers().size===beforeRepeat);
    await panel.evaluate(()=>{globalThis.fetch=globalThis.__documentFetch;delete globalThis.__documentFetch;});
  } finally {
    fs.rmSync(delayFile,{force:true});
    await panel.evaluate(()=>{if(globalThis.__documentFetch){globalThis.fetch=globalThis.__documentFetch;delete globalThis.__documentFetch;}});
    if(await panel.$('#headerStop:not(.hidden)'))await panel.click('#headerStop');
    await panel.click('#serverStatus'); await panel.click('[data-tab="home"]');
    await panel.waitForSelector(`[data-activate="${restoreId}"]`);
    const discardFixtureDraft=dialog=>dialog.accept(); panel.on('dialog',discardFixtureDraft);
    try { await panel.click(`[data-activate="${restoreId}"]`); } finally { panel.off('dialog',discardFixtureDraft); }
    await api('DELETE',`/applications/${app.id}`);
    await site.goto(originalUrl); await panel.waitForFunction(()=>document.querySelector('#pageCard')?.textContent.includes('Workday'));
  }
}
