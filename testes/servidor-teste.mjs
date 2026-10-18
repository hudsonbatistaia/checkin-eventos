// Servidor de teste: site na porta 3999 (como o Caddy: /e/<evento> abre evento.html)
// e um Supabase falso na porta 3998 (login + funções do schema checkin, banco PGlite).
// Rodar e deixar aberto: node servidor-teste.mjs   (reiniciar para começar com banco limpo)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { criarBanco, chamar, naFila, USUARIOS, RAIZ } from './banco-teste.mjs';

const db = await criarBanco();
const SITE = RAIZ + '/site';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sessao = (uid, email) => ({
  access_token: b64({ alg: 'HS256' }) + '.' + b64({ sub: uid, email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + uid,
  user: { id: uid, email, aud: 'authenticated', role: 'authenticated' },
});
const uidDe = (req) => {
  try { const t = (req.headers.authorization || '').split(' ')[1]; if (!t || t.startsWith('sb_')) return null; return JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).sub; }
  catch { return null; }
};
export const contador = {};

http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let corpo = ''; for await (const c of req) corpo += c;
  const json = (st, o) => { res.writeHead(st, { ...cors, 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const url = new URL(req.url, 'http://x');
  // atalhos só do teste: consultar o banco por fora
  if (url.pathname === '/teste/sql') {
    try { return json(200, (await naFila(() => db.query(JSON.parse(corpo).sql))).rows); } catch (e) { return json(400, { message: e.message }); }
  }
  if (url.pathname === '/teste/contador') return json(200, contador);
  if (url.pathname === '/auth/v1/token') {
    const b = JSON.parse(corpo || '{}');
    if (url.searchParams.get('grant_type') === 'refresh_token') { const uid = b.refresh_token.slice(2); return json(200, sessao(uid, Object.keys(USUARIOS).find((e) => USUARIOS[e][0] === uid))); }
    const u = USUARIOS[b.email];
    if (!u || u[1] !== b.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    return json(200, sessao(u[0], b.email));
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (url.pathname === '/auth/v1/user') {
    const uid = uidDe(req), email = Object.keys(USUARIOS).find((e) => USUARIOS[e][0] === uid);
    if (req.method === 'PUT') { const b = JSON.parse(corpo); if (b.password) USUARIOS[email][1] = b.password; }
    return json(200, { id: uid, email });
  }
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (!m) return json(404, { message: 'não existe: ' + url.pathname });
  if ((req.headers['content-profile'] || req.headers['accept-profile']) !== 'checkin') return json(400, { message: 'schema errado' });
  contador[m[1]] = (contador[m[1]] || 0) + 1;
  const r = await chamar(db, m[1], JSON.parse(corpo || '{}'), { uid: uidDe(req), ip: req.headers['x-teste-ip'] || req.socket.remoteAddress });
  if (r.error) return json(400, r.error);
  json(200, r.data === '' ? null : r.data);   // como o Supabase: função sem retorno devolve null
}).listen(3998);

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (/^\/e\/[^/]+\/?$/.test(p)) p = '/evento.html';
  if (/^\/q\/[^/]+\/[^/]+\/?$/.test(p)) p = '/convidado.html';   // no Caddy: rewrite /q/* /convidado.html
  const arq = path.join(SITE, p);
  if (!arq.startsWith(path.normalize(SITE)) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end('404'); }
  let conteudo = fs.readFileSync(arq);
  if (p === '/js/config.js') conteudo = conteudo.toString().replace(/supabaseUrl: "[^"]*"/, 'supabaseUrl: "http://localhost:3998"').replace(/supabaseKey: "[^"]*"/, 'supabaseKey: "sb_publishable_teste"');
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(conteudo);
}).listen(3999);
console.log('pronto: site http://localhost:3999 | supabase falso http://localhost:3998');
