import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARQUIVO = 'scripts/pages/restaurant-assistant-voice-session.js';
const fonte = readFileSync(resolve(ROOT, ARQUIVO), 'utf8');

// A transcrição da conversa por voz é logada no console SÓ em desenvolvimento.
// No domínio publicado a fala do cliente não pode aparecer em console nenhum —
// nem no dele, nem numa sessão de suporte por compartilhamento de tela.
//
// O e2e prova o lado ligado: rodando em 127.0.0.1 as linhas saem. Este arquivo
// prova o lado DESLIGADO, que é o que não dá para exercitar num teste de
// navegador sem servir o bundle de um host remoto.
//
// A regex é extraída da PRÓPRIA fonte, não recopiada aqui: um teste com a sua
// cópia da expressão continuaria passando depois de alguém afrouxar a original.
describe('a transcrição da voz é gated por ambiente', () => {
  it('o log passa por uma checagem de ambiente antes de escrever', () => {
    const corpo = fonte.match(/function transcrever\([\s\S]*?\n {2}}/)?.[0];
    expect(corpo, 'a função transcrever sumiu ou mudou de forma').toBeTruthy();
    // A guarda é a PRIMEIRA coisa da função: qualquer linha antes dela já teria
    // tocado no texto da conversa.
    expect(corpo.split('\n')[1].trim()).toBe('if (!DEV) return;');
  });

  it('reconhece o servidor de desenvolvimento do bundler', () => {
    // Sem isto, `npm run dev` (que serve de localhost, mas poderia servir de
    // outro host) dependeria só da regex.
    expect(fonte).toMatch(/import\.meta\.env\s*&&\s*import\.meta\.env\.DEV/);
  });

  const achado = fonte.match(/return (\/.+?\/)\.test\(window\.location\.hostname\)/);
  const hostLocal = new RegExp(achado[1].slice(1, -1));

  it('liga nos hosts de desenvolvimento', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(hostLocal.test(host), `${host} deveria contar como desenvolvimento`).toBe(true);
    }
  });

  it('desliga nos hosts publicados', () => {
    const producao = [
      'pederapidex.com',
      'www.pederapidex.com',
      'admin.pederapidex.com',
      'junior-da-picanha.pederapidex.com',
      'rapidex.com',
      'rapidex-front-abc123.vercel.app'
    ];
    for (const host of producao) {
      expect(hostLocal.test(host), `a transcrição ficaria LIGADA em ${host}`).toBe(false);
    }
  });

  it('não cai num host que só PARECE local', () => {
    // O erro clássico é uma regex sem âncoras: `localhost` casaria dentro de
    // `localhost.dominio-de-alguem.com`, e a fala do cliente vazaria para o
    // console num host controlado por terceiros.
    const parecidos = [
      'localhost.exemplo.com',
      'meu-localhost.com',
      'notlocalhost',
      '127.0.0.1.exemplo.com',
      'sub.127.0.0.1',
      'localhostx',
      '0.0.0.0'
    ];
    for (const host of parecidos) {
      expect(hostLocal.test(host), `${host} passou pela checagem de host local`).toBe(false);
    }
  });
});
