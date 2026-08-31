# O deploy passa a esperar o portão — o que falta você criar

Implementado em 31/08/2026 (branch `rodada/checkout`). **O código está pronto e
inerte**: enquanto os três secrets abaixo não existirem, o job de deploy falha
de propósito, com a mensagem dizendo qual falta. Nada quebra na main até o
merge desta branch.

## O buraco que isto fecha

`ci.yml` roda `on: push: branches: [main]`. Ele **confere**; ele não publicava.
A integração Git da Vercel publicava a `main` no **instante do push**, sem
esperar por ele. Consequência: nada impedia um deploy de produção com o portão
vermelho — o site subia e o CI ficava vermelho depois.

## O que já está no repositório

1. **`vercel.json`** ganhou:
   ```json
   "git": { "deploymentEnabled": { "main": false } }
   ```
   Só a `main`. Os previews das outras branches continuam automáticos — e é
   deles que a verificação do Maps ainda depende (a chave do Google não libera
   `localhost`).

2. **`.github/workflows/ci.yml`** ganhou o job `deploy`, com
   `needs: verify` e `if: push && ref == refs/heads/main`. O deploy
   **fisicamente não acontece** se lint, typecheck, build, unitários ou E2E
   caírem.

3. **`tests/unit/deploy-gate.test.js`** falha se qualquer uma das duas metades
   sumir. Meia trava é pior que nenhuma, porque parece uma.

## O que VOCÊ precisa criar (não consegui daqui: não há `gh` nem `vercel` CLI nesta máquina, e não há `.vercel/`)

### 1. Um token na Vercel

Vercel → avatar → **Account Settings → Tokens → Create Token**.

- Nome: `github-actions-pedeaqui`
- Scope: **o time/conta dona do projeto** (não "Personal Account" se o projeto
  estiver num time)
- Expiration: o mais longo que a política permitir — um token que expira derruba
  o deploy num dia em que ninguém está esperando por isso

Copie o valor **na hora**: ele não é mostrado de novo.

### 2. Os dois ids do projeto

Vercel → o projeto → **Settings → General**, no rodapé da página:

- **Project ID** → `prj_...`
- **Team ID** (ou, em conta pessoal, o **User ID** em Account Settings) →
  `team_...` / `...`

### 3. Os três secrets no GitHub

Repositório → **Settings → Secrets and variables → Actions → New repository
secret**. Os nomes têm de ser exatamente estes:

| Nome | Valor |
|---|---|
| `VERCEL_TOKEN` | o token do passo 1 |
| `VERCEL_ORG_ID` | o Team ID / User ID do passo 2 |
| `VERCEL_PROJECT_ID` | o Project ID do passo 2 |

> `PAYMENT_PUBLIC_KEY` já é lido pelo `ci.yml` para os testes de Secure Fields.
> Se ele ainda não estiver criado, os três testes de
> `mercado-pago-secure-fields.spec.js` continuam se **pulando em silêncio** —
> e são justamente os que pegam bloqueio de `connect-src`.

### 4. Confirmar no painel da Vercel

O `vercel.json` é lido pela Vercel, mas **quem decide de fato é o painel**, e
ele não foi consultado daqui. Depois do merge, confira em
**Settings → Git** que a `main` aparece como *deployment disabled*. Se o painel
tiver uma configuração própria que vença o arquivo, desligue por lá também.

## Como saber que funcionou

No primeiro push na `main` depois do merge:

1. A aba **Actions** mostra `verify` e, depois dele, `Deploy de producao
   (Vercel)`.
2. A Vercel **não** cria um deploy no instante do push — ela cria quando o job
   `deploy` roda `vercel deploy --prebuilt --prod`.
3. Um push que quebre qualquer portão para em `verify`, e a produção **não
   muda**.

## Se você não quiser mover a chave do deploy para o GitHub

A alternativa que também fecha o buraco é proteção de branch na `main`
("Require status checks to pass" com o job `verify` + "Require a pull request
before merging"). Ela é o padrão da indústria e protege a main inteira, mas:
cobra **PR para tudo** (o fluxo aqui é merge local + push direto) e, em
repositório **privado**, exige plano pago do GitHub.

Se optar por ela, **reverta as duas metades acima** — deixar
`deploymentEnabled.main = false` sem um job que publique deixa a produção
congelada, que é o outro modo de falha.
