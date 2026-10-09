
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const apiFiles = ['initiate-payment', 'mpesa-callback', 'normalize-phone', 'verify-payment'];
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let p = decodeURIComponent(parsed.pathname);
  if (p === '/' || p === '/index.html') p = '/index.html';
  if (!path.extname(p)) p = p.replace(/\/$/, '') + '.html';
  if (p.startsWith('/api/')) {
    const name = path.basename(p.replace('/api/', ''));
    if (apiFiles.includes(name)) {
      const fp = path.join(__dirname, 'api', name + '.js');
      try {
        const vm = require('vm');
        const code = fs.readFileSync(fp, 'utf8');
        const sandbox = { req: { method: req.method, url: req.url, headers: req.headers }, res: { headers: {}, send: (b) => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(b); } }, console, process, Buffer, setTimeout };
        vm.createScript(code).runInNewContext(sandbox);
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({error: e.message})); }
      return;
    }
  }
  const safe = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
  const fp = path.join(__dirname, safe);
  if (!fp.startsWith(__dirname) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  const type = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {'Content-Type': type});
  fs.createReadStream(fp).pipe(res);
});
server.listen(PORT, () => console.log('Server running at http://localhost:' + PORT));

