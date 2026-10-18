/* Check-in de Eventos — formulário do cadastro na entrada (tablet e celular).
   Monta os campos pedidos pelo evento, aplica máscaras e confere antes de enviar (o banco confere de novo). */
(function (root) {
  "use strict";
  const C = root.Comum, esc = C.esc;

  const ATRIB = {
    cpf: 'type="text" inputmode="numeric" maxlength="14" placeholder="000.000.000-00"',
    nascimento: 'type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa"',
    email: 'type="email" inputmode="email" maxlength="160" autocapitalize="off" spellcheck="false"',
    telefone: 'type="text" inputmode="tel" maxlength="16" placeholder="(92) 99999-9999"',
  };

  // Campos do evento; no celular o CPF é sempre obrigatório (logo depois da empresa).
  function camposCom(campos, opcoes) {
    const lista = (Array.isArray(campos) ? campos : [{ chave: "empresa", obrigatorio: false }]).map((c) => ({ ...c }));
    if (opcoes && opcoes.cpfObrigatorio) {
      const cpf = lista.find((c) => c.chave === "cpf");
      if (cpf) cpf.obrigatorio = true;
      else lista.splice(lista[0] && lista[0].chave === "empresa" ? 1 : 0, 0, { chave: "cpf", obrigatorio: true });
    }
    return lista;
  }

  const html = (campos) => campos.map((c) => `<label><span>${esc(C.rotuloCampo(c))}${c.obrigatorio ? "" : ' <span class="opc">(opcional)</span>'}</span>
      <input ${ATRIB[c.chave] || 'type="text" maxlength="160"'} autocomplete="off" data-campo="${c.chave}"></label>`).join("");

  // Máscaras enquanto digita.
  function ligarMascaras(el) {
    el.addEventListener("input", (e) => {
      const i = e.target, k = i.dataset && i.dataset.campo;
      if (!k) return;
      i.classList.remove("invalido");
      if (k === "cpf") i.value = C.mascaraCpf(i.value);
      else if (k === "telefone") i.value = C.mascaraTelefone(i.value);
      else if (k === "nascimento") i.value = C.mascaraData(i.value);
    });
  }
  const valores = (el) => Object.fromEntries([...el.querySelectorAll("[data-campo]")].map((i) => [i.dataset.campo, i.value]));
  function restaurar(el, v) { for (const [k, x] of Object.entries(v || {})) { const i = el.querySelector(`[data-campo="${k}"]`); if (i) i.value = x; } }

  // Lê e confere. Devolve { erro, foco } ou { nome, empresa, dados }.
  function coletar({ nome: campoNome, area, campos, consente, exigirSobrenome }) {
    const nome = campoNome.value.trim().replace(/\s+/g, " ");
    if (nome.length < 2) return { erro: "Informe o nome completo.", foco: campoNome };
    if (exigirSobrenome && !/\S\s+\S/.test(nome)) return { erro: "Informe o nome completo (nome e sobrenome).", foco: campoNome };
    const d = new Date(), hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dados = { extras: {} };
    let empresa = "";
    for (const c of campos) {
      const inp = area.querySelector(`[data-campo="${c.chave}"]`);
      const v = inp ? inp.value.trim().replace(/\s+/g, " ") : "";
      if (!v) { if (c.obrigatorio) return { erro: `Preencha: ${C.rotuloCampo(c)}.`, foco: inp }; continue; }
      if (c.chave === "empresa") empresa = v;
      else if (c.chave === "cpf") { if (!C.cpfValido(v)) return { erro: "CPF inválido. Confira os números.", foco: inp }; dados.cpf = C.digitos(v); }
      else if (c.chave === "nascimento") { const iso = C.dataParaIso(v); if (!iso || iso < "1900-01-01" || iso > hoje) return { erro: "Data de nascimento inválida. Use dd/mm/aaaa.", foco: inp }; dados.nascimento = iso; }
      else if (c.chave === "email") { if (!C.emailValido(v)) return { erro: "E-mail inválido.", foco: inp }; dados.email = v; }
      else if (c.chave === "telefone") { if (C.digitos(v).length < 10) return { erro: "Telefone inválido. Use DDD + número.", foco: inp }; dados.telefone = C.digitos(v); }
      else dados.extras[c.chave] = v;
    }
    if (C.precisaConsentimento(campos)) {
      if (!consente.checked) return { erro: "Para continuar, marque a autorização de uso dos dados.", foco: consente };
      dados.consentiu = true;
    }
    return { nome, empresa, dados };
  }

  // Mensagem para cada recusa do banco ao cadastrar.
  function mensagemErro(r, noCelular) {
    switch (r.erro) {
      case "rede": return "Não foi possível fazer o check-in. Verifique a internet e tente de novo.";
      case "nome": return "Informe o nome completo.";
      case "limite": return "Limite de cadastros atingido.";
      case "campo": return r.msg || "Confira os dados.";
      case "consentimento": return "Para continuar, marque a autorização de uso dos dados.";
      case "cpf_repetido": return `Este CPF já fez check-in às ${C.hhmm(r.horario)}.`;
      default: return noCelular ? "Não foi possível fazer o check-in. Procure a recepção." : "";
    }
  }

  root.Formulario = { camposCom, html, ligarMascaras, valores, restaurar, coletar, mensagemErro };
})(typeof self !== "undefined" ? self : this);
