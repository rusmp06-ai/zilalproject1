import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:5175');await page.locator('.demo-roles').waitFor();
 await page.evaluate(async()=>{const d=await import('/src/demo.ts');d.resetDemo();});
 await page.getByRole('button',{name:'Студент',exact:true}).click();
 await page.getByRole('button',{name:'＋ Добавить задачу',exact:true}).click();
 await page.getByLabel('Что нужно сделать').fill('Прочитать главу к семинару');
 await page.getByLabel('Срок задачи').fill('2026-01-01');
 await page.getByRole('button',{name:'Сохранить задачу',exact:true}).click();
 await page.getByText('Прочитать главу к семинару',{exact:true}).waitFor();assert.ok(await page.getByText(/Просрочено/).count());
 await page.reload();await page.getByText('Прочитать главу к семинару',{exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'Прочитать главу к семинару'}).click();await page.getByText('Прочитать главу к семинару',{exact:true}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Все задания',exact:true}).click();await page.getByLabel('Показать выполненные').check();
 await page.getByRole('checkbox',{name:'Прочитать главу к семинару'}).uncheck();
 await page.getByRole('button',{name:'Изменить задачу',exact:true}).click();await page.getByLabel('Срок задачи').fill('2026-10-15');await page.getByRole('button',{name:'Сохранить задачу',exact:true}).click();
 await page.getByRole('button',{name:'Календарь',exact:true}).click();await page.getByLabel('Месяц',{exact:true}).fill('2026-10');
 await page.getByRole('button',{name:/15 октября/}).click();await page.getByText('Прочитать главу к семинару',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/studyhub-plan-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS mobile plan create, reload, complete, restore, edit, calendar, no overflow/errors');
}finally{await browser.close();}
