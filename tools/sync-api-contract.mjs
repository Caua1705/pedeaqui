// Traz o contrato da API do backend para dentro deste repo.
//
// Copia `openapi.json` E gera `api.d.ts` a partir da MESMA cópia, num passo só.
// Antes eram coisas separadas — o tipo era gerado direto de ../pedeaqui_back e
// nada do contrato ficava versionado aqui. O CI, que não tem o backend ao lado,
// não tinha contra o que comparar, e foi assim que `/coupons/available` sumiu da
// API em 28/08/2026 sem que nada acusasse: o front seguiu chamando uma rota
// morta e a tela do Clube ficou em erro para todo mundo.
//
// Com a cópia versionada, tests/unit/api-contract.test.js consegue provar, sem
// rede e sem o backend, que `api.d.ts` corresponde ao spec e que toda rota que
// o front chama existe nele.
//
// Uso: npm run api:generate  (com o backend em ../pedeaqui_back)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, '..', 'pedeaqui_back', 'openapi.json');
const VENDORED = resolve(ROOT, 'scripts', 'types', 'openapi.json');

if (!existsSync(SOURCE)) {
  console.error(`Não encontrei o spec do backend em ${SOURCE}.`);
  console.error('Este comando precisa do repositório pedeaqui_back ao lado deste.');
  process.exit(1);
}

// Falha cedo e com a razão certa: um JSON truncado geraria tipos silenciosamente
// pobres, e o erro só apareceria muito depois, como campo "inexistente".
try {
  JSON.parse(readFileSync(SOURCE, 'utf8'));
} catch (error) {
  console.error(`O spec em ${SOURCE} não é JSON válido: ${error.message}`);
  process.exit(1);
}

copyFileSync(SOURCE, VENDORED);
// Gera A PARTIR DA CÓPIA, não da origem: é a cópia que o teste vai conferir, e
// gerar da origem deixaria uma fresta para os dois divergirem.
//
// Caminhos RELATIVOS de propósito. O openapi-typescript resolve o argumento
// como URL antes de cair para o disco, então um caminho absoluto que contenha
// caractere não-ASCII chega percent-encoded do outro lado —
// "Belém-Projetos" vira "Bel%C3%A9m-Projetos" e o arquivo "não existe". Com
// cwd em ROOT e caminho relativo, nada disso acontece.
execFileSync(
  process.execPath,
  [
    'node_modules/openapi-typescript/bin/cli.js',
    'scripts/types/openapi.json',
    '-o',
    'scripts/types/api.d.ts'
  ],
  { stdio: 'inherit', cwd: ROOT }
);

console.log('\nContrato sincronizado:');
console.log(`  scripts/types/openapi.json  (cópia fiel do backend)`);
console.log(`  scripts/types/api.d.ts      (gerado da cópia)`);
console.log('\nCommite os DOIS juntos — o teste de contrato compara um com o outro.');
