# CSP e o SDK do Mercado Pago

Por que a política de `vercel.json` tem os hosts que tem, e por que ela **não** foi
afrouxada para os Secure Fields funcionarem.

**Resposta curta para quem chegou aqui perguntando:** o `script-src` continua sem
`'unsafe-inline'` e sem `'strict-dynamic'`. O único `'unsafe-inline'` da política está no
`style-src`, é anterior a este trabalho e não tem relação com o Mercado Pago. O que os
campos do cartão exigiram foram **dois hosts em `connect-src`** — nada no `script-src`.

## O que o SDK realmente precisa

Levantado lendo o bundle servido em `https://sdk.mercadopago.com/js/v2` e confirmado por
teste com o SDK real rodando sob a política real (ver a seção de testes no fim). Não é o
que a documentação diz — ela não diz (ver "O que o Mercado Pago recomenda").

| Diretiva      | Host                                    | Para quê                                   |
| ------------- | --------------------------------------- | ------------------------------------------ |
| `script-src`  | `https://sdk.mercadopago.com`           | a tag do SDK                               |
| `connect-src` | `https://api.mercadopago.com`           | tokenização, `getPaymentMethods`, métricas |
| `connect-src` | `https://secure-fields.mercadopago.com` | **o `fetch` da página dos campos**         |
| `connect-src` | `https://api-static.mercadopago.com`    | reserva do `fetch` acima                   |
| `frame-src`   | `https://secure-fields.mercadopago.com` | o iframe de cada campo                     |
| `img-src`     | `https://*.mercadopago.com`             | logos de bandeira                          |

A linha que faltava — e que causou o bug de "campo indisponível" — é a terceira. O host do
iframe **também** precisa estar em `connect-src`, porque antes de apontar o `<iframe>` para
ele o SDK faz um `fetch`:

```js
_r.preflight = y.fetchPage(dr().cacheUrl).catch(() => y.fetchPage(dr().sourceUrl));
// prod: cacheUrl  "https://secure-fields.mercadopago.com/"
//       sourceUrl "https://api-static.mercadopago.com/secure-fields"
```

`fetch` cai em `connect-src`, não em `frame-src`. Com só o `frame-src` liberado, o `fetch`
morria na política, o iframe nunca recebia `src`, nenhum campo montava — e a tela ficava os
15 s do relógio para dizer "não foi possível iniciar os campos seguros do cartão".

### Hosts que o SDK toca e que a política **não** libera, de propósito

| Host                                       | Quem chama                   | Por que fica bloqueado                                         |
| ------------------------------------------ | ---------------------------- | -------------------------------------------------------------- |
| `api.mercadolibre.com/tracks`              | analítica (melidata)         | 5 chamadas por tela do cartão, nenhuma do caminho do pagamento |
| `www.mercadolivre.com`, `mercadolibre.com` | widget de device fingerprint | ver abaixo                                                     |

Os dois estão desligados **na origem**, por opção do construtor, em vez de bloqueados na
CSP — assim não sobra violação no console:

```js
new MercadoPago(publicKey, {
  locale: 'pt-BR',
  advancedFraudPrevention: false,
  trackingDisabled: true
});
```

## O script inline: por que não tem nonce nem hash

Com `advancedFraudPrevention: true`, o SDK pede `POST /v1/devices/widgets` e injeta a
resposta como `<script>` **inline** no `<head>`:

```js
const e = await y.fetch("/devices/widgets", { method: "POST", ... }), t = await e.json(),
      r = document.createElement("script");
r.appendChild(document.createTextNode(t.widget.replace(...)));
document.head.appendChild(r);
```

As duas saídas normais para liberar um inline não existem aqui:

- **Hash não serve.** O corpo tem ~58 KB e carrega dentro dele o `session_id` daquela
  chamada. Medido: dois `POST` seguidos ao endpoint, com a chave pública de produção,
  devolvem corpos de mesmo tamanho e **conteúdo diferente** — o trecho que muda é a URL
  `.../background/session/armor.<hash>`. O hash mudaria a cada carregamento da página.
- **Nonce não serve.** O SDK não expõe ponto nenhum para informar um: a string `nonce` não
  aparece uma única vez no bundle.

Sobrariam `'unsafe-inline'` ou `'strict-dynamic'`, e os dois valem para o documento
inteiro. `'strict-dynamic'` ainda derrubaria o teste que garante que um `<script>` inline
injetado é bloqueado (`tests/e2e/csp.spec.js`) — que é justamente a defesa contra XSS que a
política existe para dar.

**Então a escolha foi desligar o device fingerprint.** O efeito prático hoje é nenhum: sob
a CSP que já estava em produção esse inline nunca chegou a executar — só sujava o console.
O que se perde é o sinal de device fingerprint na análise antifraude do Mercado Pago;
tokenização e compra funcionam sem ele.

### Se alguém quiser o fingerprint de volta

É uma decisão de negócio, não técnica, e o preço é este: `'unsafe-inline'` (ou
`'strict-dynamic'`) no `script-src` do site inteiro, **mais** os hosts do Mercado Livre em
`connect-src`. Em troca, um sinal a mais no antifraude do gateway. Quem trocar isso deve
atualizar este arquivo e os testes de `csp.spec.js` que hoje travam a decisão.

### Escopar a exceção só na tela do cartão não ajuda

Seria possível pela `vercel.json` — os `headers` casam por `source`, então dá para servir
uma CSP diferente em um caminho. Só que a tela do cartão é um **modal dentro de
`restaurant.html`**, o mesmo documento do cardápio, da sacola, do assistente e do perfil.
Não existe URL própria para escopar: afrouxar "só a página do cartão" afrouxaria o
`script-src` de toda a experiência do restaurante — ou seja, do site inteiro na prática.

## O que o Mercado Pago recomenda oficialmente

**Nada.** Procurado na documentação de desenvolvedores e no repositório do SDK:

- A documentação oficial não tem página de CSP para Secure Fields. As páginas de segurança
  (PCI, OWASP) não mencionam `Content-Security-Policy` em nenhum momento.
- [sdk-js discussion #75](https://github.com/mercadopago/sdk-js/discussions/75) — a única
  orientação vinda de alguém do lado deles: acrescentar `*.mercadopago.com` ao `frame-src`.
  Necessário, mas insuficiente: é exatamente a configuração que produzia o bug, porque não
  cobre o `fetch`.
- [sdk-js discussion #16](https://github.com/mercadopago/sdk-js/discussions/16) — um
  usuário pergunta explicitamente se dá para usar nonce. **Nenhum mantenedor respondeu.**
- [sdk-js discussion #145](https://github.com/mercadopago/sdk-js/discussions/145) — sobre o
  `security.js` (o mesmo fingerprint em forma de script externo); não trata de CSP.

Ou seja: eles não recomendam `'unsafe-inline'` — eles não recomendam nada. A tabela do topo
deste arquivo foi levantada do bundle e verificada em teste, e é a fonte mais confiável que
existe hoje.

## Onde isso está testado

- `tests/e2e/csp.spec.js` — trava a política no papel: os hosts obrigatórios presentes,
  `script-src` sem `'unsafe-inline'` e sem `'strict-dynamic'`, e um `<script>` inline
  injetado em runtime sendo de fato bloqueado.
- `tests/e2e/mercado-pago-secure-fields.spec.js` — trava a política **na prática**: sobe o
  SDK de verdade sob o header real lido de `vercel.json`, digita nos quatro campos,
  tokeniza, e exige zero violações de CSP e zero erros no console. É o único teste que pega
  uma regressão como a do `connect-src`, e por isso ele lê a política do `vercel.json` em
  vez de ter uma cópia. Roda com `PAYMENT_PUBLIC_KEY=<chave> npm run test:e2e`; sem a
  variável, ele se pula.
