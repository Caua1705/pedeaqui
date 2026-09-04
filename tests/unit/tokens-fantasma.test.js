import { describe, it, expect } from 'vitest';
import { inventario, semComentarios } from '../../tools/tokens-fantasma.mjs';

// ============================================================================
//  NENHUM `var(--x)` PODE NOMEAR UM TOKEN QUE NINGUÉM DEFINE.
//
//  É a §12.1 (nome fantasma) dentro do CSS, e a razão de existir uma guarda em
//  vez de só uma ferramenta é que esta classe não deixa rastro em NENHUM dos
//  quatro portões: o lint lê JavaScript; o vitest não abre folha; e o e2e vê a
//  tela funcionando, porque `var(--nao-existe, #c0392b)` cai no fallback sem
//  reclamar. A captura de telas também não pega: um token fantasma é ESTÁVEL,
//  então "antes" e "depois" são iguais e ela responde "Nenhuma diferença" com
//  toda a razão.
//
//  O que se perde é silencioso e é o coração do white-label: a cor deixa de vir
//  do tema e fica chumbada no fallback, com nome de variável. Foi o que
//  aconteceu com `--brand-on-primary` (o nome certo é `--brand-on`) no bloco do
//  cupom da sacola — o rótulo do botão nunca recebeu a cor da marca, e ninguém
//  soube até o bloco sair por outro motivo.
//
//  ESTE TESTE NÃO JULGA NOME MONTADO EM RUNTIME: a varredura tira do veredito
//  todo `--nome` que apareça dentro de uma string de JS, porque
//  `setProperty(TOKEN, cor)` com `TOKEN` numa constante define o token sem que
//  a string encoste num `:` (§14.3). Subnotificar é o lado seguro — a saída
//  desta varredura autoriza mexer em cor.
// ============================================================================

describe('token fantasma: `var()` de quem ninguém define', () => {
  const inv = inventario();

  // SONDA CONTRA VACUIDADE. Se a varredura parar de casar (mudou a extensão, a
  // pasta, o formato do `var(`), as duas listas ficam vazias, `fantasmas` fica
  // vazio junto e o teste passa por VACUIDADE — a pior forma de passar.
  it('a varredura ainda encontra os dois lados', () => {
    expect(inv.definidos.size).toBeGreaterThan(80);
    expect(inv.consumidos.size).toBeGreaterThan(50);
    // Um par que este app comprovadamente tem dos dois lados.
    expect(inv.definidos.has('--brand-primary')).toBe(true);
    expect(inv.consumidos.has('--brand-primary')).toBe(true);
  });

  it('nenhum `var(--x)` nomeia um token sem dono', () => {
    const lista = inv.fantasmas
      .map(({ nome, usos }) => `${nome} em ${usos.map((u) => `${u.arquivo}:${u.linha}`).join(', ')}`)
      .join('\n  ');
    expect(
      inv.fantasmas,
      lista && `token(s) que ninguém define:\n  ${lista}\n(rode: node tools/tokens-fantasma.mjs)`
    ).toEqual([]);
  });

  // O COMENTÁRIO É A ARMADILHA DESTA VARREDURA, e ela já a pagou: `tokens.css`
  // ensina a regra de uso escrevendo `var(--brand-*)` dentro de um comentário,
  // e sem esta limpeza a lista de fantasmas ganha um `--brand-` que não existe
  // em lugar nenhum do app. Neste repositório o comentário colado na declaração
  // é a REGRA, não a exceção (§5.1, armadilha 1).
  it('comentário sai, e as LINHAS ficam', () => {
    const limpo = semComentarios('a{color:red}\n/* var(--brand-*)\n   segue */\nb{color:blue}');
    expect(limpo).not.toContain('--brand-');
    // Trocar o bloco por um espaço colapsaria o arquivo e a linha relatada
    // apontaria para outro lugar — uma mensagem que erra o endereço faz
    // consertar o sítio errado (§12.1).
    expect(limpo.split('\n')).toHaveLength(4);
    expect(limpo.split('\n')[3]).toBe('b{color:blue}');
  });
});
