import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.setDefaultTimeout(10000);
 await page.clock.install({time:new Date('2026-10-15T03:12:00Z')});await page.goto(process.env.SCHEDULE_TEST_URL||'http://127.0.0.1:5201/');await page.locator('.demo-roles').waitFor();
 await page.evaluate(async()=>{const {demoGateway:api,resetDemo,selectDemo}=await import('/src/demo.ts');resetDemo();selectDemo('owner');for(const [title,start,end] of [['Текущая лекция','09:00','10:20'],['Следующий семинар','10:30','11:50']])await api.saveBoard({group:'g0',course:'g0c0',kind:'schedule',title,body:'Подготовить конспект',location:'204',start:new Date('2026-10-15T'+start+':00+06:00').toISOString(),end:new Date('2026-10-15T'+end+':00+06:00').toISOString(),id:null});});
 await page.locator('.demo-roles').getByRole('button',{name:'Студент',exact:true}).click();await page.locator('.sidebar').getByRole('button',{name:'Расписание',exact:true}).click();
 const panel=page.locator('.schedule-world');await panel.getByRole('button',{name:/Текущая лекция/}).waitFor();assert.equal(await panel.locator('.schedule-lesson.current').count(),1);await panel.getByText('Перерыв · 10 мин',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Управление занятиями'}).count(),0);
 await panel.getByRole('button',{name:/Текущая лекция/}).click();await panel.getByRole('button',{name:'Материалы занятия'}).click();assert.equal(await page.locator('.course-tabs').getByRole('button',{name:'Материалы',exact:true}).getAttribute('aria-current'),'page');
 await page.locator('.sidebar').getByRole('button',{name:'Расписание',exact:true}).click();await panel.getByRole('button',{name:'Неделя',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.schedule-day').length===7);await panel.getByRole('button',{name:/Текущая лекция/}).waitFor();
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'schedule overflow at '+width);}
 await page.screenshot({path:'/tmp/studyhub-schedule-mobile.png',fullPage:true});
 await panel.getByRole('button',{name:'Следующая неделя'}).click();await panel.getByRole('button',{name:/Текущая лекция/}).waitFor({state:'hidden'});await panel.getByRole('button',{name:'Сегодня',exact:true}).click();await panel.getByRole('button',{name:/Текущая лекция/}).waitFor();assert.deepEqual(errors,[]);console.log('PASS schedule day/week/navigation/current/break/course materials/mobile/no console errors');
}finally{await browser.close();}
