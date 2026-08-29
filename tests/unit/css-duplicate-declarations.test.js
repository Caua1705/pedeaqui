import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

// ============================================================================
//  A folha nao pode brigar com ela mesma.
//
//  Em 29/08/2026 a auditoria encontrou 3.222 declaracoes que a cascata ja
//  descartava: mesma folha, mesmo seletor, mesma media query, mesma
//  propriedade, escritas duas ou mais vezes. Como a especificidade e identica,
//  so a ultima tem efeito — todas as outras eram letra morta desde o dia em que
//  foram escritas.
//
//  Elas nao eram inofensivas: eram a metade da razao de existir dos !important.
//  Alguem escrevia a regra de novo em vez de achar a primeira, nao funcionava
//  (porque a primeira estava DEPOIS no arquivo), e a saida era !important. As
//  duas coisas se alimentavam.
//
//  Este teste barra a reincidencia. Ele nao pede que o CSS seja bonito: pede
//  que a mesma regra nao seja escrita duas vezes no mesmo arquivo.
// ============================================================================

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Parser suficiente para este repo: sem CSS nesting, sem vírgula dentro de
 * :has()/:is()/:not() (verificado — nenhuma existe). Devolve uma declaração por
 * seletor, com o contexto de at-rule, que é o que decide a disputa de cascata.
 */
function declaracoes(css) {
  const semComentario = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const saida = [];
  const pilha = [];
  let buffer = '';
  let i = 0;

  while (i < semComentario.length) {
    const c = semComentario[i];

    if (c === '{') {
      const cabeca = buffer.trim();
      buffer = '';
      if (cabeca.startsWith('@')) {
        pilha.push(cabeca);
        i += 1;
        continue;
      }
      let profundidade = 1;
      let j = i + 1;
      while (j < semComentario.length && profundidade > 0) {
        if (semComentario[j] === '{') profundidade += 1;
        else if (semComentario[j] === '}') profundidade -= 1;
        j += 1;
      }
      const corpo = semComentario.slice(i + 1, j - 1);
      for (const sel of cabeca.split(',').map((s) => s.trim()).filter(Boolean)) {
        for (const decl of corpo.split(';')) {
          const corte = decl.indexOf(':');
          if (corte < 0) continue;
          const prop = decl.slice(0, corte).trim().toLowerCase();
          // Custom property fica de fora: redeclarar --x é como o tema funciona.
          if (!prop || prop.startsWith('--')) continue;
          saida.push({ sel, media: pilha.join(' && '), prop });
        }
      }
      i = j;
      continue;
    }

    if (c === '}') {
      pilha.pop();
      buffer = '';
      i += 1;
      continue;
    }

    buffer += c;
    i += 1;
  }
  return saida;
}

// Grupos que sobreviveram à limpeza e que o parser não consegue separar com
// segurança (seletores com vírgula onde só um dos lados repete). Número, e não
// lista, de propósito: a lista teria 186 linhas e ninguém a leria. O que este
// teste protege é a DIREÇÃO — o número não pode subir.
const TETO_CONHECIDO = 186;

describe('nenhuma folha declara a mesma coisa duas vezes', () => {
  it(`no maximo ${TETO_CONHECIDO} grupos repetidos, e a divida nao cresce`, () => {
    const folhas = globSync('styles/*.css', { cwd: ROOT }).map((rel) => ({
      nome: basename(rel),
      css: readFileSync(resolve(ROOT, rel), 'utf8')
    }));
    expect(folhas.length, 'as folhas foram encontradas').toBeGreaterThan(10);

    const contagem = new Map();
    for (const { nome, css } of folhas) {
      for (const { sel, media, prop } of declaracoes(css)) {
        const chave = `${nome}|${media}|${sel}|${prop}`;
        contagem.set(chave, (contagem.get(chave) || 0) + 1);
      }
    }

    const repetidos = [...contagem.entries()].filter(([, n]) => n > 1);
    const amostra = repetidos.slice(0, 12).map(([k, n]) => `  ${n}x  ${k}`);

    expect(
      repetidos.length,
      `Ha ${repetidos.length} grupos com a mesma regra escrita duas vezes (teto: ${TETO_CONHECIDO}).\n`
        + `So a ULTIMA tem efeito — as outras sao letra morta e costumam virar !important.\n`
        + `Se voce acabou de escrever uma delas, edite a regra que ja existe.\n`
        + `Se voce REMOVEU alguma, baixe TETO_CONHECIDO neste arquivo.\n`
        + `Amostra:\n${amostra.join('\n')}`
    ).toBeLessThanOrEqual(TETO_CONHECIDO);
  });
});
