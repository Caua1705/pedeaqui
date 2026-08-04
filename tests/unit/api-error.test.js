import { describe, it, expect, beforeAll } from 'vitest';

// O que este arquivo protege é uma frase que o cliente NUNCA pode ler:
// "[object Object]". O `detail` da API chega em três formatos diferentes
// (string, array de 422, objeto estruturado do pagamento) e todos passam por
// aqui antes de virar texto de tela.

let apiError;

beforeAll(async () => {
  await import('../../scripts/utils/api-error.js');
  apiError = window.PedeAquiApiError;
});

/** Nenhuma saída deste módulo pode conter a marca de um objeto interpolado. */
function expectNoObjectObject(value) {
  expect(String(value)).not.toContain('[object Object]');
}

describe('detailText', () => {
  it('devolve a string como veio', () => {
    expect(apiError.detailText('cupom expirado')).toBe('cupom expirado');
  });

  it('junta as mensagens do array de validação do FastAPI', () => {
    const detail = [
      { loc: ['body', 'items'], msg: 'campo obrigatório', type: 'missing' },
      { loc: ['body', 'branch_id'], msg: 'uuid inválido', type: 'uuid_parsing' }
    ];
    expect(apiError.detailText(detail)).toBe('campo obrigatório; uuid inválido');
  });

  it('lê o texto humano de um detail em objeto', () => {
    expect(apiError.detailText({ code: 'GATEWAY_DOWN', message: 'provedor fora do ar' }))
      .toBe('provedor fora do ar');
  });

  it('devolve string vazia — não "[object Object]" — para objeto sem texto', () => {
    const text = apiError.detailText({ code: 'CARD_DECLINED', retryable: false });
    expect(text).toBe('');
    expectNoObjectObject(text);
  });

  it('não estoura nem vaza objeto em estrutura auto-referente', () => {
    const detail = { code: 'X' };
    detail.detail = detail; // ciclo
    const text = apiError.detailText(detail);
    expectNoObjectObject(text);
  });

  it('trata nulo, indefinido e array vazio como ausência de texto', () => {
    expect(apiError.detailText(null)).toBe('');
    expect(apiError.detailText(undefined)).toBe('');
    expect(apiError.detailText([])).toBe('');
  });

  it('ignora entradas sem texto dentro do array', () => {
    expect(apiError.detailText([{ loc: ['body'] }, { msg: 'valor inválido' }]))
      .toBe('valor inválido');
  });
});

describe('errorMessage', () => {
  it('prefere o detail ao message técnico do api-client', () => {
    const error = Object.assign(new Error('API request failed: 409'), {
      status: 409,
      detail: 'cupom já utilizado',
      data: { detail: 'cupom já utilizado' }
    });
    expect(apiError.errorMessage(error, 'fallback')).toBe('cupom já utilizado');
  });

  it('cai no fallback em português quando o detail é objeto sem texto', () => {
    const error = Object.assign(new Error('API request failed: 402'), {
      status: 402,
      detail: { code: 'INSUFFICIENT_FUNDS', retryable: false },
      data: { detail: { code: 'INSUFFICIENT_FUNDS', retryable: false } }
    });
    const message = apiError.errorMessage(error, 'Não foi possível cobrar.');
    expect(message).toBe('Não foi possível cobrar.');
    expectNoObjectObject(message);
  });

  it('nunca devolve o texto técnico "API request failed"', () => {
    const error = Object.assign(new Error('API request failed: 500'), { status: 500 });
    expect(apiError.errorMessage(error, 'Tente de novo.')).toBe('Tente de novo.');
  });
});

describe('paymentErrorInfo', () => {
  const paymentError = (detail, status = 402) =>
    Object.assign(new Error('x'), { status, detail, data: { detail } });

  it('lê code e retryable do objeto estruturado', () => {
    const info = apiError.paymentErrorInfo(paymentError({ code: 'GATEWAY_TIMEOUT', retryable: true }));
    expect(info).toMatchObject({ code: 'GATEWAY_TIMEOUT', retryable: true, structured: true });
  });

  it('respeita retryable=false mesmo em erro 5xx', () => {
    // A flag do backend manda: ela sabe mais sobre a recusa do que o status.
    const info = apiError.paymentErrorInfo(paymentError({ code: 'CARD_DECLINED', retryable: false }, 500));
    expect(info.retryable).toBe(false);
  });

  it('trata detail string (formato antigo) sem quebrar', () => {
    const info = apiError.paymentErrorInfo(paymentError('gateway indisponível', 502));
    expect(info).toMatchObject({ code: '', structured: false, text: 'gateway indisponível' });
    // Sem flag, um 5xx é tratado como transitório.
    expect(info.retryable).toBe(true);
  });

  it('sem flag e sem status conhecido, assume NÃO retentável', () => {
    // O caro é oferecer um botão que só vai falhar de novo.
    const info = apiError.paymentErrorInfo(paymentError({ code: 'SOMETHING_NEW' }, 402));
    expect(info.retryable).toBe(false);
  });

  it('marca timeout e falha de rede como retentáveis', () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError', isTimeout: true });
    const offline = Object.assign(new Error('n'), { name: 'NetworkError', isNetworkError: true });
    expect(apiError.paymentErrorInfo(timeout).retryable).toBe(true);
    expect(apiError.paymentErrorInfo(offline).retryable).toBe(true);
  });

  it('não produz "[object Object]" em nenhum campo', () => {
    const info = apiError.paymentErrorInfo(paymentError({ code: 'X', retryable: false, ctx: { a: 1 } }));
    Object.values(info).forEach(expectNoObjectObject);
  });
});
