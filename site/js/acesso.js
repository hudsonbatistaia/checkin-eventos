/* Login da organização (Supabase Auth). Mesmo funcionamento dos outros sistemas,
   mas com tela de entrada própria (sem passar pelo portal). */
window.Acesso = (function () {
  "use strict";
  const DOMINIO = "hbone.com.br";
  const MINUTOS_INATIVIDADE = 60;
  const $ = (id) => document.getElementById(id);
  const MENSAGENS = [
    [/invalid login credentials/i, "Usuário ou senha incorretos."],
    [/email not confirmed/i, "Este usuário ainda não foi ativado."],
    [/rate limit|too many/i, "Muitas tentativas. Espere alguns minutos e tente de novo."],
    [/should be different/i, "A nova senha precisa ser diferente da atual."],
    [/failed to fetch|network|load failed/i, "Sem conexão com o servidor. Verifique a internet."],
    [/sem permissão/i, "Este usuário não tem acesso a este sistema."],
  ];
  function traduzir(erro) {
    const msg = (erro && (erro.message || erro.msg)) || String(erro || "Erro desconhecido");
    for (const [re, txt] of MENSAGENS) if (re.test(msg)) return txt;
    return msg;
  }
  function aviso(id, texto, ok) { const el = $(id); el.textContent = texto || ""; el.classList.toggle("ok", !!ok); }
  function tela(qual) {
    $("telaAcesso").hidden = qual === "livre";
    $("formEntrar").hidden = qual !== "entrar";
    $("formNovaSenha").hidden = qual !== "senha";
    $("msgCarregando").hidden = qual !== "carregando";
    document.body.classList.toggle("bloqueado", qual !== "livre");
  }
  const emailDe = (u) => { u = (u || "").trim().toLowerCase(); return u.includes("@") ? u : u + "@" + DOMINIO; };

  function vigiarInatividade(cliente) {
    let timer;
    const reiniciar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { cliente.auth.signOut().finally(() => window.location.reload()); }, MINUTOS_INATIVIDADE * 60000);
    };
    ["click", "keydown", "scroll", "mousemove", "touchstart"].forEach((ev) => window.addEventListener(ev, reiniciar, { passive: true }));
    reiniciar();
  }

  // Devolve uma promessa que só termina quando há um usuário com acesso.
  function garantir(cliente) {
    return new Promise((pronto) => {
      const confirmarAcesso = async () => {
        const r = await cliente.rpc("sessao");
        if (r.error) throw r.error;
        return r.data;
      };
      const liberar = (eu) => {
        $("usuarioNome").textContent = eu.nome;
        tela("livre");
        vigiarInatividade(cliente);
        pronto(eu);
      };
      $("formEntrar").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const btn = $("btnEntrar");
        btn.disabled = true;
        aviso("msgAcesso", "Entrando…", true);
        try {
          const r = await cliente.auth.signInWithPassword({ email: emailDe($("campoUsuario").value), password: $("campoSenha").value });
          if (r.error) throw r.error;
          $("campoSenha").value = "";
          let eu;
          try { eu = await confirmarAcesso(); } catch (e) { await cliente.auth.signOut(); throw e; }
          aviso("msgAcesso", "");
          liberar(eu);
        } catch (e) {
          aviso("msgAcesso", traduzir(e));
        } finally {
          btn.disabled = false;
        }
      });
      $("btnSair").addEventListener("click", async () => {
        try { await cliente.auth.signOut(); } catch { /* sai mesmo assim */ }
        try { sessionStorage.clear(); } catch { /* sem armazenamento */ }
        const isHbone = window.location.hostname.endsWith("hbone.com.br");
        const domain = isHbone ? "; domain=.hbone.com.br" : "";
        document.cookie = "sb_auth_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + domain + "; SameSite=Lax; Secure";
        window.location.hash = "";
        if (isHbone) {
          window.location.href = "https://portal.hbone.com.br";
        } else {
          window.location.reload();
        }
      });
      $("btnTrocarSenha").addEventListener("click", () => { aviso("msgNovaSenha", ""); tela("senha"); $("campoNova1").focus(); });
      $("btnCancelarSenha").addEventListener("click", () => tela("livre"));
      $("formNovaSenha").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const s1 = $("campoNova1").value, s2 = $("campoNova2").value;
        if (s1.length < 10) { aviso("msgNovaSenha", "A senha precisa ter pelo menos 10 caracteres."); return; }
        if (s1 !== s2) { aviso("msgNovaSenha", "As duas senhas não são iguais."); return; }
        const r = await cliente.auth.updateUser({ password: s1 });
        if (r.error) { aviso("msgNovaSenha", traduzir(r.error)); return; }
        $("campoNova1").value = $("campoNova2").value = "";
        aviso("msgNovaSenha", "Senha alterada.", true);
        setTimeout(() => tela("livre"), 900);
      });

      (async function iniciar() {
        tela("carregando");
        let s = null;
        try { s = (await cliente.auth.getSession()).data.session; } catch { /* sem sessão */ }

        // 1. Tenta hash da URL vindo do Portal Geral (#access_token=...)
        if (!s && window.location.hash && window.location.hash.includes("access_token=")) {
          try {
            const hashStr = window.location.hash.replace(/^#/, "");
            const params = new URLSearchParams(hashStr);
            const at = params.get("access_token");
            const rt = params.get("refresh_token") || "";
            if (at) {
              const ret = await cliente.auth.setSession({ access_token: at, refresh_token: rt });
              if (ret && ret.data && ret.data.session) {
                s = ret.data.session;
                history.replaceState(null, "", window.location.pathname + window.location.search);
              }
            }
          } catch (e) {}
        }

        // 2. Tenta cookie compartilhado sb_auth_token (.hbone.com.br)
        if (!s) {
          const m = document.cookie.match(/(?:^|; )sb_auth_token=([^;]*)/);
          if (m && m[1]) {
            try {
              const token = decodeURIComponent(m[1]);
              const ret = await cliente.auth.setSession({ access_token: token, refresh_token: "" });
              if (ret && ret.data && ret.data.session) s = ret.data.session;
            } catch (e) {}
          }
        }

        if (s) {
          try { liberar(await confirmarAcesso()); return; } catch { await cliente.auth.signOut(); }
        }

        // No ar (hbone.com.br), o acesso é OBRIGATÓRIO pelo Portal Geral
        if (window.location.hostname.endsWith("hbone.com.br")) {
          window.location.href = "https://portal.hbone.com.br";
          return;
        }

        // Apenas em testes locais permite o formulário de login manual
        tela("entrar");
        $("campoUsuario").focus();
      })();
    });
  }
  return { garantir, traduzir };
})();
