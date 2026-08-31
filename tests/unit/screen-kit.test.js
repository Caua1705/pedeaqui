import { describe, it, expect, beforeAll } from 'vitest';

// O screen-kit é INVÓLUCRO: onze das catorze ferramentas delegam a um global
// que já existe. O que estes testes provam não é "a ferramenta funciona" — é
// que a delegação lê o global NA CHAMADA, nunca no import. Um kit que
// congelasse `window.PedeAquiDom.escapeHtml` no import funcionaria em todo
// teste e divergiria em produção no dia em que o dono trocasse a função — a
// mesma fotografia-do-boot da skill §2.1, uma camada acima.

beforeAll(async () => {
  await import('../../scripts/utils/screen-kit.js');
});

const kit = () => window.PedeAquiScreenKit;

describe('a superfície do kit', () => {
  it('publica exatamente as 14 ferramentas do contrato da skill §9', () => {
    expect(Object.keys(kit()).sort()).toEqual([
      'TAB_LOADER_MIN_MS', '$', 'act', 'esc', 'fallback', 'fmt',
      'getRestaurantSlug', 'initials', 'logAppError', 'onlyDigits',
      'releaseFocusFrom', 'setLoading', 'showEl', 'wait'
    ].sort());
  });
});

describe('invólucro lê o global NA CHAMADA, não no import', () => {
  it('esc: o kit foi importado ANTES de PedeAquiDom existir, e mesmo assim delega', () => {
    // Sem o global, o fallback local responde:
    delete window.PedeAquiDom;
    expect(kit().esc('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    // O global aparece DEPOIS do import — um invólucro congelado nunca o veria:
    window.PedeAquiDom = { escapeHtml: () => 'DELEGADO' };
    expect(kit().esc('qualquer')).toBe('DELEGADO');
    delete window.PedeAquiDom;
  });

  it('onlyDigits: idem, com o fallback igual ao do app', () => {
    delete window.PedeAquiValidators;
    expect(kit().onlyDigits('(85) 9 9754-6465')).toBe('85997546465');
    window.PedeAquiValidators = { onlyDigits: () => 'DELEGADO' };
    expect(kit().onlyDigits('x')).toBe('DELEGADO');
    delete window.PedeAquiValidators;
  });

  it('getRestaurantSlug: sem RapidexTenant é vazio, nunca um tenant inventado', () => {
    delete window.RapidexTenant;
    expect(kit().getRestaurantSlug()).toBe('');
    window.RapidexTenant = { resolveSlug: () => 'loja-x' };
    expect(kit().getRestaurantSlug()).toBe('loja-x');
    delete window.RapidexTenant;
  });
});

describe('act — o mesmo encoding do restaurant-page', () => {
  it('sem argumentos vai o nome cru; com argumentos vai JSON escapado', () => {
    delete window.PedeAquiDom;
    expect(kit().act('click', 'fechar')).toBe('data-act-click="fechar"');
    expect(kit().act('click', 'abrir', 'id-1')).toBe(
      'data-act-click="[&quot;abrir&quot;,&quot;id-1&quot;]"'
    );
  });

  it('aspa dentro de argumento não escapa do atributo', () => {
    const attr = kit().act('click', 'abrir', 'a"b');
    const valor = attr.slice('data-act-click="'.length, -1);
    expect(valor.includes('"'), 'aspa crua dentro do valor do atributo').toBe(false);
    // E a dupla neutralização volta intacta na leitura: JSON.parse do valor
    // desescapado devolve o argumento original.
    expect(JSON.parse(valor.replace(/&quot;/g, '"'))).toEqual(['abrir', 'a"b']);
  });
});

describe('setLoading — deduplica no appState do appPort e avisa o store', () => {
  it('mesmo valor duas vezes só avisa o store uma vez', () => {
    const chamadas = [];
    window.PedeAquiAppPort = { appState: { loading: {} } };
    window.PedeAquiRestaurantStore = { setLoading: (scope, active) => chamadas.push([scope, active]) };
    kit().setLoading('menu', true);
    kit().setLoading('menu', true);
    kit().setLoading('menu', false);
    expect(chamadas).toEqual([['menu', true], ['menu', false]]);
    delete window.PedeAquiAppPort;
    delete window.PedeAquiRestaurantStore;
  });
});
