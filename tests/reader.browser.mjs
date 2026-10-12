import {chromium} from 'playwright-core';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
function samplePdf(count=2){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:count},(_,i)=>(3+2*i)+' 0 R').join(' ')}] /Count ${count} >>`];
 for(let i=0;i<count;i++){const content=4+2*i,text=count===2?['StudyHub reader page one','StudyHub reader page two'][i]:i===count-1?'StudyHub LASTPAGEONLY':'Reader page '+(i+1);
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3+2*count} 0 R >> >> /Contents ${content} 0 R >>`);
  const stream=`BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 }
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 let data='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(data.length);data+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=data.length;data+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
 for(const off of offsets.slice(1))data+=`${String(off).padStart(10,'0')} 00000 n \n`;
 return data+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}
const folder=await mkdtemp(join(tmpdir(),'studyhub-reader-')),file=join(folder,'reader.pdf');
await writeFile(file,samplePdf());
const offline=process.env.READER_TEST_OFFLINE==='1';
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.READER_TEST_URL||'http://127.0.0.1:5173/?demo=1');if(offline)await page.context().setOffline(true);await page.getByRole('button',{name:'Владелец',exact:true}).click();await page.getByRole('heading',{name:'Обзор проекта',exact:true}).waitFor();await page.getByRole('button',{name:'Открыть админ',exact:true}).click();await page.getByRole('button',{name:'Публикации в библиотеке',exact:true}).click();
 await page.getByLabel('Название материала',{exact:true}).fill('PDF для чтения');await page.getByLabel('Файл',{exact:true}).setInputFiles(file);await page.getByRole('button',{name:'Загрузить материал',exact:true}).click();await page.getByText('Материал опубликован в общей библиотеке.').waitFor();
 await page.getByRole('button',{name:'Студент',exact:true}).click();await page.getByText('Ваше пространство',{exact:true}).waitFor();await page.getByRole('button',{name:'Библиотека',exact:true}).click();
 const card=page.locator('article').filter({has:page.getByRole('heading',{name:'PDF для чтения',exact:true})});await card.getByRole('button',{name:'Открыть',exact:true}).click();const dialog=page.getByRole('dialog',{name:'PDF для чтения'});
 await dialog.getByText('Страница 1 из 2 · Прогресс: 50%',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Следующая страница'}).click();await dialog.getByText('Страница 2 из 2 · Прогресс: 100%',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Добавить закладку'}).click();await dialog.getByRole('button',{name:'К странице 2',exact:true}).waitFor();await dialog.locator('.reader-more > summary').click();await dialog.getByRole('button',{name:'В избранное',exact:true}).click();await dialog.getByRole('button',{name:'Убрать из избранного',exact:true}).waitFor();
 await dialog.locator('.reader-more > summary').click();await dialog.locator('.reader-document details summary').click();await dialog.getByText('StudyHub reader page two',{exact:true}).waitFor();
 const pixels=await dialog.locator('canvas').evaluate(c=>{const ctx=c.getContext('2d');const p=ctx.getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<p.length;i+=4)if(p[i]<200&&p[i+1]<200&&p[i+2]<200&&p[i+3]>0)dark++;return dark;});assert.ok(pixels>100,'PDF canvas must contain rendered text');
 await dialog.getByRole('button',{name:'Поиск в документе',exact:true}).click();await dialog.getByLabel('Найти в тексте',{exact:true}).fill('page two');await dialog.getByRole('button',{name:'Найти фрагмент',exact:true}).click();await dialog.getByRole('button',{name:/Страница 2.*page two/}).click();await dialog.locator('.reader-text mark').getByText('page two',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Закрыть просмотр'}).click();if(offline)await page.context().setOffline(false);await page.reload();await page.getByText('Ваше пространство',{exact:true}).waitFor();if(offline)await page.context().setOffline(true);await page.getByRole('button',{name:'Библиотека',exact:true}).click();await card.getByRole('button',{name:'Открыть',exact:true}).click();await dialog.getByText('Страница 2 из 2 · Прогресс: 100%',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Закладки',exact:true}).click();await dialog.getByRole('button',{name:'К странице 2',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await dialog.locator('canvas').waitFor();assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Mobile reader must not overflow horizontally');
 if(!offline){await dialog.getByRole('button',{name:'Закрыть просмотр'}).click();await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Владелец',exact:true}).click();await page.getByRole('button',{name:'Открыть админ',exact:true}).click();await page.getByRole('button',{name:'Публикации в библиотеке',exact:true}).click();const longFile=join(folder,'long.pdf');await writeFile(longFile,samplePdf(401));await page.getByLabel('Название материала',{exact:true}).fill('Длинный PDF');await page.getByLabel('Файл',{exact:true}).setInputFiles(longFile);await page.getByRole('button',{name:'Загрузить материал',exact:true}).click();await page.getByText('Материал опубликован в общей библиотеке.').waitFor();await page.getByRole('button',{name:'Студент',exact:true}).click();await page.getByRole('button',{name:'Библиотека',exact:true}).click();await page.getByRole('button',{name:'Открыть «Длинный PDF»',exact:true}).click();const longDialog=page.getByRole('dialog',{name:'Длинный PDF'});await longDialog.getByText('Страница 1 из 401 · Прогресс: 0%',{exact:true}).waitFor();await longDialog.getByRole('button',{name:'Поиск в документе',exact:true}).click();await longDialog.getByLabel('Найти в тексте',{exact:true}).fill('LASTPAGEONLY');await longDialog.getByRole('button',{name:'Найти фрагмент',exact:true}).click();await longDialog.getByRole('button',{name:/Страница 401.*LASTPAGEONLY/}).click();await longDialog.getByText('Страница 401 из 401 · Прогресс: 100%',{exact:true}).waitFor();console.log('PASS real 401-page PDF: search reaches the final page beyond the old 400-page limit');}
 assert.deepEqual(errors,[]);console.log('PASS Chromium: PDF canvas/text, search highlights, pagination, progress, bookmarks, favorite, persisted reload, mobile layout; no page errors');
}finally{await browser?.close();await rm(folder,{recursive:true,force:true});}
