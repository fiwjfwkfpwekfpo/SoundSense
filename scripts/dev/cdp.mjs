// Dev helper: evaluates an expression in a running SoundSense desktop window over the
// DevTools protocol (start it with --remote-debugging-port=<port>). Node 20: run with
// --experimental-websocket. Usage: node scripts/dev/cdp.mjs 9333 "document.title"
const [port = '9333', expression = 'document.title', size] = process.argv.slice(2); // size: WIDTHxHEIGHT emulates a window size, 'reset' clears it
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page');
if (!page) throw new Error('No page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
const send = (method, params = {}) => new Promise(resolve => { const next = ++id; pending.set(next, resolve); ws.send(JSON.stringify({ id: next, method, params })); });
await new Promise(resolve => { ws.onopen = resolve; });
if (size === 'reset') await send('Emulation.clearDeviceMetricsOverride');
else if (size) { const [width, height] = size.split('x').map(Number); await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 0, mobile: false }); }
if (expression.startsWith('@shot:')) { // @shot:path.jpg saves a JPEG screenshot of the page
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
  (await import('node:fs')).writeFileSync(expression.slice(6), Buffer.from(shot.result.data, 'base64')); ws.close(); process.exit(0);
}
const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
const value = result.result?.exceptionDetails ? { exception: result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text } : result.result?.result?.value;
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
ws.close();
