# Rodada de fechamento do front — FONTE DA VERDADE (rodada/checkout)

Sessão iniciada 31/08/2026. Branch `rodada/checkout`, a partir de `bd325f7`
(main). NUNCA commitar na main.

## Regras desta rodada (do prompt, resumidas)

- Um commit por item, verde, com push. Este arquivo atualizado no MESMO commit.
- Ao retomar depois de compactação: RELER ESTE ARQUIVO PRIMEIRO. Ele vence a
  lembrança.
- **Portão lido SEM pipe.** `| tail` engole o exit code e já mentiu três vezes.
- **Antes de QUALQUER medição de E2E:** matar node órfão e conferir a porta 4174
  livre. Obrigatório, não higiene opcional.
  - PowerShell: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` e
    `Get-NetTCPConnection -LocalPort 4174 -State Listen`.
- **REGRA DE DINHEIRO (item 3):** nenhum commit da seção 3 pode mudar um valor
  que o cliente vê ou paga. Número que muda = defeito achado = commit SEPARADO
  do movimento, com teste próprio. Nunca no mesmo commit: mover código e
  corrigir cálculo.
- Fora da rodada: login Google · fluxo novo de cupons · backend · merge na main.
- Parar se: flakes não fecharem 3 verdes · número de dinheiro mudar sem motivo
  conhecido · item exigir backend · escapes pendentes > 8 · mesmo portão
  vermelho 3x no mesmo item.

## A máquina (medido nesta sessão, e é parte da causa)

8 núcleos lógicos, **8 GB de RAM**. Durante a suíte E2E a memória livre cai
para ~430 MB. `playwright.config.js` usa `workers: undefined` fora do CI =
**4 workers** = 4 Chromiums + `vite preview`. A "carga" dos flakes é isto.

## Ordem de execução e status

Legenda: [ ] pendente · [~] em andamento · [x] feito+commitado+push · [!] bloqueado

### Item 1 — os 5 flakes (BLOQUEANTE)
- [x] 1.1 assistant-product-detail.spec.js:4 — CAUSA ACHADA E CORRIGIDA
- [ ] 1.2 assistant-voice-session.spec.js:294
- [ ] 1.3 assistant-voice-session.spec.js:668
- [ ] 1.4 auth-screen-nav.spec.js:105
- [ ] 1.5 order-flow.spec.js:163
- [ ] 1.6 PORTÃO: suíte completa verde 3x seguidas (+ 20 execuções de prova)

### Item 2 — limpeza que destrava
- [ ] 2.1 os 12 defeitos recusados sob a régua do fallback defensivo
- [ ] 2.2 deploy opção C (vercel.json + ci.yml)

### Item 3 — sacola, checkout e filial
- [ ] 3.1 inventário do que resta no restaurant-page.js
- [ ] 3.2 rede: unitários de cartTotals e da cadeia de preço COMO ESTÁ HOJE
- [ ] 3.3 migração na ordem do inventário
- [ ] 3.4 troca de filial (ÚLTIMA)
- [ ] 3.5 folha de confirmação (escreve token de cartão — decidir por medida)

## Medições

### Baseline 01 — suíte completa, máquina limpa (31/08/2026)
Comando: `npm run test:e2e` sem pipe, saída em `scratchpad/e2e-baseline-01.log`.
Higiene conferida antes: 0 processos node, porta 4174 livre.
RESULTADO: **exit 1 · 288 passed · 1 failed · 3 skipped · 5,8 min.**
Único vermelho: `assistant-product-detail.spec.js:4`, e ele caiu como teste
**#18 de 292** — cedo, com a máquina ainda folgada. Os outros quatro flakes
passaram nesta execução.

## Item 1 — os cinco flakes, um a um

### 1.1 `assistant-product-detail.spec.js:4` — RESOLVIDO

**Falha observada** (baseline 01, e reproduzida 1 em 3 isolada):
```
Expected: "flex"   Received: "none"
> 46 | expect(await detail.evaluate(el => getComputedStyle(el).display)).toBe('flex');
```

**Causa.** O teste afirmava sobre um INSTANTE governado por um relógio de
parede. `assistantCloseProductDetail()` devolve o `hidden` num
`setTimeout(..., 540)`; o teste fazia `waitForTimeout(120)` e perguntava o
`display` DE FORA. Entre o clique e a pergunta havia ainda dois `expect.poll`
lendo `getAnimations()` — cada um um ida-e-volta pelo protocolo. Sob quatro
workers a soma passou dos 540 ms, o `hidden` já tinha voltado, e a resposta
foi `none`. **O teste media a máquina, não o app.** Nem o `getAnimations()`
servia: ele só responde `true` enquanto a transição AINDA corre, o que é a
mesma aposta contra o relógio, na direção oposta.

**Correção.** A sonda passou a viver DENTRO da página e a medir contra o
relógio da própria animação. No `transitionrun` de `transform` da saída ela
lê a duração que o CSS declara (`getComputedStyle(painel).transitionDuration`
= 520 ms) e conta, em quadros de animação, quantos ms o diálogo continuou
`display:flex`. A asserção é `desenhadoAteMs >= transicaoMs`. Nada disso
depende de quando a pergunta do Playwright chega: uma máquina lenta só
aumenta o número medido, que é o lado seguro.

**Ganho de cobertura de brinde:** o teste antigo não pegava alongar a
transição no CSS sem alongar o temporizador do JS. Este pega, porque compara
os dois números.

**Visto vermelho, dois defeitos reinjetados:**
1. temporizador de 540 → 200 ms: `o painel parou de ser desenhado 212 ms
   depois do começo da saída, e o CSS declara 520 ms` (Expected >= 520,
   Received 212).
2. `detail.hidden = true` imediato (a classe do defeito original): a saída
   nem começa — `fechamento` fica `[]` e o teste morre nomeando a metade que
   faltou.

**Prova:** 5/5 execuções isoladas verdes depois da correção (antes: 2/3).
Portões: lint 0 errors/78 warnings (a linha de base) · typecheck ok ·
287 unitários.

## Escapes pendentes (manter ≤ 8)
(nenhum ainda)

## Bloqueados por backend
(nenhum ainda)

## Decisões tomadas sem o usuário
(nenhuma ainda)
