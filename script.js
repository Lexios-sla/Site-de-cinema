'use strict';
/* "use strict" ativa o modo estrito: o JS avisa sobre erros comuns
   (variáveis não declaradas, etc.) em vez de ignorá-los. */

/* =====================================================================
   1. CONSTANTES E UTILITÁRIOS
   ===================================================================== */
const PRECO_INGRESSO = 30;                       // preço fixo de cada assento
const FILEIRAS = ['A', 'B', 'C', 'D', 'E'];      // letras das fileiras da sala
const POR_FILEIRA = 6;                           // assentos por fileira
const TOTAL_ASSENTOS = FILEIRAS.length * POR_FILEIRA;
const CHAVE_DB = 'cinema-db-v1';                 // nome da gaveta no localStorage
const CHAVE_LOGIN = 'cinema-login';              // guarda quem está logado (sessionStorage)
const CHAVE_A11Y = 'cinema-a11y';                // guarda preferências de acessibilidade

// Atalhos para buscar elementos no HTML
const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

// Formata número como dinheiro brasileiro: 30 -> "R$ 30,00"
const moeda = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// "2026-11-14" -> "14/11/2026" (feito com split para evitar problemas de fuso horário)
function formatarData(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Data de hoje (+ N dias) no formato "AAAA-MM-DD", usada nos dados de exemplo
function dataISO(diasAFrente = 0) {
  const d = new Date();
  d.setDate(d.getDate() + diasAFrente);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Gera um código curto e difícil de adivinhar (ex.: "9F3A1C7B")
function gerarCodigo() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Máscara de CPF: vai pontuando enquanto a pessoa digita -> "123.456.789-60"
function formatarCpf(valor) {
  const d = valor.replace(/\D/g, '').slice(0, 11);               // só dígitos, no máximo 11
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')                            // 123.4
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')               // 123.456.7
    .replace(/\.(\d{3})(\d)/, '.$1-$2');                        // 123.456.789-6
}

// Máscara de telefone: "(91) 99151-7602" (11 dígitos) ou "(91) 9915-7602" (10 dígitos)
function formatarTelefone(valor) {
  const d = valor.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// "suporte" -> "Suporte" (é o que aparece no cabeçalho)
const rotuloPerfil = u => u.perfil.charAt(0).toUpperCase() + u.perfil.slice(1);

/* Cria elementos DOM de forma SEGURA.
   Textos entram via append() (viram texto puro, nunca HTML), o que impede
   ataques XSS caso alguém digite "<script>" num formulário. */
function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [chave, valor] of Object.entries(attrs)) {
    if (chave === 'class') e.className = valor;
    else if (chave.startsWith('on') && typeof valor === 'function') e.addEventListener(chave.slice(2), valor);
    else if (valor === true) e.setAttribute(chave, '');           // atributo booleano (disabled, selected)
    else if (valor !== false && valor != null) e.setAttribute(chave, valor);
  }
  e.append(...filhos.flat().filter(f => f != null && f !== false));
  return e;
}

// Mostra uma mensagem temporária (toast) na parte de baixo da tela
function avisar(mensagem, tipo = 'ok') {
  const t = $('#aviso');
  t.textContent = mensagem;
  t.className = `aviso ${tipo} visivel`;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => t.classList.remove('visivel'), 4500);
}

// Envolve uma função: se ela lançar erro, mostra a mensagem em vez de quebrar a página
const tentar = fn => (...args) => {
  try { return fn(...args); } catch (erro) { avisar(erro.message, 'erro'); }
};

// Liga um formulário a uma função, cancelando o envio padrão (que recarregaria a página)
function aoEnviar(seletor, fn) {
  $(seletor).addEventListener('submit', evento => {
    evento.preventDefault();
    tentar(fn)(evento.currentTarget);
  });
}

// Monta uma tabela acessível a partir de títulos e linhas
function tabela(titulos, linhas, vazio = 'Nenhum registro.') {
  if (!linhas.length) return el('p', { class: 'vazio' }, vazio);
  return el('div', { class: 'tabela-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {}, titulos.map(t => el('th', { scope: 'col' }, t)))),
      el('tbody', {}, linhas.map(l => el('tr', {}, l.map(c => el('td', {}, c)))))));
}

/* =====================================================================
   2. CLASSES DE DOMÍNIO (espelham o diagrama de classes)
   ===================================================================== */

/* ---------- Filme ---------- */
class Filme {
  constructor({ id, titulo, genero, duracao, notas = [] }) {
    Object.assign(this, { id, titulo, genero, duracao: Number(duracao), notas: [...notas] });
  }
  // notaAvaliacao: média de todas as notas recebidas
  get notaAvaliacao() {
    return this.notas.length ? this.notas.reduce((a, b) => a + b, 0) / this.notas.length : 0;
  }
  avaliarFilme(nota) {
    if (!Number.isFinite(nota) || nota < 0 || nota > 10) throw new Error('A nota deve estar entre 0 e 10.');
    this.notas.push(nota);
  }
  consultarNota() { return this.notas.length ? this.notaAvaliacao.toFixed(1) : '—'; }
  verificarRecomendacao() { return this.notas.length > 0 && this.notaAvaliacao >= 7.5; }
}

/* ---------- Produto (combos) ---------- */
class Produto {
  constructor({ id, nome, preco, quantidadeEstoque }) {
    Object.assign(this, { id, nome, preco: Number(preco), quantidadeEstoque: Number(quantidadeEstoque) });
  }
  get disponibilidade() { return this.quantidadeEstoque > 0; }
  verDisponibilidade() { return this.disponibilidade ? `${this.quantidadeEstoque} em estoque` : 'Esgotado'; }
  // Só um Gerente pode cadastrar ou mudar preço (regra protegida também aqui, não só na tela)
  cadastrarProduto(autor) {
    if (!(autor instanceof Gerente)) throw new Error('Apenas o gerente pode cadastrar produtos.');
    if (!this.nome || this.nome.length < 2) throw new Error('Informe o nome do produto.');
    if (!(this.preco > 0)) throw new Error('O preço deve ser maior que zero.');
    if (!Number.isInteger(this.quantidadeEstoque) || this.quantidadeEstoque < 0) throw new Error('Estoque inválido.');
    cinema.produtos.push(this);
    cinema.salvar();
  }
  alterarPreco(valorNovo, autor) {
    if (!(autor instanceof Gerente)) throw new Error('Apenas o gerente pode alterar preços.');
    if (!(valorNovo > 0)) throw new Error('O preço deve ser maior que zero.');
    this.preco = valorNovo;
    cinema.salvar();
  }
}

/* ---------- Sessao ---------- */
class Sessao {
  constructor({ id, filmeId, data, horario, sala, ocupados = [] }) {
    Object.assign(this, { id, filmeId, data, horario, sala: Number(sala), ocupados: [...ocupados] });
  }
  get assentosDisponiveis() { return TOTAL_ASSENTOS - this.ocupados.length; }
  assentoLivre(id) { return !this.ocupados.includes(id); }
  // Lista todos os assentos da sala dizendo se estão livres: [{id:'A1', livre:true}, ...]
  consultarAssentos() {
    return FILEIRAS.flatMap(f =>
      Array.from({ length: POR_FILEIRA }, (_, i) => {
        const id = f + (i + 1);
        return { id, livre: this.assentoLivre(id) };
      }));
  }
  get inicio() { return new Date(`${this.data}T${this.horario}`); }
  // A sessão "encerra" quando início + duração do filme já passou
  get encerrada() {
    const duracao = cinema.filme(this.filmeId)?.duracao ?? 120;
    return this.inicio.getTime() + duracao * 60000 < Date.now();
  }
}

/* ---------- Usuario e subclasses (herança do diagrama) ---------- */
class Usuario {
  constructor({ nome, cpf, telefone, email, senha, perfil }) {
    Object.assign(this, { nome, cpf, telefone, email: email.trim().toLowerCase(), senha, perfil });
  }
  // "Fábrica": cria a subclasse certa a partir do perfil gravado
  static de(obj) {
    const Classe = { cliente: Cliente, gerente: Gerente, atendente: Atendente, suporte: Suporte }[obj.perfil];
    return new Classe(obj);
  }
}

class Cliente extends Usuario {
  consultarCombos() { return cinema.produtos; }
  consultarFilmes() { return cinema.filmes; }
  consultarAssentos(sessaoId) { return cinema.sessao(sessaoId)?.consultarAssentos() ?? []; }

  // Coloca os assentos escolhidos no carrinho
  comprarIngresso(sessaoId, assentos) {
    const sessao = cinema.sessao(sessaoId);
    if (!sessao) throw new Error('Selecione uma sessão.');
    if (assentos.length > 8) throw new Error('Máximo de 8 assentos por pedido.');
    if (assentos.some(a => !sessao.assentoLivre(a))) throw new Error('Um dos assentos já foi ocupado.');
    carrinho.sessaoId = sessaoId;
    carrinho.assentos = [...assentos];
  }
  // Coloca um combo (com quantidade) no carrinho
  comprarCombo(produtoId, qtd) {
    const produto = cinema.produto(produtoId);
    if (!produto) throw new Error('Produto não encontrado.');
    if (!Number.isInteger(qtd) || qtd < 0) throw new Error('Quantidade inválida.');
    if (qtd > produto.quantidadeEstoque) throw new Error(`Só há ${produto.quantidadeEstoque} unidade(s) de ${produto.nome}.`);
    if (qtd === 0) delete carrinho.combos[produtoId]; else carrinho.combos[produtoId] = qtd;
  }
  enviarFeedback(filmeId, nota, comentario) {
    const filme = cinema.filme(filmeId);
    if (!filme) throw new Error('Escolha um filme.');
    filme.avaliarFilme(nota);                       // valida e guarda a nota
    cinema.feedbacks.push({ id: cinema.novoId(), email: this.email, filmeId, nota, comentario: comentario.trim(), data: dataISO() });
    cinema.salvar();
  }
  solicitarSuporte(assunto, mensagem) {
    if (!assunto.trim() || !mensagem.trim()) throw new Error('Preencha assunto e mensagem.');
    cinema.solicitacoes.push({ id: cinema.novoId(), email: this.email, nome: this.nome, assunto: assunto.trim(), mensagem: mensagem.trim(), status: 'pendente', resposta: '' });
    cinema.salvar();
  }
}

class Funcionario extends Usuario {
  constructor(obj) {
    super(obj);
    this.permissoes = obj.permissoes ?? [];          // ex.: ['validar', 'suporte']
  }
  pode(permissao) { return this.permissoes.includes(permissao); }
  exigir(permissao) { if (!this.pode(permissao)) throw new Error('Você não tem permissão para esta ação.'); }

  validarSessao(pedido) {
    const sessao = cinema.sessao(pedido.sessaoId);
    if (!sessao) throw new Error('A sessão deste ingresso não existe mais.');
    if (sessao.encerrada) throw new Error('A sessão deste ingresso já foi encerrada.');
    return sessao;
  }
  validarPagamento(pedidoId) {
    this.exigir('validar');
    const pedido = cinema.pedidos.find(p => p.id === pedidoId);
    if (!pedido) throw new Error('Pedido não encontrado.');
    pedido.pagamentoValidado = true;
    cinema.salvar();
    return pedido;
  }
  validarIngresso(codigo) {
    this.exigir('validar');
    const pedido = cinema.pedidos.find(p => p.codigo === codigo.trim().toUpperCase());
    if (!pedido) throw new Error('Ingresso não encontrado.');
    if (!pedido.assentos.length) throw new Error('Este pedido não possui ingresso (apenas combos).');
    if (pedido.ingressoUsado) throw new Error('Este ingresso já foi utilizado.');
    if (!pedido.pagamentoValidado) throw new Error('Pagamento pendente: valide o pagamento primeiro.');
    this.validarSessao(pedido);
    pedido.ingressoUsado = true;
    cinema.salvar();
    return pedido;
  }
  // Responde uma solicitação (usado por Suporte e Atendente)
  responderSolicitacao(id, resposta) {
    this.exigir('suporte');
    const s = cinema.solicitacoes.find(x => x.id === id);
    if (!s) throw new Error('Solicitação não encontrada.');
    if (!resposta.trim()) throw new Error('Escreva uma resposta.');
    Object.assign(s, { resposta: resposta.trim(), status: 'atendida', atendidoPor: this.nome });
    cinema.salvar();
  }
}

class Suporte extends Funcionario {
  atenderSolicitacao(id, resposta) { this.responderSolicitacao(id, resposta); }
}
class Atendente extends Funcionario {
  fornecerSuporte(id, resposta) { this.responderSolicitacao(id, resposta); }
}

class Gerente extends Funcionario {
  pode() { return true; }                            // gerente tem todas as permissões

  static validarFilme(f) {
    if (!f.titulo || f.titulo.trim().length < 2) throw new Error('Informe o título do filme.');
    if (!f.genero || !f.genero.trim()) throw new Error('Informe o gênero.');
    if (!Number.isInteger(f.duracao) || f.duracao < 1 || f.duracao > 600) throw new Error('Duração deve ser de 1 a 600 minutos.');
  }
  cadastrarFilme(filme) {
    Gerente.validarFilme(filme);
    cinema.filmes.push(filme);
    cinema.salvar();
  }
  atualizarFilme(filme) {
    Gerente.validarFilme(filme);
    const i = cinema.filmes.findIndex(f => f.id === filme.id);
    if (i < 0) throw new Error('Filme não encontrado.');
    filme.notas = cinema.filmes[i].notas;            // mantém as avaliações já recebidas
    cinema.filmes[i] = filme;
    cinema.salvar();
  }
  // Remove o filme e suas sessões, mas só se não houver ingressos vendidos
  removerFilmes(id) {
    const vendidas = cinema.sessoes.some(s => s.filmeId === id && s.ocupados.length > 0);
    if (vendidas) throw new Error('Há ingressos vendidos para este filme; não é possível removê-lo.');
    cinema.filmes = cinema.filmes.filter(f => f.id !== id);
    cinema.sessoes = cinema.sessoes.filter(s => s.filmeId !== id);
    cinema.salvar();
  }
  // "Upsert": atualiza se já existe, cria se não existe
  atualizarSessao(sessao) {
    if (!cinema.filme(sessao.filmeId)) throw new Error('Escolha um filme válido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessao.data) || !/^\d{2}:\d{2}$/.test(sessao.horario)) throw new Error('Data ou horário inválido.');
    if (!Number.isInteger(sessao.sala) || sessao.sala < 1 || sessao.sala > 9) throw new Error('Sala deve ser de 1 a 9.');
    const i = cinema.sessoes.findIndex(s => s.id === sessao.id);
    if (i >= 0) { sessao.ocupados = cinema.sessoes[i].ocupados; cinema.sessoes[i] = sessao; }
    else cinema.sessoes.push(sessao);
    cinema.salvar();
  }
  definirPermissoes(email, permissoes) {
    const f = cinema.usuarios.find(u => u.email === email && u instanceof Funcionario && !(u instanceof Gerente));
    if (!f) throw new Error('Funcionário não encontrado.');
    f.permissoes = permissoes;
    cinema.salvar();
  }
}

/* ---------- Login ---------- */
class Login {
  static autenticar(email, senha) {
    const u = cinema.usuarios.find(x => x.email === email.trim().toLowerCase() && x.senha === senha);
    if (!u) throw new Error('E-mail ou senha incorretos.');
    try { sessionStorage.setItem(CHAVE_LOGIN, u.email); } catch { /* storage bloqueado */ }
    return u;
  }
  static encerrarSessao() { try { sessionStorage.removeItem(CHAVE_LOGIN); } catch { /* ignora */ } }
  static atual() {
    try { return cinema.usuarios.find(u => u.email === sessionStorage.getItem(CHAVE_LOGIN)) ?? null; }
    catch { return null; }
  }
}

/* ---------- PaginaInicial ---------- */
class PaginaInicial {
  static consultarFilmes() { return cinema.filmes; }
  static consultarCombos() { return cinema.produtos; }
  static consultarSessoes() {
    return cinema.sessoes.filter(s => !s.encerrada).sort((a, b) => a.inicio - b.inicio);
  }
  // Controles de tamanho de fonte e alto contraste, com preferência salva
  static acessibilidade() {
    let prefs = { escala: 100, contraste: false };
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(CHAVE_A11Y)) }; } catch { /* usa padrão */ }
    const aplicar = () => {
      document.documentElement.style.fontSize = prefs.escala + '%';
      document.body.classList.toggle('alto-contraste', prefs.contraste);
      document.documentElement.classList.toggle('alto-contraste', prefs.contraste);
      $('#btn-contraste').setAttribute('aria-pressed', String(prefs.contraste));
      try { localStorage.setItem(CHAVE_A11Y, JSON.stringify(prefs)); } catch { /* ignora */ }
    };
    $('#btn-mais').addEventListener('click', () => { prefs.escala = Math.min(150, prefs.escala + 10); aplicar(); });
    $('#btn-menos').addEventListener('click', () => { prefs.escala = Math.max(90, prefs.escala - 10); aplicar(); });
    $('#btn-contraste').addEventListener('click', () => { prefs.contraste = !prefs.contraste; aplicar(); });
    aplicar();
  }
}

/* ---------- ConfirmarPagamento ---------- */
class ConfirmarPagamento {
  constructor(pedido) { this.pedido = pedido; }

  gerarMetodoPagamento(metodo) {
    if (!['pix', 'cartao', 'dinheiro'].includes(metodo)) throw new Error('Escolha uma forma de pagamento.');
    this.pedido.metodo = metodo;
    this.pedido.pix = metodo === 'pix' ? 'PIX-' + gerarCodigo() : null;
    return this.pedido.pix;
  }
  // Lista de conferências que precisam estar OK antes de confirmar
  checklistPagamento() {
    const p = this.pedido;
    const sessao = cinema.sessao(p.sessaoId);
    return [
      { texto: 'Itens do pedido conferidos', ok: p.assentos.length > 0 || p.itens.length > 0 },
      { texto: `Total de ${moeda(p.total)} conferido`, ok: p.total > 0 },
      { texto: 'Forma de pagamento escolhida', ok: Boolean(p.metodo) },
      { texto: 'Assentos ainda disponíveis', ok: p.assentos.length === 0 || (Boolean(sessao) && p.assentos.every(a => sessao.assentoLivre(a))) },
      { texto: 'Combos disponíveis em estoque', ok: p.itens.every(i => (cinema.produto(i.produtoId)?.quantidadeEstoque ?? 0) >= i.qtd) }
    ];
  }
  confirmarPagamento() {
    if (this.checklistPagamento().some(c => !c.ok)) throw new Error('Há itens pendentes na conferência do pagamento.');
    const p = this.pedido;
    // Reserva os assentos e baixa o estoque
    cinema.sessao(p.sessaoId)?.ocupados.push(...p.assentos);
    p.itens.forEach(i => { cinema.produto(i.produtoId).quantidadeEstoque -= i.qtd; });
    Object.assign(p, { id: cinema.novoId(), codigo: gerarCodigo(), status: 'pago', pagamentoValidado: p.metodo !== 'dinheiro', ingressoUsado: false, criadoEm: new Date().toISOString() });
    cinema.pedidos.push(p);
    cinema.salvar();
    return p;
  }
  pagamentoConcluido() { return this.pedido.status === 'pago'; }
  recebimentoDosItens() {
    const p = this.pedido;
    const linhas = [];
    if (p.assentos.length) linhas.push(`Ingresso: ${p.filmeTitulo} — assentos ${p.assentos.join(', ')}. Apresente o código na entrada.`);
    if (p.itens.length) linhas.push(`Combos para retirar na bomboniere: ${p.itens.map(i => `${i.qtd}× ${i.nome}`).join(', ')}.`);
    if (p.metodo === 'dinheiro') linhas.push('Pagamento em dinheiro: pague na bilheteria para liberar o ingresso.');
    return linhas;
  }
}

/* =====================================================================
   3. "BANCO DE DADOS" NO NAVEGADOR (localStorage)
   ===================================================================== */
function dadosIniciais() {
  return {
    filmes: [
      { id: 1, titulo: 'Horizonte Perdido', genero: 'Aventura', duracao: 128, notas: [9, 8] },
      { id: 2, titulo: 'Risos no Escuro', genero: 'Comédia', duracao: 102, notas: [7, 6.5] },
      { id: 3, titulo: 'Eco do Amanhã', genero: 'Ficção científica', duracao: 141, notas: [8.5] }
    ],
    sessoes: [
      { id: 4, filmeId: 1, data: dataISO(0), horario: '20:00', sala: 1, ocupados: ['A1', 'A2'] },
      { id: 5, filmeId: 2, data: dataISO(0), horario: '21:30', sala: 2, ocupados: [] },
      { id: 6, filmeId: 1, data: dataISO(1), horario: '16:00', sala: 1, ocupados: [] },
      { id: 7, filmeId: 3, data: dataISO(1), horario: '19:30', sala: 3, ocupados: ['C3'] }
    ],
    produtos: [
      { id: 8, nome: 'Pipoca grande', preco: 22.9, quantidadeEstoque: 50 },
      { id: 9, nome: 'Refrigerante 500 ml', preco: 9.9, quantidadeEstoque: 80 },
      { id: 10, nome: 'Combo casal (pipoca + 2 refrigerantes)', preco: 39.9, quantidadeEstoque: 30 },
      { id: 11, nome: 'Chocolate', preco: 7.5, quantidadeEstoque: 0 }
    ],
    // ATENÇÃO: senhas em texto puro só servem para esta demonstração.
    // Num sistema real a autenticação fica no servidor, com hash (bcrypt/argon2).
    usuarios: [
      { nome: 'Cliente', cpf: '52998224725', telefone: '91999990001', email: 'cliente@cine.com', senha: '123456', perfil: 'cliente' },
      { nome: 'Atendente', cpf: '11144477735', telefone: '91999990002', email: 'atendente@cine.com', senha: '123456', perfil: 'atendente', permissoes: ['validar', 'suporte'] },
      { nome: 'Suporte', cpf: '12345678909', telefone: '91999990003', email: 'suporte@cine.com', senha: '123456', perfil: 'suporte', permissoes: ['suporte'] },
      { nome: 'Gerente', cpf: '93541134780', telefone: '91999990004', email: 'gerente@cine.com', senha: '123456', perfil: 'gerente' }
    ],
    pedidos: [], solicitacoes: [], feedbacks: [], proximoId: 100
  };
}

class Cinema {
  constructor() {
    let dados = null;
    try { dados = JSON.parse(localStorage.getItem(CHAVE_DB)); } catch { /* dados corrompidos: recomeça */ }
    dados = dados ?? dadosIniciais();
    // Migração: dados salvos antes usavam nomes fictícios; troca pelo nome do perfil
    const ANTIGOS = { 'Ana Cliente': 'Cliente', 'Bruno Atendente': 'Atendente', 'Carla Suporte': 'Suporte', 'Daniel Gerente': 'Gerente' };
    const novoNome = n => ANTIGOS[n] ?? n;
    dados.usuarios.forEach(u => { u.nome = novoNome(u.nome); });
    dados.solicitacoes.forEach(s => { s.nome = novoNome(s.nome); if (s.atendidoPor) s.atendidoPor = novoNome(s.atendidoPor); });
    this.filmes = dados.filmes.map(o => new Filme(o));
    this.sessoes = dados.sessoes.map(o => new Sessao(o));
    this.produtos = dados.produtos.map(o => new Produto(o));
    this.usuarios = dados.usuarios.map(o => Usuario.de(o));
    this.pedidos = dados.pedidos;
    this.solicitacoes = dados.solicitacoes;
    this.feedbacks = dados.feedbacks;
    this.proximoId = dados.proximoId;
  }
  salvar() {
    try {
      localStorage.setItem(CHAVE_DB, JSON.stringify({
        filmes: this.filmes, sessoes: this.sessoes, produtos: this.produtos, usuarios: this.usuarios,
        pedidos: this.pedidos, solicitacoes: this.solicitacoes, feedbacks: this.feedbacks, proximoId: this.proximoId
      }));
    } catch { avisar('Não foi possível salvar os dados neste navegador.', 'erro'); }
  }
  novoId() { return this.proximoId++; }
  filme(id) { return this.filmes.find(f => f.id === id); }
  sessao(id) { return this.sessoes.find(s => s.id === id); }
  produto(id) { return this.produtos.find(p => p.id === id); }
}

/* =====================================================================
   4. ESTADO DA APLICAÇÃO
   ===================================================================== */
const cinema = new Cinema();
let usuario = Login.atual();                         // quem está logado (ou null)
const carrinho = { sessaoId: null, assentos: [], combos: {} };
let pagamento = null;                                // ConfirmarPagamento em andamento

const limparCarrinho = () => { carrinho.sessaoId = null; carrinho.assentos = []; carrinho.combos = {}; };

/* =====================================================================
   5. ROTAS (navegação por #hash) E CONTROLE DE ACESSO
   ===================================================================== */
const ROTAS = {
  home: () => true,
  login: u => !u,
  compra: u => u instanceof Cliente,
  suporte: u => u instanceof Cliente || (u instanceof Funcionario && u.pode('suporte')),
  balcao: u => u instanceof Funcionario && u.pode('validar'),
  gerencia: u => u instanceof Gerente
};
const ROTULOS = { home: 'Início', compra: 'Comprar', suporte: 'Suporte', balcao: 'Balcão', gerencia: 'Gerência', login: 'Entrar' };

function mostrarRota(focar = true) {
  let rota = location.hash.replace(/^#\/?/, '');
  if (!Object.hasOwn(ROTAS, rota)) rota = 'home';              // rota desconhecida -> início
  if (!ROTAS[rota](usuario)) {                                 // sem permissão -> redireciona
    rota = usuario ? 'home' : 'login';
    history.replaceState(null, '', '#/' + rota);
  }
  $$('.view').forEach(v => { v.hidden = v.dataset.rota !== rota; });
  renderMenu(rota);
  renderConta();
  RENDERIZADORES[rota]();
  document.title = `${ROTULOS[rota]} – VSDE-Cine`;
  if (focar) $('#conteudo').focus({ preventScroll: true });
}

function renderMenu(rotaAtiva) {
  $('#menu').replaceChildren(...Object.keys(ROTULOS)
    .filter(r => ROTAS[r](usuario))
    .map(r => el('a', { href: '#/' + r, 'aria-current': r === rotaAtiva ? 'page' : false }, ROTULOS[r])));
}

function renderConta() {
  const caixa = $('#conta');
  if (!usuario) { caixa.replaceChildren(); return; }
  caixa.replaceChildren(
    el('span', {}, `Logado como: ${rotuloPerfil(usuario)}`),
    el('button', { type: 'button', onclick: sair }, 'Sair'));
}

function sair() {
  Login.encerrarSessao();
  usuario = null; pagamento = null; limparCarrinho();
  location.hash = '#/home';
  mostrarRota(false);
  avisar('Você saiu da conta.');
}

/* =====================================================================
   6. RENDERIZADORES (cada um desenha uma "página")
   ===================================================================== */
const RENDERIZADORES = {
  home: renderHome, login: () => {}, compra: renderCompra,
  suporte: renderSuporte, balcao: renderBalcao, gerencia: renderGerencia
};

function seloNota(filme) {
  return [
    el('span', { class: 'selo destaque' }, `★ ${filme.consultarNota()}`),
    filme.verificarRecomendacao() ? el('span', { class: 'selo ok' }, 'Recomendado') : null
  ];
}

/* ---------- Início ---------- */
function renderHome() {
  $('#lista-filmes').replaceChildren(...PaginaInicial.consultarFilmes().map(f =>
    el('article', { class: 'item' },
      el('h3', {}, f.titulo),
      el('p', {}, `${f.genero} • ${f.duracao} min`),
      el('p', {}, seloNota(f)))));
  if (!cinema.filmes.length) $('#lista-filmes').replaceChildren(el('p', { class: 'vazio' }, 'Nenhum filme em cartaz.'));

  const sessoes = PaginaInicial.consultarSessoes();
  $('#lista-sessoes').replaceChildren(tabela(
    ['Filme', 'Data', 'Horário', 'Sala', 'Assentos livres', ''],
    sessoes.map(s => [
      cinema.filme(s.filmeId)?.titulo ?? '—', formatarData(s.data), s.horario, String(s.sala), String(s.assentosDisponiveis),
      el('button', { class: 'btn pequeno', type: 'button', onclick: () => comprarDaSessao(s.id) }, 'Comprar')
    ]), 'Nenhuma sessão disponível.'));

  $('#lista-combos').replaceChildren(...PaginaInicial.consultarCombos().map(p =>
    el('article', { class: 'item' },
      el('h3', {}, p.nome),
      el('p', { class: 'preco' }, moeda(p.preco)),
      el('p', {}, el('span', { class: 'selo ' + (p.disponibilidade ? 'ok' : 'erro') }, p.verDisponibilidade())))));
}

function comprarDaSessao(sessaoId) {
  if (!usuario) { avisar('Entre na sua conta para comprar.', 'erro'); location.hash = '#/login'; return; }
  if (!(usuario instanceof Cliente)) { avisar('Apenas clientes podem comprar ingressos.', 'erro'); return; }
  limparCarrinho();
  carrinho.sessaoId = sessaoId;
  location.hash = '#/compra';
}

/* ---------- Compra ---------- */
function itensDoCarrinho() {
  return Object.entries(carrinho.combos).map(([id, qtd]) => {
    const p = cinema.produto(Number(id));
    return { produtoId: p.id, nome: p.nome, preco: p.preco, qtd };
  });
}
const totalDoCarrinho = () =>
  carrinho.assentos.length * PRECO_INGRESSO + itensDoCarrinho().reduce((s, i) => s + i.preco * i.qtd, 0);

function renderCompra() {
  $('#txt-preco-ingresso').textContent = moeda(PRECO_INGRESSO);

  // Lista de sessões abertas no <select>
  const sel = $('#sel-sessao');
  sel.replaceChildren(
    el('option', { value: '' }, 'Somente combos (sem ingresso)'),
    ...PaginaInicial.consultarSessoes().map(s => el('option',
      { value: s.id, selected: s.id === carrinho.sessaoId },
      `${cinema.filme(s.filmeId)?.titulo ?? '?'} — ${formatarData(s.data)} ${s.horario} — Sala ${s.sala}`)));

  // Combos com campo de quantidade
  $('#combos-compra').replaceChildren(...usuario.consultarCombos().map(p =>
    el('div', { class: 'combo-linha' },
      el('div', {}, el('strong', {}, p.nome), ' — ', moeda(p.preco), ' ', el('span', { class: 'selo ' + (p.disponibilidade ? 'ok' : 'erro') }, p.verDisponibilidade())),
      el('label', { for: 'qtd-' + p.id, style: 'margin:0' }, 'Qtd.'),
      el('input', {
        id: 'qtd-' + p.id, type: 'number', min: 0, max: p.quantidadeEstoque, step: 1,
        value: carrinho.combos[p.id] ?? 0, disabled: !p.disponibilidade,
        onchange: e => {
          const qtd = Number(e.target.value);
          try { usuario.comprarCombo(p.id, qtd); } catch (erro) { avisar(erro.message, 'erro'); e.target.value = carrinho.combos[p.id] ?? 0; }
          limparPagamento(); renderResumo();
        }
      }))));

  renderAssentos();
  renderResumo();
  renderMeusPedidos();
}

function renderAssentos() {
  const caixa = $('#assentos');
  if (!carrinho.sessaoId) { caixa.replaceChildren(el('p', { class: 'vazio' }, 'Escolha uma sessão para ver os assentos.')); return; }
  // A TELA fica embaixo, então a fileira A (a mais perto da tela) vai por último
  const todos = usuario.consultarAssentos(carrinho.sessaoId);
  const fileiras = [];
  for (let i = 0; i < todos.length; i += POR_FILEIRA) fileiras.unshift(todos.slice(i, i + POR_FILEIRA));
  caixa.replaceChildren(...fileiras.flat().map(a => {
    const marcado = carrinho.assentos.includes(a.id);
    return el('button', {
      type: 'button', class: 'assento', 'aria-pressed': String(marcado),
      'aria-label': `Assento ${a.id}${a.livre ? '' : ', ocupado'}`, disabled: !a.livre,
      onclick: tentar(() => {
        const novos = marcado ? carrinho.assentos.filter(x => x !== a.id) : [...carrinho.assentos, a.id];
        usuario.comprarIngresso(carrinho.sessaoId, novos);
        limparPagamento(); renderAssentos(); renderResumo();
      })
    }, a.id);
  }));
}

function renderResumo() {
  const itens = itensDoCarrinho();
  $('#resumo').replaceChildren(
    el('p', {}, `Assentos: ${carrinho.assentos.length ? carrinho.assentos.join(', ') : 'nenhum'} (${moeda(carrinho.assentos.length * PRECO_INGRESSO)})`),
    ...itens.map(i => el('p', {}, `${i.qtd}× ${i.nome} (${moeda(i.preco * i.qtd)})`)),
    el('p', {}, 'Total: ', el('span', { class: 'total' }, moeda(totalDoCarrinho()))));
}

function limparPagamento() {
  pagamento = null;
  $('#checklist').replaceChildren();
  $('#btn-confirmar').hidden = true;
}

function montarPedido() {
  const itens = itensDoCarrinho();
  if (!carrinho.assentos.length && !itens.length) throw new Error('Escolha ao menos um assento ou um combo.');
  return {
    clienteEmail: usuario.email, sessaoId: carrinho.sessaoId, assentos: [...carrinho.assentos], itens,
    filmeTitulo: carrinho.sessaoId ? cinema.filme(cinema.sessao(carrinho.sessaoId).filmeId)?.titulo ?? '' : '',
    total: totalDoCarrinho()
  };
}

function revisarPagamento() {
  const conf = new ConfirmarPagamento(montarPedido());
  const pix = conf.gerarMetodoPagamento($('#metodo').value);
  pagamento = conf;
  const lista = conf.checklistPagamento();
  $('#checklist').replaceChildren(
    el('ul', { class: 'checklist' }, lista.map(c => el('li', { class: c.ok ? 'ok' : 'falha' }, c.texto))),
    pix ? el('p', {}, 'Código Pix (simulado): ', el('span', { class: 'codigo' }, pix)) : null);
  $('#btn-confirmar').hidden = lista.some(c => !c.ok);
}

function confirmarCompra() {
  if (!pagamento) throw new Error('Revise o pagamento antes de confirmar.');
  const conf = pagamento;
  conf.confirmarPagamento();
  const concluido = conf.pagamentoConcluido();
  limparCarrinho(); limparPagamento();
  renderCompra();
  if (concluido) {
    $('#recibo').replaceChildren(el('div', { class: 'recibo' },
      el('h3', {}, 'Pagamento concluído! ✅'),
      conf.pedido.assentos.length ? el('p', {}, 'Código do ingresso: ', el('span', { class: 'codigo' }, conf.pedido.codigo)) : null,
      ...conf.recebimentoDosItens().map(l => el('p', {}, l))));
    avisar('Compra realizada com sucesso!');
  }
}

function statusDoPedido(p) {
  if (p.ingressoUsado) return 'Ingresso utilizado';
  return p.pagamentoValidado ? 'Pago' : 'Aguardando pagamento na bilheteria';
}

function renderMeusPedidos() {
  const meus = cinema.pedidos.filter(p => p.clienteEmail === usuario.email).reverse();
  $('#meus-pedidos').replaceChildren(tabela(
    ['Código', 'Filme', 'Assentos', 'Combos', 'Total', 'Status'],
    meus.map(p => [p.codigo, p.filmeTitulo || '—', p.assentos.join(', ') || '—',
      p.itens.map(i => `${i.qtd}× ${i.nome}`).join('; ') || '—', moeda(p.total), statusDoPedido(p)]),
    'Você ainda não fez pedidos.'));
}

/* ---------- Suporte e feedback ---------- */
function renderSuporte() {
  const ehCliente = usuario instanceof Cliente;
  $('#bloco-cliente').hidden = !ehCliente;
  if (ehCliente) {
    $('#fb-filme').replaceChildren(el('option', { value: '' }, 'Selecione…'), ...cinema.filmes.map(f => el('option', { value: f.id }, f.titulo)));
  }
  $('#titulo-solicitacoes').textContent = ehCliente ? 'Minhas solicitações' : 'Solicitações dos clientes';
  const lista = ehCliente ? cinema.solicitacoes.filter(s => s.email === usuario.email) : cinema.solicitacoes;
  $('#lista-solicitacoes').replaceChildren(...(lista.length ? [...lista].reverse().map(cartaoSolicitacao) : [el('p', { class: 'vazio' }, 'Nenhuma solicitação.')]));
}

function cartaoSolicitacao(s) {
  const pendente = s.status === 'pendente';
  const caixa = el('article', { class: 'cartao' },
    el('h3', {}, s.assunto, ' ', el('span', { class: 'selo ' + (pendente ? 'destaque' : 'ok') }, pendente ? 'Pendente' : 'Atendida')),
    el('p', { class: 'dica' }, `De: ${s.nome}`),
    el('p', {}, s.mensagem),
    s.resposta ? el('p', {}, el('strong', {}, `Resposta (${s.atendidoPor}): `), s.resposta) : null);
  if (pendente && usuario instanceof Funcionario) {
    const campo = el('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Resposta' });
    caixa.append(campo, el('button', {
      class: 'btn pequeno', type: 'button', style: 'margin-top:.6rem',
      onclick: tentar(() => {
        // Cada subclasse usa o método do diagrama: Suporte.atenderSolicitacao / Atendente.fornecerSuporte
        if (usuario instanceof Suporte) usuario.atenderSolicitacao(s.id, campo.value);
        else if (usuario instanceof Atendente) usuario.fornecerSuporte(s.id, campo.value);
        else usuario.responderSolicitacao(s.id, campo.value);
        avisar('Solicitação respondida.'); renderSuporte();
      })
    }, 'Responder'));
  }
  return caixa;
}

/* ---------- Balcão ---------- */
function renderBalcao() {
  const pendentes = cinema.pedidos.filter(p => !p.pagamentoValidado);
  $('#lista-pagamentos').replaceChildren(tabela(
    ['Código', 'Cliente', 'Total', 'Ação'],
    pendentes.map(p => [p.codigo, p.clienteEmail, moeda(p.total),
      el('button', { class: 'btn pequeno', type: 'button', onclick: tentar(() => { usuario.validarPagamento(p.id); avisar('Pagamento validado.'); renderBalcao(); }) }, 'Validar pagamento')]),
    'Nenhum pagamento pendente.'));
}

/* ---------- Gerência ---------- */
function renderGerencia() {
  // Filmes
  $('#gerencia-filmes').replaceChildren(tabela(['Título', 'Gênero', 'Duração', 'Nota', ''],
    cinema.filmes.map(f => [f.titulo, f.genero, `${f.duracao} min`, f.consultarNota(),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn pequeno secundario', type: 'button', onclick: () => editarFilme(f) }, 'Editar'),
        el('button', { class: 'btn pequeno perigo', type: 'button', onclick: tentar(() => {
          if (!confirm(`Remover "${f.titulo}" e suas sessões?`)) return;
          usuario.removerFilmes(f.id); avisar('Filme removido.'); renderGerencia();
        }) }, 'Remover'))]), 'Nenhum filme cadastrado.'));

  $('#sessao-filme').replaceChildren(...cinema.filmes.map(f => el('option', { value: f.id }, f.titulo)));

  // Sessões
  $('#gerencia-sessoes').replaceChildren(tabela(['Filme', 'Data', 'Horário', 'Sala', 'Vendidos', ''],
    [...cinema.sessoes].sort((a, b) => a.inicio - b.inicio).map(s => [
      cinema.filme(s.filmeId)?.titulo ?? '—', formatarData(s.data), s.horario, String(s.sala), `${s.ocupados.length}/${TOTAL_ASSENTOS}`,
      el('button', { class: 'btn pequeno secundario', type: 'button', onclick: () => editarSessao(s) }, 'Editar')]), 'Nenhuma sessão.'));

  // Produtos, com alteração de preço
  $('#gerencia-produtos').replaceChildren(tabela(['Produto', 'Preço atual', 'Estoque', 'Novo preço'],
    cinema.produtos.map(p => {
      const campo = el('input', { type: 'number', min: '0.01', step: '0.01', 'aria-label': `Novo preço de ${p.nome}` });
      return [p.nome, moeda(p.preco), String(p.quantidadeEstoque),
        el('div', { class: 'acoes' }, campo,
          el('button', { class: 'btn pequeno', type: 'button', onclick: tentar(() => {
            p.alterarPreco(Number(campo.value), usuario); avisar('Preço atualizado.'); renderGerencia();
          }) }, 'Alterar'))];
    }), 'Nenhum produto.'));

  // Permissões
  const funcionarios = cinema.usuarios.filter(u => u instanceof Funcionario && !(u instanceof Gerente));
  $('#gerencia-permissoes').replaceChildren(tabela(['Funcionário', 'Perfil', 'Validar ingressos', 'Atender suporte'],
    funcionarios.map(f => [f.nome, f.perfil,
      caixaPermissao(f, 'validar', 'Validar ingressos'), caixaPermissao(f, 'suporte', 'Atender suporte')]), 'Nenhum funcionário.'));

  // Feedbacks
  $('#gerencia-feedbacks').replaceChildren(tabela(['Data', 'Filme', 'Nota', 'Comentário'],
    [...cinema.feedbacks].reverse().map(fb => [formatarData(fb.data), cinema.filme(fb.filmeId)?.titulo ?? '—', String(fb.nota), fb.comentario || '—']),
    'Nenhum feedback ainda.'));
}

function caixaPermissao(funcionario, permissao, rotulo) {
  return el('input', {
    type: 'checkbox', 'aria-label': `${rotulo} – ${funcionario.nome}`, checked: funcionario.pode(permissao),
    onchange: tentar(e => {
      const novas = new Set(funcionario.permissoes);
      if (e.target.checked) novas.add(permissao); else novas.delete(permissao);
      usuario.definirPermissoes(funcionario.email, [...novas]);
      avisar('Permissões atualizadas.');
    })
  });
}

function editarFilme(f) {
  $('#filme-id').value = f.id;
  $('#filme-titulo').value = f.titulo;
  $('#filme-genero').value = f.genero;
  $('#filme-duracao').value = f.duracao;
  $('#titulo-form-filme').textContent = 'Atualizar filme';
  $('#filme-titulo').focus();
}
function editarSessao(s) {
  $('#sessao-id').value = s.id;
  $('#sessao-filme').value = s.filmeId;
  $('#sessao-data').value = s.data;
  $('#sessao-horario').value = s.horario;
  $('#sessao-sala').value = s.sala;
  $('#titulo-form-sessao').textContent = 'Atualizar sessão';
  $('#sessao-data').focus();
}

/* =====================================================================
   7. EVENTOS DOS FORMULÁRIOS
   ===================================================================== */
function ligarEventos() {
  // Login
  aoEnviar('#form-login', form => {
    usuario = Login.autenticar($('#login-email').value, $('#login-senha').value);
    form.reset();
    avisar(`Você entrou como ${rotuloPerfil(usuario)}.`);
    location.hash = '#/home';
    mostrarRota(false);
  });

  // Cadastro de cliente
  aoEnviar('#form-cadastro', form => {
    const dados = {
      nome: $('#cad-nome').value.trim(), cpf: $('#cad-cpf').value.replace(/\D/g, ''),
      telefone: $('#cad-tel').value.replace(/\D/g, ''), email: $('#cad-email').value.trim().toLowerCase(),
      senha: $('#cad-senha').value, perfil: 'cliente'
    };
    if (dados.cpf.length !== 11) throw new Error('CPF incompleto: digite os 11 números.');
    if (dados.telefone.length < 10 || dados.telefone.length > 11) throw new Error('Telefone inválido (use DDD + número).');
    if (cinema.usuarios.some(u => u.email === dados.email)) throw new Error('Este e-mail já está cadastrado.');
    if (cinema.usuarios.some(u => u.cpf === dados.cpf)) throw new Error('Este CPF já está cadastrado.');
    cinema.usuarios.push(new Cliente(dados));
    cinema.salvar();
    form.reset();
    // Deixa o login pronto: e-mail já preenchido e cursor na senha
    $('#login-email').value = dados.email;
    $('#login-senha').value = '';
    $('#login-senha').focus();
    avisar('Conta criada! Agora é só digitar sua senha e entrar.');
  });

  // Máscaras: formatam CPF e telefone enquanto a pessoa digita
  $('#cad-cpf').addEventListener('input', e => { e.target.value = formatarCpf(e.target.value); });
  $('#cad-tel').addEventListener('input', e => { e.target.value = formatarTelefone(e.target.value); });

  // Nota: só números, no máximo 2 dígitos e nunca acima de 10
  $('#fb-nota').addEventListener('input', e => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 2);
    if (v !== '' && Number(v) > 10) v = '10';
    else if (v.length === 2 && v[0] === '0') v = v[1];           // "07" vira "7"
    e.target.value = v;
  });

  // Compra
  $('#sel-sessao').addEventListener('change', e => {
    carrinho.sessaoId = Number(e.target.value) || null;
    carrinho.assentos = [];
    limparPagamento(); $('#recibo').replaceChildren(); renderAssentos(); renderResumo();
  });
  $('#btn-revisar').addEventListener('click', tentar(revisarPagamento));
  $('#btn-confirmar').addEventListener('click', tentar(confirmarCompra));
  $('#metodo').addEventListener('change', limparPagamento);

  // Suporte e feedback
  aoEnviar('#form-suporte', form => {
    usuario.solicitarSuporte($('#sup-assunto').value, $('#sup-msg').value);
    form.reset(); avisar('Solicitação enviada.'); renderSuporte();
  });
  aoEnviar('#form-feedback', form => {
    usuario.enviarFeedback(Number($('#fb-filme').value), Number($('#fb-nota').value), $('#fb-comentario').value);
    form.reset(); avisar('Obrigado pelo seu feedback!'); renderSuporte();
  });

  // Balcão
  aoEnviar('#form-ingresso', form => {
    const saida = $('#resultado-ingresso');
    saida.replaceChildren();
    const p = usuario.validarIngresso($('#cod-ingresso').value);
    saida.replaceChildren(el('div', { class: 'resultado' },
      el('strong', {}, 'Ingresso válido ✅'),
      el('p', {}, `${p.filmeTitulo} — assentos ${p.assentos.join(', ')}`)));
    form.reset();
  });

  // Gerência
  aoEnviar('#form-filme', form => {
    const id = Number($('#filme-id').value);
    const filme = new Filme({ id: id || cinema.novoId(), titulo: $('#filme-titulo').value.trim(), genero: $('#filme-genero').value.trim(), duracao: Number($('#filme-duracao').value) });
    if (id) usuario.atualizarFilme(filme); else usuario.cadastrarFilme(filme);
    form.reset(); $('#filme-id').value = ''; $('#titulo-form-filme').textContent = 'Cadastrar filme';
    avisar('Filme salvo.'); renderGerencia();
  });
  aoEnviar('#form-sessao', form => {
    const id = Number($('#sessao-id').value);
    const sessao = new Sessao({ id: id || cinema.novoId(), filmeId: Number($('#sessao-filme').value), data: $('#sessao-data').value, horario: $('#sessao-horario').value, sala: Number($('#sessao-sala').value) });
    usuario.atualizarSessao(sessao);
    form.reset(); $('#sessao-id').value = ''; $('#titulo-form-sessao').textContent = 'Cadastrar / atualizar sessão';
    avisar('Sessão salva.'); renderGerencia();
  });
  aoEnviar('#form-produto', form => {
    new Produto({ id: cinema.novoId(), nome: $('#prod-nome').value.trim(), preco: Number($('#prod-preco').value), quantidadeEstoque: Number($('#prod-estoque').value) })
      .cadastrarProduto(usuario);
    form.reset(); avisar('Produto cadastrado.'); renderGerencia();
  });
  // Os botões "Limpar" voltam o título dos formulários ao normal
  $('#cancelar-filme').addEventListener('click', () => { $('#filme-id').value = ''; $('#titulo-form-filme').textContent = 'Cadastrar filme'; });
  $('#cancelar-sessao').addEventListener('click', () => { $('#sessao-id').value = ''; $('#titulo-form-sessao').textContent = 'Cadastrar / atualizar sessão'; });
}

/* =====================================================================
   8. INICIALIZAÇÃO
   ===================================================================== */
function iniciar() {
  PaginaInicial.acessibilidade();
  ligarEventos();
  window.addEventListener('hashchange', () => mostrarRota(true));
  if (!location.hash) history.replaceState(null, '', '#/home');
  mostrarRota(false);
}
iniciar();
