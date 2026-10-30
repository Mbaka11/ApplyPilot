import fs from 'node:fs';
import path from 'node:path';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function testDocumentPreparationServer({ api, check, base, dataDir, markerDir, app, job, sampleBody }) {
  const markers = () => new Set(fs.existsSync(markerDir) ? fs.readdirSync(markerDir).filter(name=>/^\d+\.json$/.test(name)) : []);
  const nextPid = async before => {
    for(let i=0;i<100;i++) {
      const name=[...markers()].find(name=>!before.has(name));
      if(name) return JSON.parse(fs.readFileSync(path.join(markerDir,name),'utf8')).pid;
      await sleep(40);
    }
    throw new Error('Fake letter process did not start');
  };
  const delayFile = markerDir + '-letter-delay.json';
  const beforeReuse=markers();
  const existing=(await api('GET',`/applications/${app.id}`)).data.application;
  const reused=await api('POST',`/applications/${app.id}/letter`,{onlyIfMissing:true});
  check('automatic documents advertise cancellable generation support', (await api('GET','/health')).data.features.documentPreparation === 1);
  check('only-if-missing preserves an edited letter without invoking pi', reused.data.reused === true && JSON.stringify(reused.data.letter)===JSON.stringify(existing.letter) && markers().size===beforeReuse.size);
  check('malformed only-if-missing requests are rejected', (await api('POST',`/applications/${app.id}/letter`,{onlyIfMissing:false})).status===400);
  const create = async suffix => (await api('POST','/applications',{job:{...job,url:job.url.replace('/apply',`/${suffix}/apply`),jobKey:job.jobKey+'-'+suffix,title:job.title+' '+suffix}})).data.application;
  const fresh=await create('documents-cancel');
  const controller=new AbortController();
  try {
    fs.writeFileSync(delayFile,JSON.stringify({delay:4000}));
    const before=markers();
    const pending=fetch(base+`/applications/${fresh.id}/letter`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({onlyIfMissing:true,cvId:fresh.cvId}),signal:controller.signal}).catch(error=>error);
    const pid=await nextPid(before);
    check('concurrent letter generation is rejected without a second model process', (await api('POST',`/applications/${fresh.id}/letter`,{onlyIfMissing:true,cvId:fresh.cvId})).status===409 && markers().size===before.size+1);
    controller.abort(); check('automatic letter generation accepts client cancellation',(await pending).name==='AbortError');
    const alive=()=>{try{process.kill(pid,0);return true;}catch{return false;}};
    for(let i=0;i<100&&alive();i++) await sleep(40);
    const after=(await api('GET',`/applications/${fresh.id}`)).data.application;
    check('cancellation kills the fake provider and saves no letter/PDF', !alive() && !after.letter?.body && !fs.readdirSync(path.join(dataDir,'applications',fresh.id)).some(name=>/\.pdf$|^letter\./.test(name)));
    // A concurrent manual edit must win over an earlier generation request and its PDF.
    const another=await create('documents-conflict'); const beforeConflict=markers();
    const generating=api('POST',`/applications/${another.id}/letter`,{onlyIfMissing:true,cvId:another.cvId});
    await nextPid(beforeConflict);
    const edit=await api('PUT',`/applications/${another.id}/letter`,{body:sampleBody,subject:'Concurrent manual draft',language:'fr'});
    const pdfPath=path.join(dataDir,'applications',another.id,edit.data.letter.fileName); const saved=fs.readFileSync(pdfPath);
    const conflict=await generating;
    const stored=(await api('GET',`/applications/${another.id}`)).data.application;
    check('a concurrent manual edit and its PDF survive late generation', conflict.status===409 && stored.letter.subject==='Concurrent manual draft' && fs.readFileSync(pdfPath).equals(saved));
    check('failed late rendering leaves no temporary PDF behind', !fs.readdirSync(path.dirname(pdfPath)).some(name=>name.startsWith('.rendu-')));
    const incomplete=(await api('POST','/applications',{job:{...job,url:job.url.replace('/apply','/short-description/apply'),jobKey:job.jobKey+'-short-description',description:'Not enough context.'}})).data.application;
    const beforeShort=markers();
    check('automatic generation refuses incomplete posting context before using quota', (await api('POST',`/applications/${incomplete.id}/letter`,{onlyIfMissing:true,cvId:incomplete.cvId})).status===409 && markers().size===beforeShort.size);
  } finally { controller.abort(); fs.rmSync(delayFile,{force:true}); }
}
