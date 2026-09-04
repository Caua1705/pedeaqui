import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Formatadores puros de /info, contra o FIXTURE DO CONTRATO (info.json é
// cópia fiel da produção). O caso que dá nome a este arquivo: o horário de
// funcionamento já mostrou "0" como primeiro dia e deslocou a semana inteira
// em um, porque o renderizador ignorava day_label e usava um mapa 1..7 num
// contrato em que weekday é 0=SEGUNDA.

const here = dirname(fileURLToPath(import.meta.url));
const INFO = JSON.parse(readFileSync(resolve(here, '..', 'fixtures', 'info.json'), 'utf8'));

let F;
beforeAll(async () => {
  // `formatWhatsappHref` delega para o dono único do link de contato — a mesma
  // ordem do entry-restaurant.js, onde contact-link vem antes.
  await import('../../scripts/utils/contact-link.js');
  await import('../../scripts/services/store-info-format.js');
  F = window.PedeAquiStoreInfoFormat;
});

describe('formatWeekday', () => {
  it('usa o day_label pronto do backend, para TODOS os dias do fixture', () => {
    for (const day of INFO.business_hours) {
      expect(F.formatWeekday(day)).toBe(day.day_label);
    }
  });

  it('sem day_label, o fallback segue a numeração DO CONTRATO: 0=Segunda', () => {
    expect(F.formatWeekday({ weekday: 0 })).toBe('Segunda-feira');
    expect(F.formatWeekday({ weekday: 6 })).toBe('Domingo');
    // O mapa antigo (1..7) devolvia "0" para segunda e deslocava o resto.
    expect(F.formatWeekday({ weekday: 1 })).toBe('Terça-feira');
  });
});

describe('formatHoursLine', () => {
  it('junta os períodos com "às", como a tela escreve', () => {
    expect(F.formatHoursLine({ periods: [{ opens_at: '10:00', closes_at: '15:00' }, { opens_at: '18:00', closes_at: '23:30' }] }))
      .toBe('10:00 às 15:00 - 18:00 às 23:30');
  });

  it('is_closed vence qualquer período', () => {
    expect(F.formatHoursLine({ is_closed: true, periods: [{ opens_at: '10:00', closes_at: '22:00' }] })).toBe('Fechado');
  });

  it('sem período legível, é Fechado — não uma linha vazia', () => {
    expect(F.formatHoursLine({ periods: [] })).toBe('Fechado');
    expect(F.formatHoursLine({})).toBe('Fechado');
  });

  it('corta segundos: "10:00:00" vira "10:00"', () => {
    expect(F.formatHoursLine({ periods: [{ opens_at: '10:00:00', closes_at: '22:30:00' }] })).toBe('10:00 às 22:30');
  });
});

describe('todayHours', () => {
  it('acha o dia de hoje casando current_weekday com weekday por NÚMERO', () => {
    const today = F.todayHours(INFO);
    expect(today).not.toBeNull();
    expect(today.weekday).toBe(INFO.current_weekday);
    expect(today.day_label).toBe(INFO.current_day_label);
  });

  it('sem business_hours não inventa dia', () => {
    expect(F.todayHours({})).toBeNull();
    expect(F.todayHours(null)).toBeNull();
  });
});

describe('formatFullAddress', () => {
  it('full_address pronto do backend vence a montagem local', () => {
    expect(F.formatFullAddress({ full_address: 'Rua X, 1 - Centro', street: 'Outra' })).toBe('Rua X, 1 - Centro');
  });

  it('monta das partes quando não há full_address', () => {
    expect(F.formatFullAddress({ street: 'Rua Silva Paulet', number: '450', neighborhood: 'Aldeota', city: 'Fortaleza', state: 'CE' }))
      .toBe('Rua Silva Paulet, 450 - Aldeota - Fortaleza - CE');
  });

  it('endereço do fixture de produção sai numa linha não vazia', () => {
    expect(F.formatFullAddress(INFO.branch.address)).not.toBe('');
  });
});

describe('formatWhatsappHref', () => {
  it('acrescenta o 55 quando falta e preserva quando já tem', () => {
    expect(F.formatWhatsappHref('(85) 9 9754-6465')).toBe('https://wa.me/5585997546465');
    expect(F.formatWhatsappHref('5585997546465')).toBe('https://wa.me/5585997546465');
  });

  it('sem dígitos não há link', () => {
    expect(F.formatWhatsappHref('')).toBe('');
    expect(F.formatWhatsappHref(null)).toBe('');
  });
});

describe('formatPaymentGroupLabel', () => {
  it('cobre os cinco method_type da tela', () => {
    expect(F.formatPaymentGroupLabel('credit')).toBe('Crédito');
    expect(F.formatPaymentGroupLabel('debit')).toBe('Débito');
    expect(F.formatPaymentGroupLabel('cash')).toBe('Dinheiro');
    expect(F.formatPaymentGroupLabel('pix')).toBe('PIX na entrega');
    expect(F.formatPaymentGroupLabel('voucher')).toBe('Vale-refeição / alimentação');
  });

  it('tipo desconhecido devolve vazio — quem chama decide o que fazer', () => {
    expect(F.formatPaymentGroupLabel('bitcoin')).toBe('');
  });
});

describe('formatBranchLabel', () => {
  it('display_name vence name, e o vazio vira Unidade', () => {
    expect(F.formatBranchLabel({ display_name: 'Matriz Aldeota', name: 'Matriz' })).toBe('Matriz Aldeota');
    expect(F.formatBranchLabel({ name: 'Matriz' })).toBe('Matriz');
    expect(F.formatBranchLabel({})).toBe('Unidade');
  });
});
