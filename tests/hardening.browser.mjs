import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:5184');await page.locator('.demo-roles').waitFor();
 await page.evaluate(async()=>{const {demoGateway:d,resetDemo,selectDemo}=await import('/src/demo.ts');resetDemo();selectDemo('owner');for(let i=0;i<51;i++)await d.saveBoard({group:'g0',course:null,kind:'schedule',title:'Lesson '+i,body:'',location:'204',start:'2026-10-15T03:00:00Z',end:'2026-10-15T04:00:00Z',id:null});await d.createAssignment('g0c0','Submitted test','',null,10,true);const a=(await d.assignments('g0c0')).items[0];selectDemo('student');await d.submit(a.id,'Answer',null);await d.saveNote('Search note','Find this material',null,null);});
 await page.getByRole('button',{name:'Студент',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:/Submitted test/}).count(),0);
 await page.locator('.sidebar').getByRole('button',{name:'Календарь',exact:true}).click();await page.getByLabel('Месяц',{exact:true}).fill('2026-10');await page.getByRole('button',{name:/15 октября, событий: 51/}).waitFor();
 await page.locator('.sidebar').getByRole('button',{name:'Мои заметки',exact:true}).click();await page.getByLabel('Название заметки',{exact:true}).fill('Recovery draft');await page.getByLabel('Текст заметки',{exact:true}).fill('Never lose this text');
 page.on('dialog',d=>d.accept());await page.locator('.sidebar').getByRole('button',{name:'Календарь',exact:true}).click();await page.getByLabel('Месяц',{exact:true}).waitFor();
 await page.locator('.sidebar').getByRole('button',{name:'Мои заметки',exact:true}).click();assert.equal(await page.getByLabel('Текст заметки',{exact:true}).inputValue(),'Never lose this text');
 await page.getByRole('button',{name:'Сохранить заметку',exact:true}).click();await page.getByText('Заметка сохранена.',{exact:true}).waitFor();
 await page.locator('.sidebar').getByRole('button',{name:'Поиск',exact:true}).click();await page.getByLabel('Поиск по учебному пространству',{exact:true}).fill('Search note');await page.getByRole('button',{name:'Найти',exact:true}).click();await page.getByRole('heading',{name:'Search note',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);console.log('PASS mobile full calendar (51 lessons), submitted-work filtering, draft recovery after calendar navigation, global search');
}finally{await browser.close();}
