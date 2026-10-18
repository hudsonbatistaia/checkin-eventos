// Atualiza o número de versão (?v=) de todos os .js e .css pedidos pelas páginas do site.
// Rodar SEMPRE antes de publicar: evita o navegador misturar página nova com código antigo.
// Uso: node ferramentas/nova-versao.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const d = new Date(), p = (n) => String(n).padStart(2, '0');
const v = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
for (const arq of fs.readdirSync(SITE).filter((f) => f.endsWith('.html'))) {
  const f = path.join(SITE, arq);
  const antes = fs.readFileSync(f, 'utf8');
  const depois = antes.replace(/((?:src|href)="\/(?:js|css)\/[\w.-]+\.(?:js|css))(?:\?v=\w+)?"/g, `$1?v=${v}"`);
  if (depois !== antes) { fs.writeFileSync(f, depois); console.log(`${arq}: versão ${v}`); }
}
