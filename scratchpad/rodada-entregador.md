# Rodada da tela do entregador — 03/09/2026

Quatro melhorias pedidas, olhando como a Cardápio Web resolve. Este arquivo é o
scratchpad da rodada; ele não existia até aqui, e a falta dele custou meia hora
de reconstrução quando a sessão morreu (o computador desligou) com o item 3 pela
metade. O estado teve de ser remontado do `git diff`, do `git log` e do
transcript — que funcionou, mas nenhum dos três diz **por que** uma decisão foi
tomada.

Fora de escopo por decisão do dono, e não se constrói: rota, "iniciar rota",
mapa, auto-atribuição por QR, notificação, localização. Fase 2.

---

## 1. Barra de abas embaixo — FEITO

`Entregas · Histórico · Configurações`, `position:fixed` no rodapé, fora das
seções (uma barra só, não três cópias que precisariam concordar). Some na porta
e no fim da linha: sem código não há para onde navegar, e link morto não tem
seções.

**`aria-current="page"`, não `aria-selected`.** Isto é navegação entre telas, não
um `tablist` ARIA — não existem painéis irmãos com `role="tabpanel"`, e declarar
a semântica errada é pior que não declarar nenhuma.

**Tocar em "Entregas" RECARREGA a lista.** Era o que o `courierHistoryBack` já
fazia, pelo mesmo motivo: o entregador pode ter ficado minutos na outra tela, e
voltar para uma lista congelada é o caminho curto para um toque em "Entregue"
que responde 409.

### O recarregar fica no topo, e não vira puxar-para-atualizar

Três motivos, na ordem em que pesam para quem está na rua:

1. **o gesto só existe no topo da rolagem.** Com meia dúzia de pedidos o
   entregador está rolado para baixo boa parte do tempo, e é aí que ele quer
   atualizar — a ferramenta some justamente na hora de usar;
2. **o Chrome do Android já tem puxar-para-atualizar nativo, e o dele RECARREGA
   A PÁGINA.** Implementar o nosso exige `overscroll-behavior` travando o do
   browser, e um reload aqui reexecuta o boot inteiro numa página cuja URL
   carrega credencial. Brigar com o gesto da plataforma por um botão que já
   existe é risco sem troco;
3. **um alvo fixo, sempre no mesmo lugar, é o que se acerta de primeira com uma
   mão só** — gesto depende de acertar a direção e a distância.

O alcance do polegar era o contra-argumento honesto (canto superior é o pior
canto num celular grande), e a barra de abas o resolve de graça: "Entregas"
recarrega e fica embaixo.

### Configurações, e por que ela existe agora com um item só

Só "Sair" — notificação, localização e app de navegação são fase 2. A aba entra
agora por duas razões: uma barra de duas abas ganharia uma terceira depois e
**mudaria de largura embaixo do polegar de quem já aprendeu onde tocar**; e
"Sair" não tinha lugar nenhum — o código ficava guardado no aparelho sem uma
porta para apagá-lo.

**"Sair" NÃO é sair da conta: não há conta.** É "este aparelho esquece o
código", e a tela diz exatamente isso embaixo do botão. O link continua valendo;
quem revoga link é o restaurante, pelo painel. A implementação reusa
`pedirCodigo()`, que já apaga o guardado — uma segunda implementação de
"esquecer credencial" é a chance de uma delas esquecer metade.

---

## 2. Pago / Não pago em cor — FEITO

Chip ao lado do valor: `Pago` em verde (`--cr-paid: #10693C`), `Não pago` em
vermelho (`--cr-unpaid: #A4231C`). Era texto cinza discreto, e cobrar duas vezes
é o erro que sai do bolso do entregador.

**Cor de estado, nunca de marca** — e esta tela não tem marca, então os dois
tokens são declarados separados da cor de ação.

**E o chip carrega A PALAVRA, não só a cor.** No sol duas cores saturadas viram
a mesma mancha, e daltonismo é comum. A cor acelera a leitura; quem informa é o
texto. O teste afirma o texto ANTES da cor de propósito: um teste só de cor
aprovaria um chip mudo.

`is_paid` e `amount_to_collect` continuam sendo lidos como independentes — um
pedido pode estar pago e não ter nada a receber. O terceiro ramo (não pago e sem
valor) é dado contraditório do backend: o chip diz "Não pago", que é o fato de
`is_paid: false`, e a frase ao lado diz que o QUANTO não está confirmado.

---

## 3. Menu de ações por pedido — FEITO

Três pontinhos com `Confirmar entrega · Ligar para o cliente · Chamar no
WhatsApp · Copiar endereço · Abrir no mapa · Detalhes`.

Eram quatro links e botões soltos disputando a mesma linha do cartão. Num
celular estreito quebravam em duas fileiras e o cartão ficava mais alto que a
informação dentro dele — cabiam dois pedidos na tela em vez de três, e a lista é
o que essa pessoa passa o turno olhando.

Decisões:

- **a seleção para o lote FICA no cartão.** Ela não é ação sobre um pedido, é o
  que alimenta a barra de baixo; escondê-la no menu tornaria o fluxo principal
  um segredo.
- **"Rota" virou "Abrir no mapa".** A função continua igual — apagar o que
  funciona não é reorganizar. O nome mudou porque "rota" virou o nome de uma
  frente de fase 2 (planejar a rota do turno), e dois significados para a mesma
  palavra na mesma tela é como se promete o que não existe.
- **um menu aberto por vez, guardado pelo `order_id` e não por um booleano.**
  Dois menus abertos num celular estreito se sobrepõem, e fechar "o menu" sem
  saber qual era deixaria o `aria-expanded` do outro mentindo.
- **`wa.me` recebe dígitos, com o 55 quando falta.** O contrato não diz o
  formato de `customer_phone` — em produção ele chega como o cliente digitou.
  Onze dígitos ou menos é nacional e ganha o 55; acima disso já vem com país.
- **`customer_phone` é `required` no contrato, e required não é "não vazio".**
  String em branco não vira `tel:` nem `wa.me`: alvo que promete e não cumpre.
- **`noopener noreferrer` no WhatsApp e no mapa.** A URL desta janela carrega o
  `link_token`, que é credencial — `noreferrer` é o que impede o token de viajar
  no `Referer`.
- **`navigator.clipboard` pode falhar** (exige contexto seguro e, em alguns
  browsers, permissão). O `catch` avisa em vez de engolir: quem tocou precisa
  saber se pode colar ou se vai colar o que estava antes.

### O achado do item 3, e ele é do dinheiro

O painel de "Detalhes" nasceu mostrando **`Total do pedido` e `A receber na
entrega` lado a lado**, com o argumento de que são números diferentes num pedido
pago online e mostrar só um deixa a pergunta "então quanto é?" sem resposta. O
argumento é bom e **perde para um mais caro**.

Dois vermelhos apontaram para lá, e os dois estavam certos:

    courier-screen.spec.js:213  Expected 0, Received 1   (getByText('118,90'))
    courier-screen.spec.js:513  Expected 0, Received 1   (getByText('R$ 0,00'))

1. **O `total` saiu.** É o único número desta tela sobre o qual o entregador não
   pode agir, e cobrar o de cima num pedido pago online — 118,90 em vez de
   23,50 — é exatamente o erro que o chip do item 2 entrou para evitar. O teste
   de 213 já guardava isso; o painel novo o reintroduziu ESCONDIDO no DOM, e o
   teste reprovou. Foi o teste fazendo o trabalho dele.
2. **`amount_to_collect: 0` virava "R$ 0,00".** Parcela zerada é linha FORA,
   nunca um "R$ 0,00" solto — a mesma regra da sacola do cliente. Quem diz que
   não há nada a receber é a linha "Nada a receber" com o chip "Pago" ao lado.

Se o dono quiser o total ali, é **inversão consciente**: o commit diz que é
inversão e o teste vira asserção do que continua valendo, não some (skill
§14.8).

---

## 4. Adiantado ou atrasado — NÃO DÁ, e o pedido ao backend está pronto abaixo

**Conferido no contrato, não lembrado.** `CourierOrderResponse`
(`scripts/types/openapi.json`) tem 23 campos, e os únicos de tempo são:

    assigned_at   date-time | null   quando o pedido foi atribuído a ele
    created_at    date-time | null   quando o cliente fez o pedido

**Não há prazo prometido em lugar nenhum da resposta do entregador.** Sem prazo
não existe "+5 min" nem "−5 min": os dois são a distância até um alvo, e o alvo
não vem. Calcular a partir de `created_at` seria inventar o prazo aqui — um
número que parece dado e é chute, na tela de quem vai responder por ele ao
cliente.

### E o prazo EXISTE — só não chega até aqui

Ele está gravado no pedido, e a rota do CLIENTE já o publica
(`OrderDetailResponse`):

    delivery_estimated_at       date-time | null   o instante em que a estimativa foi tirada
    delivery_eta_min            integer | null     minutos, piso da janela prometida
    delivery_eta_max            integer | null     minutos, teto da janela prometida
    delivery_prep_time_min/max  integer | null     a parte de preparo, dentro do ETA
    delivery_estimate_provider  string | null      quem estimou

Conferido no backend: `order_model.py:108` tem a coluna, e `order_service.py:237`
grava `delivery_estimated_at = now()` no instante da criação do pedido, **só
quando houve estimativa de entrega** (retirada e pedido sem estimativa ficam
`null`). Logo:

    prazo prometido = delivery_estimated_at + delivery_eta_max minutos
    adiantado/atrasado = prazo − agora

E o serializer do entregador já tem o `order` inteiro na mão:
`courier_delivery_service.py:349` (`_order_response`) recebe `assignment` e
`order` e só não projeta esses campos. **É acrescentar campo a um schema, não
capacidade nova.**

### O pedido, pronto para colar

> **Projetar o prazo prometido no `CourierOrderResponse`**
>
> A tela do entregador vai mostrar "+5 min" (verde) ou "−5 min" (vermelho) por
> pedido, contra o prazo prometido ao cliente — é a informação que faz o
> entregador priorizar a fila sozinho, e hoje ele não tem como saber qual dos
> quatro pedidos na mochila está atrasado.
>
> O dado já existe e já está gravado no pedido: `orders.delivery_estimated_at`,
> `orders.delivery_eta_min` e `orders.delivery_eta_max` (`order_model.py`),
> preenchidos em `order_service.py:237` na criação. O `OrderDetailResponse` do
> cliente já os publica; o `CourierOrderResponse` não.
>
> **O que preciso:** acrescentar três campos a `CourierOrderResponse`
> (`src/schemas/courier_schema.py:234`), copiados do pedido sem transformação
> nenhuma:
>
> ```python
> delivery_estimated_at: datetime | None = None   # order.delivery_estimated_at
> delivery_eta_min: int | None = None             # order.delivery_eta_min
> delivery_eta_max: int | None = None             # order.delivery_eta_max
> ```
>
> e preenchê-los em `CourierDeliveryService._order_response`
> (`src/services/courier_delivery_service.py:349`), que já recebe o `order`:
>
> ```python
> delivery_estimated_at=order.delivery_estimated_at,
> delivery_eta_min=order.delivery_eta_min,
> delivery_eta_max=order.delivery_eta_max,
> ```
>
> **Três coisas que eu preciso que vocês confirmem, porque o front não pode
> decidir nenhuma delas:**
>
> 1. **os minutos contam a partir de `delivery_estimated_at`?** É o que o código
>    da criação sugere (`= now()` no mesmo instante em que a estimativa entra),
>    mas isso é leitura minha do código, não contrato. Se a referência for
>    outra (o aceite do pedido, por exemplo), a conta do front muda inteira.
> 2. **os três são `null` juntos, ou podem vir separados?** Vou tratar
>    "qualquer um ausente" como "sem prazo" e **não mostrar nada** — nunca um
>    "0 min", que seria pontualidade inventada. Se vocês garantem que vêm
>    juntos, o front fica mais simples; se não, fica como está.
> 3. **o prazo é REVISADO depois da criação?** Se a cozinha atrasa e alguém
>    empurra o ETA, o entregador precisa ver o prazo novo, não o da criação. Se
>    hoje não é revisado, tudo bem — mas eu preciso saber, porque a diferença
>    entre "o prazo é este" e "o prazo era este quando o pedido entrou" muda o
>    que a tela pode afirmar.
>
> **O que eu NÃO estou pedindo:** o cálculo pronto ("+5 min"). Ele depende do
> relógio de quem olha e muda a cada minuto — é conta de tela, e o front sabe
> fazê-la desde que receba o alvo. Mandar o número pronto envelheceria dentro da
> resposta.

### Enquanto não chega

**Nada foi construído para o item 4** — nem placeholder, nem cálculo a partir de
`created_at`. Inventar o prazo com dado que não existe é o oposto da regra 1 do
repositório, e num campo que o entregador vai usar para decidir a ordem das
entregas o chute custa entrega atrasada de verdade.

---

## Verificação

- Os 9 testes novos foram vistos **VERMELHOS** com `entregador.html`,
  `courier-page.js` e `courier.css` revertidos para o HEAD (cópias no
  scratchpad primeiro, nunca `git checkout` — §12.9-2 da skill), e cada um
  falhou pelo motivo certo: `#courierTabs` inexistente, `.cr-card__chip`
  inexistente, `button[data-acao="menu"]` inexistente.
- **Um deles falhou pelo motivo ERRADO na primeira tentativa** e foi consertado:
  `link morto não tem abas` não digitava o código, e sem código o app mostra a
  PORTA — ele só descobre que o link morreu no 404 do `/me`. O vermelho era
  `#courierDead` escondido, e o teste teria falhado igual com o app corrigido.
- **Dois deles passavam de graça** e foram consertados: para o Playwright um
  elemento que NÃO EXISTE está escondido, então `toBeHidden()` sozinho fica
  verde num app que nunca construiu a barra. `toBeAttached()` antes de
  `toBeHidden()` é o que separa "existe e está escondida aqui" de "nunca foi
  construída".

## Ficou anotado, não consertado

- **`tests/e2e/courier-screen.spec.js`, mock do `/delivered`,** responde
  `status: 'delivered'`. `delivered` **não está em `ORDER_STATUSES`** — o nome
  do contrato é `completed`, e `COURIER_TRANSITIONS` mapeia para ele. É a
  armadilha da §14.7 da skill (fixture que codifica um contrato que não existe),
  e ela também está em `STATUS_EM_PORTUGUES` (`courier-page.js:42`). Não mexi
  porque é outro eixo e nenhum teste desta rodada o exercita; vale um commit
  próprio, com o teste visto vermelho.
