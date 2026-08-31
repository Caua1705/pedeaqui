import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, INFO, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  O horário de funcionamento, com os NOMES e a NUMERAÇÃO do contrato.
//
//  BusinessHourDayResponse manda o rótulo pronto (day_label: "Segunda-feira")
//  e o weekday em 0=SEGUNDA (o datetime.weekday() do Python). O renderizador
//  lia display_name/day_name/label — três nomes que nunca existiram — e caía
//  num mapa 1..7: a primeira linha do modal saía "0", e os demais dias
//  apareciam DESLOCADOS em um. Nenhum teste abria o modal de informações.
//
//  O rodapé é da mesma família: lia opening_hours_text (nunca existiu) e a
//  linha de horário ficava escondida para sempre — hoje ele mostra o dia de
//  HOJE a partir dos periods do /info. (O chip "fecha às" do cabeçalho não
//  entrou: #mobCloseTime nem existe no markup — código fantasma removido.)
// ============================================================================

async function abrirInfoModal(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('openRestaurantInfo')());
  await expect(page.locator('#infoModal')).toHaveClass(/active/);
  await expect(page.locator('#infoModal .store-hours-row')).toHaveCount(INFO.business_hours.length);
}

test('cada dia sai com o day_label do contrato — sem "0" e sem dias deslocados', async ({ page }) => {
  await abrirInfoModal(page);
  const labels = await page.locator('#infoModal .store-hours-row span').allTextContents();
  expect(labels).toEqual(INFO.business_hours.map(day => day.day_label));
});

test('a linha destacada é a de HOJE: current_weekday casando com weekday por número', async ({ page }) => {
  await abrirInfoModal(page);
  const hoje = INFO.business_hours.find(day => day.weekday === INFO.current_weekday);
  await expect(page.locator('#infoModal .store-hours-row.active span')).toHaveText(hoje.day_label);
});

test('o rodapé mostra o horário de HOJE a partir dos periods do /info', async ({ page }) => {
  await abrirInfoModal(page);
  const hoje = INFO.business_hours.find(day => day.weekday === INFO.current_weekday);
  const abre = hoje.periods[0].opens_at.slice(0, 5);
  const fecha = hoje.periods[hoje.periods.length - 1].closes_at.slice(0, 5);
  const rodape = page.locator('#footerHours');
  await expect(rodape).toHaveText(`Hoje: ${abre} às ${fecha}`);
});
