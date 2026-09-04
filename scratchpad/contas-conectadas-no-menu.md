# Contas conectadas saiu do menu do Perfil — e quando ela volta

**04/09/2026.** Decisão de produto, tomada pelo dono do app.

## O que mudou

"Contas conectadas" era uma linha de PRIMEIRO NÍVEL no menu do Perfil, ao lado
de "Meus pedidos" e "Meus endereços". Passou a morar dentro de **Gerenciar
perfil > Configurar conta**, ao lado de "Alterar senha".

A tela em si não mudou: mesma lista, mesmo desconectar, mesmo conectar. O que
mudou foi de onde se chega nela — e, com isso, para onde o "Voltar" devolve.

## Por que ela saiu

Foi o próprio dono que pediu a linha no menu, dias antes, e foi ele que a tirou:

> "Foi eu que pedi a entrada no menu, e com um provedor só ela pesa demais —
> uma linha de primeiro nível para dizer 'Google: conectado' não se justifica."

Com UM provedor, aquela linha custa uma linha de menu para informar uma palavra.
O menu do Perfil é a tela mais vista do app depois do cardápio, e cada linha
dele disputa com as outras seis.

E "Alterar senha" é a mesma família: **configuração de acesso à conta**. Senha e
provedor são as duas formas de entrar; elas pertencem à mesma seção.

## QUANDO ELA VOLTA (é isto que este arquivo existe para dizer)

**No dia em que houver MAIS DE UM PROVEDOR.** Apple, Facebook, o que for: a
partir do segundo, a tela deixa de dizer uma palavra e passa a ser uma lista de
verdade — o que se gerencia ali vira decisão, não informação —, e o argumento do
peso se inverte.

Não desfaça a mudança sem esse gatilho. E, se ela voltar, o que precisa voltar
junto:

- a linha em `renderLoggedProfileHub()` (`restaurant-page.js`), onde há um
  comentário no lugar exato;
- o teste `contas conectadas sai do MENU e entra em "Gerenciar perfil"`
  (`tests/e2e/google-signin.spec.js`) **invertido, não apagado** — §14.8 da
  skill. O que ele guarda e continua valendo mesmo depois da volta: existe UM
  caminho até a tela, e o "Voltar" devolve para onde se veio.

## O detalhe que não é óbvio: por que ela NÃO é uma `.prof-sub`

Ela virou uma sobreposição (`#profConnectedScreen`) irmã de
`#profPasswordScreen`, dentro de `#profSubmeusdados` — e não uma `.prof-sub`
própria como era antes.

O motivo é o "Voltar". `closeProfSub()` fecha para o MENU do Perfil, que agora
fica dois níveis acima de onde a pessoa tocou: ela entra por "Gerenciar perfil",
volta, e cai no menu. As outras duas linhas daquela lista ("Meus dados",
"Alterar senha") abrem sobreposição e voltam para a lista; a terceira tinha de
fazer o mesmo.

De brinde, isso obrigou uma limpeza que a família já precisava: a sobreposição
guarda o próprio `.active` e a subtela some sem apagá-lo, então quem deixasse a
tela aberta e trocasse de aba voltaria DIRETO nela. `openProfSub('meusdados')`
agora fecha a de contas conectadas ao entrar. **`#profPasswordScreen` tem o
mesmo buraco e não foi tocado** — é de outro módulo (`customer-data-screen.js`),
e mexer nele sem teste é trocar um defeito conhecido por um desconhecido.
