// Run after npm run build: node scripts/check_project_picker.mjs
import { preview } from 'vite';
import { chromium } from 'playwright';
import { installMockBackend } from './demo/mock_backend.mjs';
import assert from 'node:assert/strict';
const server = await preview({preview:{port:0,host:'127.0.0.1'}});
const browser = await chromium.launch();
try {
 const page = await browser.newPage({viewport:{width:1280,height:800}});
 await page.addInitScript(installMockBackend,{nowIso:'2026-10-05T09:30:00.000Z'});
 await page.addInitScript(() => {
  localStorage.setItem('quotabar.language','zh-CN'); localStorage.setItem('claude-quota-theme','dark');
  const original=window.__TAURI_INTERNALS__.invoke;
  window.pickerQueries=[];
  window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{
   const result=await original(cmd,args);
   if(cmd==='analysis_report') {
    window.pickerQueries.push(args);
    result.available_projects=['%2FUsers%2Fdemo%2FDesktop%2Fcode%2F中文%2Fquotabar','/home/test/another/quotabar','C:\\Users\\test\\work\\windows','/tmp/bad%path'];
    result.projects[0].projects[0].project_path=result.available_projects[0];
    result.projects[0].projects[0].sessions.forEach(s=>s.last_timestamp='2026-10-05T10:00:00Z');
   }
   return result;
  };
 });
 await page.goto(server.resolvedUrls.local[0]);
 // Locate by aria state too, independent of translated wording.
 const picker=page.locator('.project-picker-trigger'); await picker.waitFor(); await picker.click();
 const dialog=page.getByRole('dialog'); await dialog.waitFor();
 assert.equal(await dialog.locator('strong').filter({hasText:'quotabar'}).count(),2);
 assert(!(await dialog.innerText()).includes('%2F'));
 assert((await dialog.locator('.project-picker-list button').first().getAttribute('title')).includes('中文'));
 const bounds=await dialog.boundingBox(); assert(bounds.width<=360 && bounds.x>=0 && bounds.x+bounds.width<=1280);
 await page.screenshot({path:'/tmp/quotabar-project-picker-dark.png'});
 const search=dialog.getByRole('textbox'); await search.fill('中文');
 assert.equal(await dialog.locator('.project-picker-list button').count(),1);
 await search.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
 await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>window.pickerQueries.some(a=>a.query?.project==='%2FUsers%2Fdemo%2FDesktop%2Fcode%2F中文%2Fquotabar'));
 assert.equal(await picker.innerText(),'quotabar\n⌄');
 await picker.click(); await page.getByRole('dialog').getByRole('textbox').fill('nothing-matches');
 await page.locator('.project-picker-empty').waitFor();
 await page.keyboard.press('Escape'); assert(await picker.evaluate(el=>el===document.activeElement));
 await picker.click(); await page.locator('.analysis-sidebar, .workspace-sidebar').first().click({position:{x:10,y:100}}); assert.equal(await page.getByRole('dialog').count(),0);
 console.log('Verified: decoded Chinese, duplicate names, bounded popup, search, keyboard selection, raw backend project value, empty search, Escape focus, outside close. Screenshot: /tmp/quotabar-project-picker-dark.png');
} finally {await browser.close(); await server.httpServer.close();}
