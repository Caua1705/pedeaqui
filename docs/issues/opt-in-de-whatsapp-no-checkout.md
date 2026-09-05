# Opt-in de WhatsApp no checkout — BLOQUEADO POR BACKEND

**Levantado em 05/09/2026. Decisão da rodada: NÃO construir a caixa de
consentimento. Não é falta de tempo — é que o app não tem onde guardar a
resposta, e ninguém do outro lado a leria.**

## O pedido

A Meta exige que o cliente tenha consentido em receber mensagem antes de o
canal mandar a primeira. O canal está quase no ar. O pedido era uma linha no
checkout, clara, sem virar formulário novo.

A instrução que veio junto — e que este documento cumpre — foi: *levante no
contrato se o backend já tem onde guardar isso; se não tiver, é bloqueio.*

## O que o contrato tem, e por que nenhum dos campos serve

Varrido o `openapi.json` inteiro por `whatsapp|opt_in|consent|marketing`. O
único campo de consentimento em qualquer schema de cliente é
**`marketing_opt_in`**, que aparece em quatro lugares:

| schema | forma |
|---|---|
| `CurrentCustomerResponse` | `boolean`, obrigatório (leitura) |
| `RegisterCustomerRequest` | `boolean`, `@default false` |
| `GoogleCompleteSignupRequest` | `boolean`, `@default false` |
| `UpdateCurrentCustomerRequest` | `boolean \| null` (o PATCH) |

**Ele não serve, por quatro razões independentes — e a primeira sozinha já
bastaria.**

1. **Ninguém o lê na hora de mandar.**
   `WhatsAppNotificationService.notify()` (backend) decide enviar por cinco
   perguntas: a chave global `WHATSAPP_NOTIFICATIONS_ENABLED`, o status do
   pedido ter aviso, o `order_type` caber naquele aviso, a filial ter canal, e
   o aviso ainda não ter saído. **Consentimento do cliente não é uma delas.**
   Uma caixa desmarcada no checkout não impediria mensagem nenhuma: seria uma
   promessa que o sistema não cumpre, que é pior que não perguntar.

2. **O significado dele já está escrito na tela, e é outro.** O rótulo da
   caixa que grava esse campo hoje (`#regPromo`, cadastro) diz *"Aceito
   receber e-mails e SMS's promocionais"*. Reaproveitá-lo para WhatsApp
   transacional faria todo cliente já cadastrado ter "consentido" com uma
   coisa que ninguém lhe mostrou. É o inverso de consentimento.

3. **É PROMOCIONAL, e o aviso de pedido é TRANSACIONAL.** São categorias
   diferentes na própria Meta, e juntá-las num booleano só impede o caso
   normal: querer o andamento do pedido e não querer propaganda.

4. **Exige conta, e o checkout não.** O campo mora em `customers` e só se
   escreve por `PATCH /customers/me`. Convidado pede sem conta — e é
   exatamente ele quem recebe o aviso pelo número que digitou.

## E no pedido?

`CreateOrderRequest` tem doze campos (`address`, `branch_id`, `coupon_code`,
`coupon_id`, `customer`, `customer_address_id`, `delivery_estimate_token`,
`items`, `notes`, `order_type`, `payment_method`, `use_cashback`) e nenhum de
consentimento. `CustomerInput`, o sub-objeto, tem `name` e `phone`.

**E este schema NÃO é fechado** (`additionalProperties` ausente), o que aqui é
a pior notícia possível: um `whatsapp_opt_in` mandado por conta própria não
levaria 422 — o Pydantic o **descarta em silêncio**. É a §16.3 exata, o CPF
que o front continuou mandando por três semanas depois de a API removê-lo.
Mandar campo que o contrato não declara é escrever para o vazio com a
aparência de sucesso.

## O que destrava, do lado de lá

Uma das duas, e a primeira é a barata:

- **`whatsapp_opt_in: bool` em `CreateOrderRequest`** (e em `CustomerInput`, se
  a preferência for por pedido), gravado na linha do pedido, com
  `notify()` passando a perguntar por ele. Isso cobre convidado e cliente
  logado com o mesmo caminho, que é o que o checkout precisa.
- **um campo próprio no cliente** (`whatsapp_opt_in`, separado do
  `marketing_opt_in`) mais leitura em `notify()`. Cobre só quem tem conta.

Enquanto nenhum dos dois existir, a linha no checkout só poderia ser um AVISO
("você vai receber o andamento no WhatsApp"), nunca uma escolha — e um aviso
publicado agora seria lido daqui a um mês como "o opt-in está feito", e o
opt-in de verdade nunca nasceria. É a lição do `persistCouponChoice` (skill
§12.7) na direção contrária: não deixar de pé a meia-peça que dispensa a
peça inteira.

## Onde isso está escrito do outro lado

`../pedeaqui_back/docs/whatsapp.md`, na lista de conhecidos:

> **O opt-in no checkout do app.** A Meta exige que o cliente tenha consentido
> em receber mensagem. É uma linha no app, não no backend — e sem ela o risco
> é a qualidade do número cair por denúncia, que é o que derruba o canal.

A metade "é uma linha no app" está certa. A que falta é que a linha precisa de
um lugar para guardar a resposta e de alguém que a leia antes de enviar — e as
duas coisas são do backend.
