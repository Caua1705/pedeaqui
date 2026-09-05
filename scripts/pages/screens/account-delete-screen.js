// ============================================================================
//  Tela do Perfil: EXCLUIR CONTA (LGPD, Art. 18, VI). Contrato mount(ctx) —
//  skill §9. Corpo sem efeito; o estado da tela mora aqui dentro.
//
//  POR QUE ELA EXISTE. `DELETE /customers/me` está no contrato há tempo e o
//  front nunca a chamou: o botão "Excluir conta" existia no markup SEM
//  `data-act-*`. Enquanto isso a política de privacidade e os termos mandavam
//  a pessoa pedir por e-mail — o direito cumprido à mão, com prazo de resposta
//  humano, quando a rota que faz sozinho já estava publicada.
//
//  A REGRA QUE MANDA NESTA TELA: quando ela terminar, não há desfazer. Então
//  tudo o que se perde está ESCRITO na tela, com número, antes do botão — e o
//  número do cashback vem da rede, não de memória.
// ============================================================================
(function () {
  let $, esc, fmt, act, releaseFocusFrom, logAppError;
  let app, shell;

  // Estado DA TELA. Nada disto sai por acessor: se o page precisasse ler,
  // o corte estaria errado (§9).
  let carregando = false;
  let enviando = false;
  let pedindoCodigo = false;
  // A leitura de `password_set` que a tela está exibindo. Ela decide QUAL
  // campo o corpo leva, e a decisão é da CONTA, não do app — ver `excluir()`.
  let temSenha = true;

  function corpo() { return $('profDeleteBody'); }

  function setErro(mensagem) {
    const el = $('profDeleteError');
    if (!el) return;
    el.textContent = mensagem || '';
    el.classList.toggle('show', Boolean(mensagem));
  }

  function setAviso(mensagem) {
    const el = $('profDeleteNotice');
    if (!el) return;
    el.textContent = mensagem || '';
    el.classList.toggle('show', Boolean(mensagem));
  }

  /**
   * O SALDO QUE SE PERDE. Aqui é o `balance` da RAIZ, e isso é o contrário da
   * regra normal deste app — que é ler `by_restaurant[]` filtrado pelo slug,
   * porque a soma não é gastável em lugar nenhum (§10).
   *
   * A exceção é o assunto desta tela: a exclusão não perde "o saldo desta
   * loja", perde a CONTA inteira, em todos os restaurantes. O próprio
   * contrato manda mostrar o `balance` aqui, com essas palavras. Quem vier
   * "consertar" isto para `by_restaurant` estará escondendo dinheiro que a
   * pessoa está prestes a perder.
   *
   * `by_restaurant[]` continua servindo, e para nomear as lojas no aviso.
   */
  function linhaDeCashback(saldo, falhou) {
    // SALDO QUE NÃO CARREGOU NÃO É SALDO ZERO. Dizer "você não tem saldo a
    // perder" quando a requisição caiu seria a única mentira possível nesta
    // tela, e ela sairia exatamente antes do botão sem volta.
    if (falhou) {
      return 'Não foi possível conferir seu saldo de cashback agora. Se houver saldo, ele é perdido do mesmo jeito.';
    }
    const total = Number(saldo?.balance);
    if (!Number.isFinite(total) || total <= 0) {
      return 'Você não tem saldo de cashback a perder.';
    }
    const lojas = (Array.isArray(saldo?.by_restaurant) ? saldo.by_restaurant : [])
      .filter(item => Number(item?.balance) > 0)
      .map(item => String(item?.restaurant_name || '').trim())
      .filter(Boolean);
    const onde = lojas.length ? ` (${lojas.join(', ')})` : '';
    return `Você perde ${fmt(total)} de cashback${onde}. O recadastro nasce com uma conta nova, e não há caminho de volta para esse saldo.`;
  }

  function htmlDoCorpo({ saldo, saldoFalhou, email }) {
    // As três consequências, na ordem em que doem: o que FICA, o que se PERDE,
    // e que não tem volta. Escritas na tela, não num link para os termos.
    const consequencias = [
      'Seus pedidos continuam com o restaurante, sem nenhum dado seu dentro. É assim que a nota e o histórico da loja continuam válidos.',
      linhaDeCashback(saldo, saldoFalhou),
      'Seu e-mail e seu telefone são liberados para um cadastro novo — e esta ação não tem desfazer.'
    ];

    // A PROVA. `password_set` decide, e é o contrato que diz isso: mandar o
    // campo errado é 400. Aceitar o código numa conta que TEM senha rebaixaria
    // a exigência de toda conta com senha para "quem lê o e-mail".
    const prova = temSenha
      ? `
        <label class="prof-delete-label" for="profDeletePassword">Digite sua senha para confirmar</label>
        <input class="prof-delete-input" id="profDeletePassword" type="password" autocomplete="current-password"
               ${act('input', 'clearDeleteAccountError')}>`
      : `
        <p class="prof-delete-code-hint">Esta conta entra pelo Google e não tem senha. Enviamos um código de 6 dígitos para <strong>${esc(email || 'o e-mail da conta')}</strong>.</p>
        <button class="prof-delete-code-btn" type="button" ${act('click', 'requestDeleteAccountCode')}>Enviar código</button>
        <label class="prof-delete-label" for="profDeleteCode">Código de 6 dígitos</label>
        <input class="prof-delete-input" id="profDeleteCode" type="text" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" ${act('input', 'clearDeleteAccountError')}>`;

    return `
      <div class="prof-delete-warning">
        <h2>Isto exclui sua conta do Rapidex</h2>
        <ul class="prof-delete-list">
          ${consequencias.map(linha => `<li>${esc(linha)}</li>`).join('')}
        </ul>
      </div>
      <div class="prof-delete-proof">${prova}</div>
      <p class="prof-delete-notice" id="profDeleteNotice" role="status" aria-live="polite"></p>
      <p class="prof-delete-error" id="profDeleteError" role="alert" aria-live="polite"></p>
      <button class="prof-delete-submit" type="button" ${act('click', 'confirmDeleteAccount')}>Excluir minha conta</button>`;
  }

  async function openDeleteAccountScreen() {
    // Sem token as três rotas desta tela são 401.
    if (!window.PedeAquiCustomerAuth?.getToken?.()) { shell.openLoginScreen(); return; }
    const screen = $('profDeleteScreen');
    screen?.classList.add('active');
    screen?.setAttribute('aria-hidden', 'false');
    if (carregando) return;
    carregando = true;
    const body = corpo();
    if (body) body.innerHTML = '<p class="prof-delete-loading">Carregando...</p>';
    try {
      // AS DUAS JUNTAS, e as duas assimétricas de propósito.
      //
      // `getCurrentCustomer()` NÃO tem catch: sem `password_set` a tela não
      // sabe qual campo pedir, e adivinhar é justamente o que o contrato diz
      // não ser escolha do app. Falhou, a tela não abre.
      //
      // O saldo TEM catch: uma falha de rede nele não pode impedir alguém de
      // exercer um direito da LGPD. O que ela não pode é virar "você não tem
      // saldo" — por isso o sentinela viaja até `linhaDeCashback`, que
      // escreve a frase honesta.
      const FALHOU = Symbol('cashback indisponível');
      const [me, saldo] = await Promise.all([
        window.PedeAquiCustomerAuth.getCurrentCustomer(),
        window.PedeAquiCustomerAuth.getCustomerCashback().catch(() => FALHOU)
      ]);
      // `@default true` no contrato, e a família do `sort_order`: `||` aqui
      // trataria `false` como ausente e pediria senha a quem não tem nenhuma.
      temSenha = me?.password_set ?? true;
      const b = corpo();
      if (b) {
        b.innerHTML = htmlDoCorpo({
          saldo: saldo === FALHOU ? null : saldo,
          saldoFalhou: saldo === FALHOU,
          email: me?.email
        });
      }
    } catch (error) {
      logAppError('Falha ao abrir a exclusão de conta', error);
      const b = corpo();
      if (b) b.innerHTML = '<p class="prof-delete-loading">Não foi possível carregar. Volte e tente de novo.</p>';
    } finally {
      carregando = false;
    }
  }

  function closeDeleteAccountScreen() {
    if (enviando) return; // fechar no meio de um DELETE em voo é sair sem saber o desfecho
    const screen = $('profDeleteScreen');
    releaseFocusFrom(screen);
    screen?.classList.remove('active');
    screen?.setAttribute('aria-hidden', 'true');
    const body = corpo();
    if (body) body.innerHTML = '';
  }

  function clearDeleteAccountError() { setErro(''); }

  async function requestDeleteAccountCode() {
    if (pedindoCodigo) return;
    pedindoCodigo = true;
    setErro('');
    try {
      await window.PedeAquiCustomerAuth.requestAccountDeleteCode();
      // A RESPOSTA É A MESMA quando o código não sai (cooldown de 60 s, ou
      // três códigos em 15 minutos) — o contrato diz isso e explica: variar a
      // resposta só contaria quantos códigos já saíram. Então a frase daqui
      // também não pode prometer mais do que "pedimos".
      setAviso('Se houver um código a enviar, ele chega em instantes. Ele vale 10 minutos.');
    } catch (error) {
      // 400 aqui significa que a conta TEM senha — ou seja, o `password_set`
      // que esta tela leu está velho. Recarregar é a resposta certa: a tela
      // volta pedindo senha, que é o que o servidor aceita.
      if (error?.status === 400) { await openDeleteAccountScreen(); return; }
      setErro(shell.apiErrorMessage(error, 'Não foi possível enviar o código agora.'));
    } finally {
      pedindoCodigo = false;
    }
  }

  function mensagemDeFalha(error) {
    // 409 é o único desfecho que NÃO é culpa da prova, e é o que a pessoa
    // precisa entender para não repetir o gesto dez vezes: há pedido em
    // andamento e a exclusão fica para depois dele.
    if (error?.status === 409) {
      return shell.apiErrorMessage(error, 'Você tem um pedido em andamento. A exclusão fica disponível quando ele terminar.');
    }
    if (error?.status === 429) {
      return 'Muitas tentativas com este código. Peça um novo código e tente de novo.';
    }
    if (error?.status === 401) {
      return temSenha ? 'Senha incorreta.' : 'Código incorreto ou expirado.';
    }
    return shell.apiErrorMessage(error, 'Não foi possível excluir a conta agora.');
  }

  async function confirmDeleteAccount() {
    if (enviando) return;
    // A conferência do campo vazio é LOCAL, e não uma ida à rede para ouvir o
    // 400 — a mesma regra do diálogo de conectar o Google (§19.3).
    const senha = $('profDeletePassword')?.value || '';
    const codigo = ($('profDeleteCode')?.value || '').trim();
    if (temSenha && !senha) { setErro('Informe sua senha para confirmar.'); return; }
    if (!temSenha && codigo.length !== 6) { setErro('Informe o código de 6 dígitos que enviamos por e-mail.'); return; }

    enviando = true;
    setErro('');
    const botao = document.querySelector('#profDeleteScreen .prof-delete-submit');
    if (botao) botao.disabled = true;
    try {
      // UM dos dois campos, nunca os dois: quem escolhe é a conta.
      await window.PedeAquiCustomerAuth.deleteAccount(temSenha ? { password: senha } : { email_code: codigo });
      // 204. Daqui para frente a conta NÃO EXISTE mais e o token desta própria
      // chamada morreu junto — qualquer requisição seguinte é 401. Então a
      // saída é local e imediata, e não passa por mais nenhuma rota.
      enviando = false;
      sairDaContaExcluida();
    } catch (error) {
      setErro(mensagemDeFalha(error));
      enviando = false;
      if (botao) botao.disabled = false;
    }
  }

  /**
   * A saída depois do 204. É o mesmo gesto do logout, com uma diferença que
   * importa: não há para onde voltar. A tela fecha, a subtela fecha, a sessão
   * é limpa e a Home volta ao estado de quem nunca entrou.
   *
   * NÃO abre a tela de login no fim, ao contrário do `redirectCustomerData` da
   * troca de senha: convidar a entrar numa conta que acabou de ser excluída é
   * oferecer uma porta que responde 401.
   */
  function sairDaContaExcluida() {
    const screen = $('profDeleteScreen');
    releaseFocusFrom(screen);
    screen?.classList.remove('active');
    screen?.setAttribute('aria-hidden', 'true');
    const body = corpo();
    if (body) body.innerHTML = '';
    window.PedeAquiCustomerAuth?.logout?.();
    app.persistCustomer(null);
    shell.closeProfSub();
    shell.renderHomeLoginPrompt();
    shell.renderProfileView();
    shell.showAppToast('Sua conta foi excluída.');
  }

  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('account-delete-screen: mount(ctx) exige kit, app e shell');
    ({ $, esc, fmt, act, releaseFocusFrom, logAppError } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['openLoginScreen', 'closeProfSub', 'renderHomeLoginPrompt', 'renderProfileView', 'apiErrorMessage', 'showAppToast']) {
      if (typeof shell[nome] !== 'function') throw new Error(`account-delete-screen: shell.${nome} ausente`);
    }
    window.RapidexActions.register({
      openDeleteAccountScreen,
      closeDeleteAccountScreen,
      clearDeleteAccountError,
      requestDeleteAccountCode,
      confirmDeleteAccount
    });
  }

  window.PedeAquiAccountDeleteScreen = { mount };
})();
