const { chromium, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = '/home/claw/tmp/cashier-auth-e2e';
const BASE = process.env.CASHIER_E2E_URL || 'http://127.0.0.1:8788';
const token = process.env.CASHIER_E2E_TOKEN || fs.readFileSync(path.join(ROOT,'docker-compose.yml'),'utf8').match(/CASHIER_API_TOKEN:\s*(\S+)/)[1];
const report = { assertions: [], network: [], console: [], limitations: [] };
let browser, page, lastPostBody;
function ok(name, condition) { assert(condition, name); report.assertions.push({name, passed:true}); console.log('PASS',name); }
async function shot(name) { await page.screenshot({path:path.join(ROOT, name+'.png'), fullPage:true}); }
async function sync() { const button = page.getByRole('button',{name:'Synchronize',exact:true}); await button.click(); await page.waitForTimeout(300); await expect(page.getByText('Sync diagnostics',{exact:true})).toBeVisible({timeout:90000}); await expect(button).toBeEnabled({timeout:90000}); await page.waitForTimeout(200); return page.locator('body').innerText(); }
async function setToken(value) { await page.getByLabel('API token').fill(value); await page.getByLabel('Remote root book file').click(); await page.waitForTimeout(250); }
(async()=>{
 fs.chmodSync(path.join(ROOT,'workspace/manual_transactions.bean'),0o666);
 const context=await chromium.launchPersistentContext(fs.mkdtempSync('/tmp/cashier-auth-browser-'),{headless:true,serviceWorkers:'block',viewport:{width:1280,height:1000}}); browser=context; page=await context.newPage();
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/xact')lastPostBody=r.postData();});
 page.on('response',r=>{const u=new URL(r.url()); if(u.origin===BASE && !u.pathname.startsWith('/_app/') && !/\.(png|svg|ico|js|css)$/.test(u.pathname)) report.network.push({method:r.request().method(),path:u.pathname,status:r.status()});});
 page.on('console',msg=> { const s=msg.text().split(token).join('[REDACTED]'); if(msg.type()==='error'||/parse|ledger|wasm/i.test(s))report.console.push({type:msg.type(),text:s.slice(0,2000)}); });
 const cdp=await page.context().newCDPSession(page); await cdp.send('Storage.overrideQuotaForOrigin',{origin:BASE,quotaSize:1073741824});
 report.limitations.push('Host root filesystem is 99% full; Chromium origin quota overridden to 1 GiB via CDP to avoid incidental OPFS QuotaExceededError. Real OPFS and APIs remain in use.');
 await page.goto(BASE+'/sync'); await page.waitForTimeout(1500);
 await page.getByLabel('Data source').selectOption({label:'Beancount'});
 await page.getByLabel('Cashier Server URL').fill(BASE+'/api');
 await page.getByLabel('Remote root book file').fill('main.bean');
 await page.locator('thead input[type=checkbox]').check();
 let n=report.network.length; let text=await sync();
 ok('Empty token rejects visible synchronization', /token|auth|401|Unauthorized/i.test(text) && !/Synchronization completed successfully!/.test(text)); await shot('01-empty-token');
 await setToken('wrong-local-token'); n=report.network.length; text=await sync();
 ok('Wrong token receives real HTTP 401',report.network.slice(n).some(r=>r.status===401)); await shot('02-wrong-token');
 await setToken(token); n=report.network.length; text=await sync(); fs.writeFileSync(path.join(ROOT,'sync-good.txt'),text);
 ok('Good token authenticated download succeeds',report.network.slice(n).some(r=>r.status===200));
 ok('Visible full ledger WASM parse completes', /Full ledger parsed\s*✓/.test(text));
 ok('Full ledger has zero parse errors', /Parse errors\s*0/.test(text)); await shot('03-successful-sync');
 await page.reload(); await page.waitForTimeout(1200); ok('Token persists after reload',(await page.getByLabel('API token').inputValue())===token);
 await page.goto(BASE+'/journal'); await page.waitForTimeout(800); await page.locator('button.fixed').click(); await page.waitForTimeout(600);
 fs.writeFileSync(path.join(ROOT,'tx-ui.txt'),await page.locator('body').innerText());
 fs.writeFileSync(path.join(ROOT,'tx-controls.json'),JSON.stringify(await page.locator('input,button').evaluateAll(els=>els.map(e=>({tag:e.tagName,title:e.title,placeholder:e.placeholder,text:e.textContent,type:e.type,cls:e.className}))),null,2)); await shot('04-transaction-editor');
 if(process.env.CASHIER_E2E_INSPECT_ONLY==='1') return;
 await runWriteback();
})().catch(async e=>{report.error=String(e.stack).split(token).join('[REDACTED]'); if(page)await shot('failure').catch(()=>{}); console.error(report.error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(ROOT,'browser-e2e-report.json'),JSON.stringify(report,null,2)); if(browser)await browser.close();});
async function createTransaction(note, alreadyEditor=false) {
 if(!alreadyEditor) { await page.goto(BASE+'/journal'); await page.waitForTimeout(600); await page.locator('button.fixed').click(); }
 await page.getByTitle('Note',{exact:true}).fill(note);
 for (const [index,account,amount] of [[0,'Expenses:Test','7.25'],[1,'Assets:Cash','-7.25']]) {
  await page.getByTitle('Account',{exact:true}).nth(index).click();
  await page.getByText(account,{exact:true}).click();
  await expect(page.getByTitle('Account',{exact:true}).nth(index)).toHaveValue(account);
  await page.getByTitle('Amount',{exact:true}).nth(index).fill(amount);
  await page.getByTitle('Currency',{exact:true}).nth(index).fill('USD');
 }
 await page.getByTitle('Mark as complete',{exact:true}).click(); await shot('05-'+note+'-ready');
 await page.locator('button.fixed').click(); await page.waitForTimeout(800);
 ok('Visible journal stores '+note,(await page.locator('body').innerText()).includes(note));
}
async function runWriteback() {
 const file=path.join(ROOT,'workspace/manual_transactions.bean');
 const note='auth-e2e-'+Date.now();
 await createTransaction(note,true); await shot('06-local-journal');
 const before=fs.readFileSync(file,'utf8');
 await page.goto(BASE+'/sync'); await page.waitForTimeout(600); let n=report.network.length; const text=await sync();
 ok('Visible sync makes authenticated POST /xact',report.network.slice(n).some(r=>r.method==='POST'&&r.path==='/api/xact'&&r.status===200));
 const written=fs.readFileSync(file,'utf8'); ok('Server manual file contains visible UI transaction',written.includes(note));
 const payload=JSON.parse(lastPostBody); report.writebackPayload=payload;
 ok('Server preserves decimal amount from real browser POST', written.slice(written.indexOf(note)).includes('7.25 USD'));
 report.serverWrittenLedger=written;
 report.regressions=[{name:'Server preserves decimal amount from real browser POST',passed:written.includes('7.25 USD'),expected:'7.25 USD',actual:written.includes('7.25 USD')?'7.25 USD':'7 USD'}];
 const duplicate=await page.request.post(BASE+'/api/xact',{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},data:lastPostBody});
 report.network.push({method:'POST',path:'/api/xact',status:duplicate.status(),source:'real identical-payload retry'});
 ok('Real identical-payload POST retry succeeds',duplicate.status()===200);
 ok('Server deduplicates stable cashier_id on identical POST retry',fs.readFileSync(file,'utf8')===written);
 ok('Writeback pull full ledger parses without errors',/Full ledger parsed\s*✓/.test(text)&&/Parse errors\s*0/.test(text));
 ok('Reconcile step completes',/Reconcile local journal\s*✓/.test(text)); await shot('07-writeback-success');
 await page.goto(BASE+'/journal'); await page.waitForTimeout(700); ok('Local overlay removed only after successful pull',(await page.locator('body').innerText()).includes('The device journal is empty')); await shot('08-reconciled-journal');
 await page.goto(BASE+'/sync'); await page.waitForTimeout(600); await sync(); ok('Retry produces no duplicate server entry',fs.readFileSync(file,'utf8')===written); await shot('09-retry');
 const rejectedNote='auth-e2e-rejected-'+Date.now(); await createTransaction(rejectedNote); const unchanged=fs.readFileSync(file,'utf8');
 await page.goto(BASE+'/sync'); await page.waitForTimeout(600); await setToken('wrong-local-token');
 await page.getByLabel('Accounts',{exact:true}).uncheck(); await page.getByLabel('Payees',{exact:true}).uncheck();
 n=report.network.length; await sync(); ok('Wrong token rejects real writeback POST with 401',report.network.slice(n).some(r=>r.method==='POST'&&r.path==='/api/xact'&&r.status===401));
 ok('Unauthorized writeback leaves server file byte-identical',fs.readFileSync(file,'utf8')===unchanged); await shot('10-unauthorized-writeback');
 await page.goto(BASE+'/journal'); await page.waitForTimeout(700); ok('Unauthorized writeback preserves local entry',(await page.locator('body').innerText()).includes(rejectedNote)); await shot('11-preserved-local');
 report.limitations.push('Service workers disabled for deterministic network observability; service-worker/offline behavior not tested. No lost-response fault injection was performed; retry after successful reconcile was tested.');
}
