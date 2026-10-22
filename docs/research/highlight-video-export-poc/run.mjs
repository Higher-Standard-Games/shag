import fs from 'node:fs/promises';
import path from 'node:path';
import { openBrowser, sleep } from '../../../.claude/skills/browser-probe/scripts/cdp.mjs';
import { startServer, resultsDir } from './server.mjs';

const { server, url } = await startServer();
let browser; const report = { started: new Date().toISOString(), origin: url, cases: {} };
try {
  browser = await openBrowser({ width: 900, height: 650 });
  await browser.send('Page.navigate', { url });
  for (let i=0;i<30;i++) { if(await browser.ev('window.pocReady === true')) break;await sleep(200); }
  report.capabilities=await browser.ev('window.poc.capabilities()');console.log('capabilities',JSON.stringify(report.capabilities));
  for (const [name,expression] of [
    ['extras','window.poc.extras()'],
    ['baseline',`window.poc.runCase('baseline')`],
    ['stalled',`window.poc.runCase('stalled',true)`],
    ['streamed',`window.poc.runCase('streamed',false,null,true)`],
    ['cancelled',`window.poc.runCase('cancelled',false,40)`],
    ['afterCancel',`window.poc.runCase('after-cancel')`],
  ]) {
    const result=await browser.ev(expression);report.cases[name]=result;console.log(name,JSON.stringify(result));
    if(typeof result==='string'&&result.startsWith('EVAL-ERR')) throw new Error(result);
    if(result===undefined) throw new Error(`CDP timeout: ${name}`);
  }
  await browser.shot(path.join(resultsDir,'page-with-excluded-controls.png'));
  report.ok=true;
} catch(error) { report.ok=false;report.error=String(error.stack);console.error(error);process.exitCode=1; }
finally {
  if(browser) {report.logs=browser.logs;report.failed=browser.failed;await browser.close();}
  await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(resultsDir,'report.json'),JSON.stringify(report,null,2));
  console.log('result',JSON.stringify({ok:report.ok,path:resultsDir}));
  process.exit(process.exitCode??0);
}
