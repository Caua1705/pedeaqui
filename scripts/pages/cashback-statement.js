(function(){
  let requestVersion=0;
  const $=id=>document.getElementById(id);
  const money=(value,currency='BRL')=>new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(Math.abs(Number(value)||0));
  const date=value=>{if(!value)return '';const raw=String(value);const d=/^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(raw+'T12:00:00'):new Date(raw);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('pt-BR')};
  const debit=item=>Number(item.amount)<0||['redeemed','used'].includes(String(item.type||'').toLowerCase());
  const fallback=type=>({earned:'Crédito de cashback',redeemed:'Uso de saldo',used:'Uso de saldo',adjustment:'Lançamento de crédito',expired:'Cashback expirado',refund:'Estorno de cashback'})[String(type||'').toLowerCase()]||'Movimentação de cashback';
  function summary(show,balance,currency){const el=$('cashbackStatementSummary'),value=$('cashbackStatementBalance');if(el)el.hidden=!show;if(show&&value)value.textContent=money(balance,currency||'BRL')}
  // Fase 4/B1: as linhas do extrato são construídas por DOM, não por template.
  // A versão anterior interpolava item.description e item.restaurant_name via
  // `window.esc ? window.esc(x) : x` — e window.esc nunca existiu (o esc() do
  // app é local do IIFE de restaurant-page.js), então o ramo cru era o único
  // que rodava. Como a conta do cliente é global do Rapidex, texto vindo da API
  // caindo em innerHTML alcançaria a sessão em qualquer restaurante.
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};

  function stateBox(body,modifier,text){
    const box=el('div',`cashback-statement-state cashback-statement-state--${modifier}`);
    // O estado vazio é texto solto no div; loading e erro envolvem em <span>,
    // como no markup original — o CSS depende dessa diferença.
    if(modifier==='empty'){box.textContent=text;body.replaceChildren(box);return}
    if(modifier==='loading')box.appendChild(el('span','cashback-statement-spinner'));
    box.appendChild(el('span',null,text));
    if(modifier==='error'){
      const retry=el('button','cashback-statement-retry','Tentar novamente');
      retry.type='button';
      retry.addEventListener('click',()=>load(true));
      box.appendChild(retry);
    }
    body.replaceChildren(box);
  }

  function statementRow(item,currency){
    const isDebit=debit(item);
    const type=String(item.type||'').toLowerCase();
    const secondary=!isDebit&&['earned','adjustment'].includes(type)&&item.expires_at
      ?`Expira em ${date(item.expires_at)}`
      :(item.restaurant_name||'');
    const tone=isDebit?'negative':'positive';

    const row=el('article','cashback-statement-row');
    row.appendChild(el('div',`cashback-statement-icon ${tone}`,isDebit?'↗':'↓'));

    const copy=el('div','cashback-statement-copy');
    const created=date(item.created_at);
    if(created)copy.appendChild(el('time',null,created));
    copy.appendChild(el('strong',null,item.description||fallback(item.type)));
    if(secondary)copy.appendChild(el('span',null,secondary));
    row.appendChild(copy);

    row.appendChild(el('div',`cashback-statement-amount ${tone}`,`${isDebit?'-':'+'} ${money(item.amount,currency)}`));
    return row;
  }

  function render(state){
    const body=$('cashbackStatementBody');
    if(!body)return;
    const tx=state?.transactions;
    if(!tx||tx.status==='idle'||tx.status==='loading'){summary(false);stateBox(body,'loading','Carregando extrato...');return}
    if(tx.status==='error'){summary(false);stateBox(body,'error','Não foi possível carregar seu extrato.');return}
    const data=tx.data||{};
    const items=Array.isArray(data.transactions)?data.transactions:[];
    if(!items.length){summary(false);stateBox(body,'empty','Não há nenhum registro de cashback');return}
    summary(true,data.balance,data.currency);
    const currency=data.currency||'BRL';
    body.replaceChildren(...items.map(item=>statementRow(item,currency)));
  }
  async function load(force){const service=window.PedeAquiClubService,version=++requestVersion;const request=service?.getCashbackTransactions?.({limit:20,offset:0,force});render(service?.getState?.()||{transactions:{status:'loading'}});await request;if(version!==requestVersion||!$('cashbackStatementModal')?.classList.contains('active'))return;const state=service?.getState?.();if(state?.transactions?.error?.status===401){$('cashbackStatementModal')?.classList.remove('active');await window.syncCustomerSession?.();window.openLoginScreen?.();return}render(state)}
  window.openCashbackStatement=async()=>{const auth=window.PedeAquiCustomerAuth;if(!auth?.getToken?.()){window.openLoginScreen?.();return}const modal=$('cashbackStatementModal');modal?.style.removeProperty('display');modal?.classList.add('active');render({transactions:{status:'loading'}});if(!auth.isSessionReady?.())await window.syncCustomerSession?.();if(!auth.getToken?.()){modal?.classList.remove('active');window.openLoginScreen?.();return}load(false)};
  window.retryCashbackStatement=()=>load(true);
  window.closeCashbackStatement=event=>{if(event&&event.target!==event.currentTarget)return;requestVersion+=1;$('cashbackStatementModal')?.classList.remove('active')};
  // Este arquivo carrega DEPOIS de restaurant-page.js e sempre foi a versão que
  // vencia em window. Registrar aqui mantém exatamente essa precedência agora
  // que o markup resolve as ações pelo registro.
  window.RapidexActions?.register({
    openCashbackStatement:window.openCashbackStatement,
    retryCashbackStatement:window.retryCashbackStatement,
    closeCashbackStatement:window.closeCashbackStatement
  });
  document.addEventListener('click',event=>{
    const overlay=$('cashbackStatementModal');
    if(!event.target.closest('.mob-bottom-nav .mob-nav-item,#cartStickyBtn')||!overlay?.classList.contains('active'))return;
    requestVersion+=1;
    overlay.classList.remove('active');
    overlay.style.setProperty('display','none','important');
  },true);
})();