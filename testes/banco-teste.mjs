// Banco de teste (PGlite) com o 01-banco.sql e imitações do Supabase (auth.uid, papéis, cabeçalhos).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
export const RAIZ = 'C:/Users/hudso/OneDrive - SISTEMA FIEAM/PROJETOS IA/Check-in de Eventos';

export const USUARIOS = {
  'hudson@hbone.com.br': ['00000000-0000-0000-0000-0000000000a1', 'Senha-Hudson-123'],
  'contratos@hbone.com.br': ['00000000-0000-0000-0000-0000000000c1', 'Senha-Contratos-123'],
};

export async function criarBanco() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;`);
  // No Supabase o site chega como "authenticator"; aqui marcamos com teste.api.
  const sql = fs.readFileSync(RAIZ + '/supabase/01-banco.sql', 'utf8')
    .split("session_user = 'authenticator'").join("current_setting('teste.api', true) = 'sim'");
  await db.exec(sql);
  for (const [e, [id]] of Object.entries(USUARIOS)) await db.exec(`insert into auth.users values ('${id}', '${e}')`);
  await db.exec(fs.readFileSync(RAIZ + '/supabase/02-usuarios.sql', 'utf8'));
  return db;
}

// Chama uma função como o site chamaria: papel anon/authenticated, usuário e IP.
let fila = Promise.resolve();
// Uma coisa por vez no banco (o papel anon/authenticated vale para a conexão inteira).
export function naFila(fn) { const p = fila.then(fn); fila = p.catch(() => {}); return p; }
export function chamar(db, funcao, args = {}, { uid = null, ip = '10.0.0.1' } = {}) {
  const nomes = Object.keys(args);
  return naFila(async () => {
    const cab = JSON.stringify({ 'x-forwarded-for': ip });
    await db.exec(`set teste.uid = '${uid || ''}'; set teste.api = 'sim'; set request.headers = '${cab}'; set role ${uid ? 'authenticated' : 'anon'};`);
    try {
      const r = await db.query(`select checkin.${funcao}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(',')}) r`,
        nomes.map((n) => (args[n] !== null && typeof args[n] === 'object' && !Array.isArray(args[n])) || (Array.isArray(args[n]) && n !== 'p_grupos') ? JSON.stringify(args[n]) : args[n]));
      return { data: r.rows[0].r };
    } catch (e) {
      return { error: { message: e.message, code: e.code } };
    } finally {
      await db.exec(`reset role; set teste.api = ''; set teste.uid = ''; set request.headers = '';`);
    }
  });
}
