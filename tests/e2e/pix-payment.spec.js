import { test, expect } from '@playwright/test';
import {
  mockApi,
  seedPickupSession,
  pixOrder,
  pixCharge,
  trackedOrder,
  selectPixAndReturnToCart,
  PIX_QR_CODE,
  SLUG
} from './helpers.js';

// Fluxo Pix ponta a ponta no app CONSTRUÍDO, com toda a API interceptada:
//
//   POST /orders                     -> payment_flow "online" + tracking_token
//   POST /orders/{token}/payment     -> qr_code + checkout_url
//   GET  /orders/track/{token}       -> repetido até payment_status virar pago
//
// O que estes testes protegem, em ordem de custo se quebrar: o copia-e-cola
// precisa carregar o payload EXATO do gateway (um código truncado de verdade
// cobra errado ou nem cobra), o polling precisa PARAR (nem infinito, nem parado
// cedo demais) e o pedido pago na entrega não pode encostar nesse caminho.

// Cada teste aqui faz o boot completo do app, monta a sacola, cria o pedido e
// só então chega na cobrança — e dois deles esperam de propósito (provar que o
// polling parou; atravessar a janela de 10 minutos). O limite padrão de 30s é
// apertado para isso, ainda mais com a suíte rodando em paralelo.
test.describe.configure({ timeout: 90_000 });

/** Leva o app de produto -> sacola -> Pix -> pedido criado. */
async function submitPixOrder(page) {
  await selectPixAndReturnToCart(page);
  await page.locator('#cartCtaBtn').click();
}

test.beforeEach(async ({ page }) => {
  await seedPickupSession(page);
});

test('cria o pedido, gera a cobrança e mostra código, prazo, pedido e checkout', async ({
  page
}) => {
  const { orderRequests, paymentRequests } = await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);

  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  // A cobrança é criada UMA vez, no pedido recém-criado.
  expect(paymentRequests).toHaveLength(1);
  expect(paymentRequests[0].token).toBe(orderRequests.length ? pixOrder(1).tracking_token : '');

  // A tela na ordem da referência: título, instrução, código, prazo.
  await expect(page.getByRole('heading', { name: 'Pedido aguardando pagamento' })).toBeVisible();
  await expect(page.locator('#pixLede')).toContainText('Pix Copia e Cola');

  // O código guardado é EXATAMENTE o payload do gateway — quem trunca é o CSS.
  // Se o TEXTO divergir, o cliente paga outra coisa.
  await expect(page.locator('#pixCopyCode')).toHaveText(PIX_QR_CODE);
  const field = page.locator('#pixCodeField');
  await expect(field).toBeVisible();
  // Truncado de verdade: uma linha, sem esticar a tela na horizontal.
  const fieldBox = await field.boundingBox();
  expect(fieldBox?.height).toBeLessThan(70);
  expect(fieldBox?.width).toBeLessThanOrEqual(
    (await page.locator('.pix-ready').boundingBox())?.width ?? 0
  );

  await expect(page.locator('.pix-timer-label')).toHaveText('O tempo para você pagar acaba em:');
  await expect(page.locator('#pixCountdown')).toHaveText(/^\d{2}:\d{2}$/);

  // Cartão do pedido: loja, número e total em destaque.
  await expect(page.locator('#pixOrderStore')).not.toBeEmpty();
  await expect(page.locator('#pixOrderNumber')).toContainText(String(pixOrder(1).order_number));
  await expect(page.locator('#pixOrderTotal')).toContainText('22,14');

  // Com código na tela, o link do checkout não aparece: ele é saída de
  // emergência, e ao lado do botão de copiar só competia com a ação principal.
  await expect(page.locator('#pixCheckoutLink')).toBeHidden();

  // Textos que saíram de vez — nenhum dizia algo acionável.
  await expect(page.locator('#pixPaymentModal')).not.toContainText('segue para a cozinha');
  await expect(page.locator('#pixPaymentModal')).not.toContainText('Conferindo o pagamento');
});

test('a cobrança ocupa a tela inteira, sem cara de pop-up sobre a loja', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });
  await page.setViewportSize({ width: 390, height: 844 });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  const panel = page.locator('#pixPaymentModal .modal');
  const viewport = page.viewportSize();

  // Encosta nas quatro bordas: nada da loja aparece em volta. O poll é pela
  // animação de entrada, que desliza o painel a partir da lateral — medir antes
  // dela assentar leria a posição do meio do caminho.
  await expect.poll(async () => (await panel.boundingBox()).x).toBe(0);
  const box = await panel.boundingBox();
  expect(box.y).toBe(0);
  expect(box.width).toBe(viewport.width);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height);

  // Sem canto arredondado e sem a alça de arrastar, que são de folha.
  const radius = await panel.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe('0px');
  await expect(page.locator('#pixPaymentModal .sheet-drag')).toHaveCount(0);
});

test('o rodapé traz a ação principal, full-width e na cor da marca', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  const cta = page.locator('#pixCopyBtn');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveText('Copiar código');

  // Full-width: ocupa a largura do rodapé, descontado o respiro dele.
  const ctaBox = await cta.boundingBox();
  const footerBox = await page.locator('#pixFooter').boundingBox();
  expect(ctaBox.width).toBeGreaterThan(footerBox.width - 40);

  // Cor da MARCA, não uma cor fixa. A prova é repintar o tenant e ver a tela
  // inteira acompanhar: se algum destes tivesse cor chumbada, ficaria laranja
  // numa loja azul. O poll existe por causa da transição de 0.2s do botão.
  await page.evaluate(() => window.RapidexTheme.applyBrandTheme('#1652f0'));
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.getElementById('pixCopyBtn')).backgroundColor)
    )
    .toBe('rgb(22, 82, 240)');

  expect(
    await page.evaluate(() => ({
      barra: getComputedStyle(document.getElementById('pixCountdownBar')).backgroundColor,
      iconeCopiar: getComputedStyle(document.querySelector('.pix-code-copy')).color,
      ilustracao: getComputedStyle(document.querySelector('.pix-art-solid')).fill
    }))
  ).toEqual({
    barra: 'rgb(22, 82, 240)',
    iconeCopiar: 'rgb(22, 82, 240)',
    ilustracao: 'rgb(22, 82, 240)'
  });

  // "Como funciona" é a exceção deliberada: cinza de texto corrido, para não
  // competir com a ação principal. Não pode voltar a puxar a cor da marca.
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.pix-howto-link')).color)
  ).toBe('rgb(102, 102, 102)');
});

test('"Como funciona" abre o passo a passo em três etapas', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  const sheet = page.locator('#pixHowTo');
  await expect(sheet).toBeHidden();

  await page.getByRole('button', { name: 'Como funciona' }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.pix-howto-steps li')).toHaveCount(3);

  // A folha é ajuda: fechá-la devolve a cobrança intacta.
  await page.getByRole('button', { name: 'Entendi' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#pixCopyCode')).toHaveText(PIX_QR_CODE);
});

test('"Ver itens do pedido" expande a conferência do que foi pedido', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page); // 3 x Água 500ml, montados pelo helper
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  const toggle = page.locator('#pixItemsToggle');
  const items = page.locator('#pixOrderItems');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(items).toBeHidden();

  await toggle.click();
  await expect(items).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(items.locator('.pix-order-item')).toHaveCount(1);
  await expect(items).toContainText('3x');
  await expect(items).toContainText('21,15'); // 3 x R$ 7,05

  await toggle.click();
  await expect(items).toBeHidden();
});

test('o texto de consequência anuncia o prazo e o cancelamento', async ({ page }) => {
  // O prazo sai de PIX_POLL_WINDOW_MS, a mesma janela do contador: se um dia
  // alguém mudar a constante, este teste é que pega o texto ficando para trás.
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  await expect(page.locator('#pixConsequence')).toHaveText(
    'Você tem até 10 minutos para fazer o pagamento. Após esse tempo, o pedido será cancelado.'
  );
});

test('o botão de copiar coloca o payload do Pix na área de transferência', async ({
  page,
  context,
  browserName
}) => {
  test.skip(browserName !== 'chromium', 'permissão de clipboard só é concedível no Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  await page.locator('#pixCopyBtn').click();

  // O retorno é o aviso sobre o cabeçalho — o rótulo do botão não muda.
  const toast = page.locator('#pixToast');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText('PIX copiado com sucesso!');
  await expect(page.locator('#pixCopyBtnLabel')).toHaveText('Copiar código');

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(PIX_QR_CODE);

  // E some sozinho, sem deixar o cabeçalho coberto.
  await expect(toast).toBeHidden({ timeout: 6000 });

  // O ícone ao lado do código copia o MESMO payload: o campo mostra um trecho,
  // mas o que vai para a área de transferência é o código inteiro.
  await page.evaluate(() => navigator.clipboard.writeText('sujeira'));
  await page.locator('#pixCopyInlineBtn').click();
  await expect(toast).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PIX_QR_CODE);
});

test('sair da cobrança pede confirmação, e "Voltar para PIX" não cancela nada', async ({
  page
}) => {
  const { paymentRequests } = await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  const confirm = page.locator('#pixExitConfirm');
  await expect(confirm).toBeHidden();

  // Os DOIS botões do cabeçalho levam ao mesmo aviso: voltar e fechar.
  for (const label of ['Voltar', 'Fechar']) {
    await page.locator(`#pixPaymentModal .cart-hdr [aria-label="${label}"]`).click();
    await expect(confirm).toBeVisible();
    await expect(page.locator('#pixExitTitle')).toHaveText('Atenção');

    // "Voltar para PIX" só desce a folha: a tela continua na cobrança e
    // nenhuma requisição nova é feita.
    await page.getByRole('button', { name: 'Voltar para PIX' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator('[data-pix-state=ready]')).toBeVisible();
    await expect(page.locator('#pixCopyCode')).toHaveText(PIX_QR_CODE);
  }

  expect(paymentRequests).toHaveLength(1);
});

test('"Cancelar pedido" sai da cobrança sem um segundo aviso', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  await page.locator('#pixPaymentModal .cart-hdr [aria-label="Fechar"]').click();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();

  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);
  await expect(page.locator('#pixExitConfirm')).toBeHidden();
  // Nenhum aviso extra fica na tela depois da saída.
  await expect(page.locator('#pixToast')).toBeHidden();
});

test('o contador e a barra de progresso andam para trás juntos', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  const countdown = page.locator('#pixCountdown');
  await expect(countdown).toHaveText(/^\d{2}:\d{2}$/);

  const toSeconds = async () => {
    const text = (await countdown.textContent()) || '';
    const [, m, s] = text.match(/(\d{2}):(\d{2})/) || [];
    return Number(m) * 60 + Number(s);
  };
  // A largura em % é o que o JS escreve; medir o estilo inline evita depender
  // da transição de CSS, que interpola a largura em pixels.
  const toPercent = async () =>
    Number((await page.locator('#pixCountdownBar').getAttribute('style'))?.match(/([\d.]+)%/)?.[1]);

  const firstSeconds = await toSeconds();
  const firstPercent = await toPercent();
  // A janela de espera é de 10 min — o contador nasce nela, não em zero, e a
  // barra nasce cheia.
  expect(firstSeconds).toBeGreaterThan(9 * 60);
  expect(firstPercent).toBeGreaterThan(95);

  await expect.poll(toSeconds, { timeout: 8000 }).toBeLessThan(firstSeconds);
  // A barra mede a MESMA janela do número: se ela não anda junto, uma das duas
  // está mentindo sobre o prazo.
  expect(await toPercent()).toBeLessThan(firstPercent);
});

test('detecta o pagamento pelo polling e leva à tela de sucesso, parando de consultar', async ({
  page
}) => {
  // Pendente nas duas primeiras consultas, pago na terceira.
  const { trackRequests } = await mockApi(page, {
    orderResponse: pixOrder,
    onTrackOrder: (route, _request, attempt) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          trackedOrder(
            attempt >= 3
              ? { payment_status: 'paid', status: 'confirmed' }
              : { payment_status: 'pending' }
          )
        )
      })
  });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  // O intervalo é de 5s; 3 consultas levam ~15s.
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/, { timeout: 30000 });
  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);
  await expect(page.locator('#ordSuccessPaymentRow')).toBeVisible();
  await expect(page.locator('#ordSuccessPayment')).toHaveText('Pago');
  await expect(page.locator('#ordSuccessStatus')).toHaveText('Confirmado');
  await expect(page.locator('#ordSuccessMessage')).toContainText('Pagamento confirmado');

  // PAROU: nenhuma consulta nova depois do pagamento confirmado.
  const afterPaid = trackRequests.length;
  await page.waitForTimeout(12000);
  expect(trackRequests.length, 'o polling continuou depois de pago').toBe(afterPaid);
});

test('o pagamento confirmado apaga a pendência guardada para a loja', async ({ page }) => {
  await mockApi(page, {
    orderResponse: pixOrder,
    onTrackOrder: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(trackedOrder({ payment_status: 'paid', status: 'confirmed' }))
      })
  });

  await submitPixOrder(page);
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/, { timeout: 30000 });

  const stored = await page.evaluate((slug) => window.RapidexOrderTracking.latest(slug), SLUG);
  expect(stored.payment_status).toBe('paid');
  await expect(page.locator('#pendingPaymentBar')).toBeHidden();
});

test('falha do gateway vira mensagem clara, sem sugerir refazer o pedido', async ({ page }) => {
  const { paymentRequests } = await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: (route, _request, attempt) =>
      attempt === 1
        ? route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'gateway indisponível' })
          })
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(pixCharge())
          })
  });

  await submitPixOrder(page);

  await expect(page.locator('[data-pix-state=error]')).toBeVisible();
  const message = page.locator('#pixErrorMessage');
  await expect(message).toContainText('provedor de pagamento');
  // O pedido JÁ existe: a mensagem não pode empurrar o cliente a pedir de novo.
  await expect(message).toContainText('pedido continua registrado');
  await expect(message).not.toContainText(/criar o pedido/i);

  // Retentar cria a cobrança de novo, sem tocar no pedido.
  await page.locator('#pixRetryBtn').click();
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();
  expect(paymentRequests).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// `detail` como OBJETO (PaymentErrorDetail: code + retryable).
//
// ⚠️ Este schema NÃO está no OpenAPI publicado — `POST .../payment` declara só
// 200 e 422. Os testes abaixo fixam o comportamento pelos campos que o backend
// informou (`code`, `retryable`) e, principalmente, fixam o que vale para
// QUALQUER formato: o cliente nunca lê "[object Object]" e nunca é levado a
// refazer um pedido que já existe.
// ---------------------------------------------------------------------------

/** Responde a criação da cobrança com um detail em objeto. */
const paymentErrorRoute =
  (detail, status = 402) =>
  (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ detail })
    });

test('erro RETENTÁVEL em objeto: mensagem em português e botão de tentar de novo', async ({
  page
}) => {
  const { paymentRequests } = await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: (route, _request, attempt) =>
      attempt === 1
        ? paymentErrorRoute({ code: 'GATEWAY_TIMEOUT', retryable: true })(route)
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(pixCharge())
          })
  });

  await submitPixOrder(page);

  await expect(page.locator('[data-pix-state=error]')).toBeVisible();
  const message = page.locator('#pixErrorMessage');
  await expect(message).not.toContainText('[object Object]');
  await expect(message).toContainText('pedido continua registrado');
  // O pedido existe: nada de mandar refazer.
  await expect(message).not.toContainText(/refaça|refazer|criar o pedido/i);
  await expect(page.locator('#pixErrorOrder')).toContainText(`#${pixOrder(1).order_number}`);
  // O código do gateway fica à mão para o cliente citar ao suporte.
  await expect(page.locator('#pixErrorCode')).toHaveText('Código do erro: GATEWAY_TIMEOUT');

  // Retentável => o botão existe e funciona, sem tocar no pedido.
  const retry = page.locator('#pixRetryBtn');
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();
  expect(paymentRequests).toHaveLength(2);
});

test('erro DEFINITIVO em objeto: sem botão de retry, orienta outra forma de pagamento', async ({
  page
}) => {
  const { orderRequests, paymentRequests } = await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: paymentErrorRoute({ code: 'PIX_NOT_SUPPORTED', retryable: false })
  });

  await submitPixOrder(page);

  await expect(page.locator('[data-pix-state=error]')).toBeVisible();
  await expect(page.locator('#pixErrorTitle')).toHaveText('Pix indisponível para este pedido');

  const message = page.locator('#pixErrorMessage');
  await expect(message).not.toContainText('[object Object]');
  await expect(message).toContainText('outra forma de pagamento');
  await expect(message).not.toContainText(/refaça|refazer|criar o pedido/i);

  // Retry INÚTIL não é oferecido — este é o ponto do teste.
  await expect(page.locator('#pixRetryBtn')).toBeHidden();
  await expect(page.locator('#pixErrorCode')).toHaveText('Código do erro: PIX_NOT_SUPPORTED');

  // O pedido não pode ter se perdido: número na tela, pedido criado UMA vez,
  // cobrança tentada UMA vez, e a pendência continua guardada para a loja.
  await expect(page.locator('#pixErrorOrder')).toContainText(`#${pixOrder(1).order_number}`);
  expect(orderRequests).toHaveLength(1);
  expect(paymentRequests).toHaveLength(1);

  await page.getByRole('button', { name: 'Voltar para a loja' }).click();
  await expect(page.locator('#pendingPaymentBar')).toBeVisible();
  const saved = await page.evaluate((slug) => window.RapidexOrderTracking.latest(slug), SLUG);
  expect(saved?.tracking_token).toBe(pixOrder(1).tracking_token);
});

test('detail em objeto SEM texto legível nunca vira "[object Object]" na tela', async ({
  page
}) => {
  // O pior caso: o objeto não traz nenhuma frase, só os campos de controle.
  // A tela precisa escrever a frase sozinha.
  await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: paymentErrorRoute({ code: 'UNKNOWN_CODE_FROM_FUTURE', retryable: false })
  });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=error]')).toBeVisible();

  // Nenhum texto visível do modal pode conter a marca de um objeto interpolado.
  const modalText = await page.locator('#pixPaymentModal').innerText();
  expect(modalText).not.toContain('[object Object]');
  expect(modalText).not.toContain('undefined');
  await expect(page.locator('#pixErrorMessage')).not.toBeEmpty();
});

test('409 não manda pagar de novo: o pedido pode já estar pago', async ({ page }) => {
  await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: paymentErrorRoute({ code: 'ORDER_NOT_AWAITING_PAYMENT' }, 409)
  });

  await submitPixOrder(page);

  await expect(page.locator('[data-pix-state=error]')).toBeVisible();
  const message = page.locator('#pixErrorMessage');
  await expect(message).not.toContainText('[object Object]');
  await expect(message).toContainText('já ter sido pago');
  // Nem retry, nem "escolha outra forma de pagamento": as duas levariam a
  // pagar duas vezes.
  await expect(page.locator('#pixRetryBtn')).toBeHidden();
  await expect(message).not.toContainText('outra forma de pagamento');
});

test('cobrança sem QR e sem checkout é dita em voz alta, não vira tela vazia', async ({ page }) => {
  // O próprio OpenAPI avisa: no sandbox o gateway não devolve nenhum dos dois.
  await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pixCharge({ qr_code: null, checkout_url: null }))
      })
  });

  await submitPixOrder(page);

  await expect(page.locator('[data-pix-state=error]')).toBeVisible();
  await expect(page.locator('#pixErrorTitle')).toHaveText('Cobrança sem forma de pagamento');
  await expect(page.locator('#pixErrorMessage')).toContainText('não devolveu o QR Code nem o link');
  // Nem campo de código, nem rodapé de copiar: não há o que copiar.
  await expect(page.locator('#pixCodeField')).toBeHidden();
  await expect(page.locator('#pixFooter')).toBeHidden();
});

test('cobrança só com checkout_url mantém a saída pelo link, sem botão de copiar', async ({
  page
}) => {
  // qr_code e checkout_url são ALTERNATIVOS no contrato. Sem o link, esta
  // cobrança deixaria a tela sem nenhuma saída.
  await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pixCharge({ qr_code: null }))
      })
  });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  const link = page.locator('#pixCheckoutLink');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', pixCharge().checkout_url);

  // O rodapé "Copiar código" não aparece: não existe código para copiar.
  await expect(page.locator('#pixFooter')).toBeHidden();
  await expect(page.locator('#pixCodeField')).toBeHidden();
  // E a instrução para de mandar copiar algo que não está na tela.
  await expect(page.locator('#pixLede')).not.toContainText('Copia e Cola');
});

test('o polling desiste dentro da janela e oferece verificação manual', async ({ page }) => {
  // O relógio da página é controlado para atravessar os 10 minutos sem esperar
  // 10 minutos — é o único jeito de provar que o polling PARA.
  await page.clock.install();
  const { trackRequests } = await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  // O relógio avança de 5 em 5 segundos — o mesmo passo do polling — e nunca
  // mais que isso de uma vez. É deliberado: cada consulta é uma requisição de
  // verdade, e o api-client arma um timer de abort de 8s para ela. Um salto de
  // um minuto dispararia esse abort junto e o teste passaria a medir timeout de
  // rede em vez de expiração da janela.
  const step = async () => {
    await page.clock.runFor(5000);
    await page.waitForTimeout(60); // tempo REAL, para a resposta assentar
  };
  const expired = page.locator('[data-pix-state=expired]');

  // A janela é de 10 min (120 passos). O teto de 150 é folga, não expectativa:
  // o que se afirma é que ele PARA, e bem antes disso.
  for (let i = 0; i < 150 && !(await expired.isVisible()); i++) await step();

  await expect(expired).toBeVisible();
  const afterExpiry = trackRequests.length;
  // 10 min a cada 5s: no máximo ~120 consultas. Nunca infinito.
  expect(afterExpiry).toBeLessThanOrEqual(125);

  for (let i = 0; i < 40; i++) await step();
  expect(trackRequests.length, 'continuou consultando depois de expirar').toBe(afterExpiry);

  // "Verificar agora" faz UMA consulta sob demanda.
  await page.locator('[data-pix-state=expired] .cart-cta-btn').click();
  await expect.poll(() => trackRequests.length, { timeout: 10000 }).toBeGreaterThan(afterExpiry);
});

test('o visitante reencontra o pagamento pendente ao voltar na loja', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });

  await submitPixOrder(page);
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();

  // Sai da tela pela confirmação: o pedido e o tracking_token continuam
  // guardados — sair da cobrança não apaga a pendência.
  await page.locator('#pixPaymentModal .cart-hdr [aria-label="Voltar"]').click();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.locator('#pendingPaymentBar')).toBeVisible();

  // Recarrega a loja como quem volta depois — a pendência sobrevive ao reload.
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  const bar = page.locator('#pendingPaymentBar');
  await expect(bar).toBeVisible();
  await expect(page.locator('#pendingPaymentTitle')).toContainText(`#${pixOrder(1).order_number}`);

  // E leva de volta à cobrança, pelo tracking_token guardado.
  await page.locator('.pending-payment-main').click();
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);
  await expect(page.locator('#pixCopyCode')).toHaveText(PIX_QR_CODE);

  // A conferência do pedido sobrevive ao reload: o carrinho já foi esvaziado e
  // nenhuma rota devolve os itens, então ela só existe porque foi guardada
  // junto do token.
  await page.locator('#pixItemsToggle').click();
  await expect(page.locator('#pixOrderItems')).toContainText('3x');
});

test('o visitante acompanha o pedido pelo tracking_token, sem conta e sem telefone', async ({
  page
}) => {
  const { trackRequests } = await mockApi(page, {
    // Pago na entrega: a tela de sucesso abre direto, mas o token continua
    // sendo o único acesso do visitante ao pedido.
    onTrackOrder: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          trackedOrder({
            payment_flow: 'delivery',
            payment_status: 'not_required',
            status: 'preparing'
          })
        )
      })
  });

  await submitPixOrder(page);
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#ordSuccessStatus')).toHaveText('Aguardando confirmação');

  await page.locator('#ordSuccessTrackBtn').click();

  await expect(page.locator('#ordSuccessStatus')).toHaveText('Em preparo');
  expect(trackRequests).toHaveLength(1);
  // Autorizado só pelo token — nenhum telefone na URL.
  expect(trackRequests[0].url).toContain('/orders/track/');
  expect(trackRequests[0].url).not.toContain('phone=');
});
