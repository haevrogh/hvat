const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 const p=await b.newPage({viewport:{width:390,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));p.on('dialog',d=>d.accept());
 await p.goto('http://127.0.0.1:8765/');await p.locator('#sectionProgressionButton').click();await p.locator('[data-prog=create]').click();await p.getByRole('button',{name:'Далее',exact:true}).click();
 await p.locator('#armMethod').selectOption('ladder');await p.locator('[name=pairConfirmed]').check();await p.locator('[name=rest]').fill('0');await p.getByRole('button',{name:'Далее',exact:true}).click();await p.locator('[name=rest]').fill('0');await p.getByRole('button',{name:'Далее',exact:true}).click();await p.getByRole('button',{name:'Запустить прогрессию',exact:true}).click();await p.locator('[data-prog=start]').click();await p.locator('#sessionActualReps').waitFor();
 await p.locator('#sessionActualReps').fill('9');await p.locator('#sessionQuality').selectOption('valid');await p.locator('#completeSet').click();await p.waitForFunction(()=>document.querySelector('#sessionProgress').textContent==='1 / 9 подходов');
 assert.equal(await p.locator('#sessionActualReps').inputValue(),'7');
 await p.reload();await p.locator('#sectionTrainingButton').click();await p.locator('#sessionActualReps').waitFor();assert.equal(await p.locator('#sessionActualReps').inputValue(),'7');
 for(let i=0;i<8;i++){await p.locator('#sessionActualReps').fill(i<4?'7':'10');await p.locator('#completeSet').click();await p.waitForTimeout(60);}
 await p.locator('#finishTraining').click();await p.locator('#feedbackForm').waitFor();for(const a of ['right','left']){await p.locator(`[name=${a}-technique]`).selectOption('yes');await p.locator(`[name=${a}-pain]`).selectOption('no');}
 await p.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#historyCount').textContent==='1');
 const data=await p.evaluate(async()=>await(await import('./js/workout-db.js')).readAll());
 assert.equal(data.active,null);assert.equal(data.workouts.length,1);assert.equal(data.progressions[0].arms.right.step,1);assert.equal(data.progressions[0].arms.left.pending.type,'increase');
 assert.deepEqual(data.progressions[0].slots[1].plan.right.map(s=>s.reps),[8,7,7,7]);
 await p.locator('#sectionProgressionButton').click();await p.locator('[data-prog=decide-increase]').click();await p.locator('[data-prog=start]').click();await p.locator('#sessionActualReps').waitFor();assert.equal(await p.locator('#sessionActualReps').inputValue(),'8');
 await p.locator('#sessionActualReps').fill('0');await p.locator('#completeSet').click();await p.locator('#finishTraining').click();await p.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();await p.waitForTimeout(100);
 const after=await p.evaluate(async()=>await(await import('./js/workout-db.js')).readAll());assert.equal(after.progressions[0].arms.right.step,0);assert.equal(after.progressions[0].slots[1].status,'partial');
 const result=await p.evaluate(async()=>{const db=await import('./js/workout-db.js'),m=await import('./js/workout-model.js'),v=await import('./js/progression-backup.js');const raw={format:m.BACKUP_FORMAT,version:m.BACKUP_VERSION,data:await db.readAll()};const data=v.validateProgressions(m.validateBackup(raw));return await db.mergeBackup(data);});assert.equal(result.workouts,0);assert.equal(result.progressions,0);
 assert.deepEqual(errors,[]);console.log('PASS mixed methods, dynamic test sets, reload, independent decisions, zero shortfall, partial, duplicate import');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
