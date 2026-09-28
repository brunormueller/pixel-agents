# Pixel Agents com multiplayer: como testar

O Pixel Agents mostra os agentes do Claude Code como bonecos animados num escritório em pixel art. Esta versão de teste é um **escritório compartilhado**, no estilo do Gather: todo mundo da mesma sala vê o mesmo mapa, e cada pessoa é um boneco. Você anda com o teclado. Quando o seu Claude começa a trabalhar, o seu boneco vai sozinho para a sua mesa e digita. Dá para conversar pelo chat, fazer **reuniões com vídeo, áudio e tela compartilhada**, e quem fica parado pode jogar ping pong, air hockey ou pebolim.

É uma versão de teste que ainda não foi publicada, por isso ela não vem da loja de extensões. Tem dois jeitos de usar:

- **Extensão do VS Code** (o mais fácil): você instala um arquivo `.vsix` e o escritório abre num painel dentro do VS Code. Veja [Jeito fácil: extensão do VS Code](#jeito-fácil-extensão-do-vs-code).
- **No navegador**, pelo terminal, com o arquivo `.tgz`: é o [Passo a passo](#passo-a-passo) completo. Use este se quiser **câmera, microfone ou tela compartilhada** nas reuniões, porque o VS Code não deixa as extensões usarem isso.

---

## Os dados para você entrar

> Quem te mandou este arquivo preenche esta parte.

| O quê             | Valor                                                     |
| ----------------- | --------------------------------------------------------- |
| Endereço do relay | `wss://baseball-sbjct-situation-maybe.trycloudflare.com/` |
| Sala              | `sala123`                                                 |
| Extensão          | `pixel-agents-1.4.1-multiplayer.vsix`                     |
| Arquivo (browser) | `pixel-agents-1.4.1-multiplayer-pingpong.tgz`             |

A **sala funciona como senha**. Não publique em lugar nenhum.

---

## Jeito fácil: extensão do VS Code

Você só precisa do **VS Code** e do **Claude Code** (o comando `claude` abrindo no terminal). Não precisa de Node.js nem de terminal para o escritório.

1. **Instale a extensão.** No VS Code, abra a aba **Extensions** (Ctrl+Shift+X), clique nos **três pontinhos** (`...`) no alto dela e escolha **Install from VSIX...**. Escolha o arquivo `pixel-agents-1.4.1-multiplayer.vsix`.
   - Se você já tinha o Pixel Agents da loja, esta versão entra no lugar dele. Para voltar depois, desinstale e instale de novo pela loja.
   - Para a loja não trocar esta versão sozinha: na aba **Extensions**, clique na engrenagem do Pixel Agents e desmarque **Auto Update**.
2. **Abra o escritório.** Na parte de baixo do VS Code (onde fica o terminal) aparece a aba **Pixel Agents**. Se não aparecer, aperte Ctrl+Shift+P e rode **Pixel Agents: Show Panel**.
3. **Responda o tour de boas-vindas** (o mesmo do [passo 5](#5-responda-o-tour-de-boas-vindas)).
4. **Entre na sala.** A tela **Join the office** já vem com o servidor da equipe (**Server: ...**). Escreva o **seu nome** e a **sala** da tabela e clique em **Join**. Da próxima vez vem tudo preenchido: é só clicar em **Join**.
   - Se o endereço do relay mudar, clique em **change** ao lado de **Server** e cole o endereço novo.
   - Se você clicou em **Work alone**, use o botão **Join room** na barra de baixo.
5. Pronto: continue do [passo 7](#7-escolha-a-sua-mesa). Os agentes do Claude que você abre nos terminais desse VS Code aparecem no escritório.

Coisas diferentes na extensão:

- **Reuniões:** dentro do VS Code você vê e ouve os outros, e usa o chat e as reações, mas não liga a sua câmera, o microfone nem compartilha a tela. Para isso, abra o escritório no navegador: clique em **Web** na barra de baixo. O link do seu escritório é copiado e aparece **Open in browser** para abrir direto. Use Chrome ou Edge.
  - Enquanto essa aba estiver aberta, é nela que você anda e faz reuniões. O painel do VS Code mostra o aviso **This office is open in your browser**. Feche a aba para voltar a usar o painel.
  - O link é só seu: ele controla o seu escritório. Não mande para ninguém. Ele muda cada vez que o VS Code abre.
- **Cada janela do VS Code é um escritório.** Com duas janelas na mesma sala, você aparece duas vezes. Entre na sala só por uma.

---

## O que você precisa

1. **Node.js 20 ou mais novo** (22 é o recomendado). Para conferir, abra um terminal e rode:
   ```bash
   node -v
   ```
   Se aparecer `v20.x` ou maior, está certo. Se der erro ou a versão for menor, instale a versão LTS em https://nodejs.org.
2. **Claude Code** instalado e funcionando: o comando `claude` precisa abrir no terminal.
3. O arquivo **`pixel-agents-1.4.1-multiplayer-pingpong.tgz`**, que veio junto com este guia.
4. Para as reuniões: **Chrome ou Edge** (a transcrição só funciona neles), com câmera e microfone.

---

## Passo a passo

### 1. Salve o arquivo

Coloque o `.tgz` numa pasta fácil de achar, por exemplo `Downloads`. Você não precisa extrair nada.

### 2. Abra um terminal na pasta do seu projeto

É a pasta onde você usa o Claude Code no dia a dia. O escritório acompanha o Claude **dessa pasta**.

- **Windows:** abra a pasta no Explorer, clique na barra de endereço, digite `powershell` e aperte Enter.
- **macOS / Linux:** abra o Terminal e rode `cd /caminho/do/projeto`.

### 3. Inicie o escritório

Cole o comando abaixo e troque duas coisas: o caminho do arquivo e o endereço do relay da tabela.

**Windows:**

```powershell
npx --yes --package "$HOME\Downloads\pixel-agents-1.4.1-multiplayer-pingpong.tgz" pixel-agents --relay wss://baseball-sbjct-situation-maybe.trycloudflare.com/
```

**macOS / Linux:**

```bash
npx --yes --package ~/Downloads/pixel-agents-1.4.1-multiplayer-pingpong.tgz pixel-agents --relay wss://baseball-sbjct-situation-maybe.trycloudflare.com/
```

Escreva o comando exatamente assim, com `--package` e o `pixel-agents` depois do caminho. Sem isso, o `npx` tenta **abrir** o `.tgz` em vez de instalar, e no Windows o arquivo abre no WinRAR ou no 7-Zip.

Na primeira vez ele demora um pouco, porque instala as dependências. Se aparecer um aviso `npm warn EBADENGINE ... required: { node: '>=22' }`, pode ignorar: funciona com Node 20.

Depois de alguns segundos devem aparecer estas linhas:

```
[Pixel Agents] Multiplayer: relay wss://... — open the page below to enter your name and room.

  Pixel Agents server running at http://127.0.0.1:54321/?token=...
```

**Deixe esse terminal aberto** enquanto estiver usando. Se fechar, o escritório para.

### 4. Abra o escritório no navegador

Copie a URL `http://127.0.0.1:.../?token=...` inteira, com o `?token=`, e abra no navegador.

Essa URL é só sua: não mande para ninguém. O token dentro dela dá acesso às configurações do seu escritório.

### 5. Responda o tour de boas-vindas

Na primeira vez, um personagem aparece e faz algumas perguntas. Numa delas ele pede para instalar os **hooks** do Claude Code.

- **Install Hooks** (recomendado): adiciona entradas no `~/.claude/settings.json` para o escritório saber na hora o que o Claude está fazendo. O resto das suas configurações não muda.
- **Not Now**: funciona do mesmo jeito, mas o boneco reage com alguns segundos de atraso.

Você pode remover os hooks quando quiser em **Settings → Instant Detection (Hooks)**.

### 6. Entre na sala

Aparece a tela **Join the office**:

1. Em **Your name**, escreva o nome que os outros vão ver embaixo do seu boneco.
2. Em **Room**, escreva a sala da tabela, exatamente igual.
3. Clique em **Join**.

Da próxima vez a tela já vem preenchida. Se clicar em **Work alone**, você fica sozinho no seu escritório. Para entrar depois, use o botão **Join room** na barra de baixo.

Quem entra primeiro numa sala que ainda não tem mapa "cria" a sala: o mapa da sala começa igual ao escritório dessa pessoa. Depois disso, **qualquer pessoa da sala pode mudar o mapa** (passo 22), e todo mundo vê a mudança na hora. O seu próprio mapa não é apagado e volta quando você sai.

### 7. Escolha a sua mesa

Logo depois de entrar, todas as cadeiras ganham um quadradinho:

- **verde:** livre, clique para escolher;
- **vermelho:** de outra pessoa;
- **roxo:** a sua.

Seu boneco anda até a mesa escolhida. Para trocar depois, use o botão **Desk** na barra de baixo.

### 8. Ande pelo escritório

Com as **setas** do teclado (ou **W A S D**), seu boneco anda pelo mapa, e os outros veem você andando. Clique no mapa antes, para a página estar com o foco.

### 9. Dance e reaja

Clique em **Emote** na barra de baixo ou use as teclas numéricas:

| Tecla | O quê                              |
| ----- | ---------------------------------- |
| 1     | Dançar (aperte de novo para parar) |
| 2     | 👋 Acenar                          |
| 3     | ❤️ Coração                         |
| 4     | 👏 Palmas                          |
| 5     | 😂 Risada                          |
| 6     | 🎉 Festa                           |
| 7     | Pular                              |
| 8     | Girar                              |

Todo mundo da sala vê. As reações (2 a 6) funcionam sempre, até com o Claude trabalhando. Dançar, pular e girar só funcionam quando o Claude não está usando o seu boneco. Andar com as setas para a dança.

### 10. Use o Claude Code normalmente

Abra **outro** terminal, **na mesma pasta do projeto**, rode `claude` e peça qualquer coisa.

- Enquanto o Claude trabalha, **o seu boneco é dele**: vai sozinho para a sua mesa e digita ou lê. As setas não funcionam nesse tempo, e um aviso na tela explica isso.
- Quando o Claude termina, o boneco fica na mesa até você andar com ele de novo.
- Se você abrir mais de um Claude, os outros aparecem como bonecos extras nas cadeiras mais perto da sua mesa.

Passe o mouse em cima dos bonecos para ver o que cada um está fazendo: _Working_, _Reading_, _Thinking_, _Needs approval_, _Waiting for input_ ou _Idle_.

### 11. Converse pelo chat

1. Clique em **Chat**, na barra de baixo. Um painel abre à direita com o histórico da sala.
2. Escreva e aperte **Enter**.

A mensagem aparece num balão em cima do seu boneco, digitando letra por letra, na tela de todo mundo. Quando chega mensagem com o painel fechado, o botão **Chat** mostra quantas estão sem ler.

- O histórico fica só na memória do seu escritório (as últimas 100 mensagens). Quem entra depois não vê o que foi dito antes, e fechar o escritório apaga tudo.
- Para mandar mensagem, a página precisa ter sido aberta com a URL do `?token=`.

### 12. Mesa de jogo (opcional)

Qualquer pessoa da sala pode colocar uma mesa de jogo:

1. Clique em **Layout**.
2. Procure no catálogo de móveis: **Ping Pong Table**, **Air Hockey Table** ou **Foosball Table** (pebolim).
3. Coloque a mesa num espaço livre.

A mesa aparece para todo mundo da sala. Os agentes extras vão jogar quando ficam parados.

### 13. Personalize o seu boneco

1. Clique em **You** → **Customize character**.
2. Escolha o corpo (**Body**), a cor do cabelo (**Hair**), a cor da roupa (**Top** e **Bottom**) e um acessório: boné, gorro, cartola, coroa, chapéu de festa, fone, óculos, óculos escuros, flor, laço ou auréola.
3. O boneco da prévia anda e gira para você ver todos os lados. Clique em **Save**.

Todo mundo da sala passa a ver o seu boneco assim. **Automatic** volta para o boneco que o escritório escolhe. Terno e vestido são peça única, então o **Bottom** fica desligado nesses corpos.

### 14. Defina o seu status

Clique no botão de status, na barra de baixo (ele começa como **Available**):

- escolha **Available**, **Busy**, **In a meeting** ou **Away**;
- se quiser, escreva uma mensagem sua (até 60 letras), ou use uma das sugestões, e clique em **Set**.

O status aparece como uma bolinha colorida no seu nome, e a mensagem logo abaixo, para todo mundo. **Clear** apaga os dois.

### 15. Encontre e siga alguém

Clique em **People**. O painel mostra quem está na sala, o status de cada um, o que está ouvindo e quantos agentes estão trabalhando.

- **Locate** leva a câmera até a pessoa.
- **Go to** faz o seu boneco andar até ela.
- **Follow** faz o seu boneco seguir a pessoa pelo mapa. Aperte qualquer seta para parar.

Enquanto o Claude está trabalhando no seu boneco, **Go to** e **Follow** ficam desligados.

### 16. Decore a sua mesa

Você precisa ter uma mesa (passo 7).

1. Clique em **You** → **Decorate desk**.
2. Clique num item do catálogo. Ele passa a seguir o mouse no mapa, e o tampo da sua mesa fica contornado.
3. Leve o item até o lugar certo e clique. Ele fica verde quando cabe e vermelho quando não cabe. Itens de mesa (monitor, laptop, teclado, mouse, braço robótico, torta...) ficam em qualquer ponto do tampo, com precisão de pixel. Plantas vão para o chão, e relógios e quadros para a parede.
4. Os itens já vêm virados para a sua cadeira (se você senta do lado da mesa, o monitor fica de lado, com a tela para você). Aperte **R** para girar o item antes de colocar.
5. No mapa, clique num item seu para mudar de lugar e use o botão direito para tirar. Você também pode tirar pela lista **On your desk**.

**Mesa completa com um clique:** no topo do painel, **Studio desk → Set up my desk like this** monta a mesa inteira: mesa curva branca, cadeira de escritório, braço robótico, PC, monitor largo, monitor vertical, teclado, mouse, torta e uma planta no suporte ao lado. O computador que já vinha na mesa sai. Depois dá para mexer em tudo.

**Estilo da mesa:** em **Desk style**, escolha **Curved** (mesa curva) ou **Office** (branca com frente cinza). A sua mesa e a sua cadeira passam a aparecer assim para todo mundo, sem mudar o mapa da sala. **As built** volta ao original.

Com estilo, a mesa fica virada para quem olha. Se a sua cadeira fica atrás da mesa (você de frente para a tela, vendo a traseira dos monitores), ela passa para a frente da mesa: seu boneco senta de costas e todo mundo vê as telas. O que estava na mesa gira junto. Isso só acontece se o espaço na frente da mesa estiver livre. Com **As built**, a cadeira volta para trás e os itens voltam para onde estavam. Depois de trocar o estilo, vale clicar de novo em **Set up my desk like this** para arrumar a mesa para o novo lado.

**Tirar o computador que já vem na mesa:** com o painel aberto, clique no computador (ou em qualquer coisa que o mapa colocou na sua mesa) para tirar e colocar em outro lugar, ou use o botão direito para só tirar. Ele aparece em **Taken off your desk**, com **put back** para devolver.

Cabem até 12 itens. A decoração vai junto quando você troca de mesa, e todo mundo da sala vê. O escritório lembra a sua mesa em cada sala, então a decoração volta quando você recarrega a página. Os itens **Seasonal** só aparecem na época deles (por exemplo, abóbora em outubro e árvore de Natal em dezembro). Os que você já colocou continuam depois da época.

### 17. Veja e entre nas suas reuniões

1. Clique em **Calendar**.
2. Cole o endereço secreto do seu calendário:
   - **Google Agenda:** Configurações → a sua agenda → **Integrar agenda** → **Endereço secreto no formato iCal**.
   - **Outlook:** Configurações → Calendário → **Calendários compartilhados** → **Publicar um calendário** (pode ver todos os detalhes) → copie o link **ICS**.
3. Clique em **Connect**.

O painel mostra as reuniões das próximas 24 horas, com um botão **Join** em cada chamada (Meet, Teams, Zoom...). Cinco minutos antes, aparece um aviso no alto da tela com **Join**. Na sala, entrar na reunião também leva o seu boneco até a área de reunião do escritório, e enquanto ela acontece os outros te veem como **In a meeting**. Isso pode ser desligado no próprio painel.

O endereço do calendário funciona como senha: fica só no seu computador. As reuniões não saem dele.

### 18. Conecte o Spotify (opcional)

O Pixel Agents não vem com uma conta do Spotify, então você usa um app seu. Isso é feito uma vez só:

1. Entre em https://developer.spotify.com/dashboard e crie um app (qualquer nome, marque **Web API**).
2. Em **Redirect URIs**, adicione `http://127.0.0.1:43117/spotify/callback` (o painel **Music** tem um botão para copiar).
3. Copie o **Client ID** do app.
4. No escritório, clique em **Music**, cole o Client ID e clique em **Connect**. Uma aba do navegador abre para você autorizar.

Depois disso, o painel mostra a música que está tocando e tem os botões de voltar, pausar e avançar (esses três precisam do Spotify Premium). Marque **Show the room what I am listening to** para aparecer `♪ Artista – Música` embaixo do seu nome. Isso começa desligado.

### 19. Faça uma reunião

As reuniões acontecem dentro da sala, no navegador: vídeo, áudio, tela compartilhada, chat e mais.

**Começar ou entrar:**

1. Clique em **Meet**, na barra de baixo. O painel mostra as reuniões que estão acontecendo na sala.
2. Para começar uma, escreva um título (ou deixe o padrão), escolha se entra com microfone e câmera ligados e clique em **Start**.
3. Para entrar numa que já existe, clique em **Join** embaixo dela.
4. Na primeira vez, o navegador pergunta se pode usar a câmera e o microfone: clique em **Permitir**.

O seu boneco anda até a área de reunião do escritório, os outros passam a te ver como **In a meeting** e aparece um 📞 ao lado do seu nome.

**Chamar alguém:** dentro da reunião, abra **People** e clique em **Invite** ao lado da pessoa. Ela recebe um aviso no alto da tela com **Join**.

**A tela da reunião** abre por cima do escritório. **▁ Office** (ou **Esc**) diminui a reunião para uma faixa de vídeos pequenos no alto, e você continua andando pelo mapa enquanto fala. Clique num vídeo da faixa para abrir de novo. Na tela grande, clique num vídeo para fixá-lo em destaque.

**Os botões:**

| Botão          | O que faz                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mic**        | Liga e desliga o microfone.                                                                                                                                                                                                                                         |
| **Camera**     | Liga e desliga a câmera.                                                                                                                                                                                                                                            |
| **Share**      | Compartilha uma tela, janela ou aba. **…with its sound** leva o som junto (bom para mostrar um vídeo). Dá para compartilhar **até 4 telas ao mesmo tempo**, e várias pessoas podem compartilhar juntas: as telas aparecem lado a lado. Para parar, **Stop screen**. |
| **React**      | 👍 ❤️ 😂 😮 👏 🎉 🙌 👋 aparecem flutuando no seu vídeo. Algumas também fazem o seu boneco reagir no escritório.                                                                                                                                                    |
| **Hand**       | Levanta e abaixa a mão. Em **People** aparece a fila de quem levantou, na ordem.                                                                                                                                                                                    |
| **Chat**       | O chat da reunião. Só quem está nela lê.                                                                                                                                                                                                                            |
| **Transcript** | As legendas e a transcrição da reunião. **Download (.md)** baixa tudo.                                                                                                                                                                                              |
| **Notes**      | **Write notes with Claude**: o **seu** Claude Code escreve as notas da reunião (resumo, decisões, tarefas com responsável, dúvidas em aberto) a partir da transcrição e do chat. As notas aparecem para todos e ficam salvas em `~/.pixel-agents/meetings/`.        |
| **People**     | Quem está na reunião (microfone, câmera, tela, mão) e **Invite** para chamar quem está na sala.                                                                                                                                                                     |
| **Record**     | Grava a reunião (todos os vídeos, telas e sons, mais a música) num arquivo `.webm` que é baixado quando você para. **Todo mundo vê ● REC com o seu nome** enquanto você grava.                                                                                      |
| **CC**         | Liga e desliga a transcrição para a reunião inteira.                                                                                                                                                                                                                |
| **Music**      | Música de fundo que **todos ouvem ao mesmo tempo, sincronizada**: cinco faixas prontas (lo-fi, bossa, arcade, synthwave e ambiente). Cada um ajusta o próprio volume. **Stop for everyone** para a música de todos.                                                 |
| **⚙**          | Escolhe o microfone, a câmera e o alto-falante.                                                                                                                                                                                                                     |
| **Leave**      | Sai da reunião.                                                                                                                                                                                                                                                     |

**Transcrição:** cada pessoa transcreve só a própria voz. Quando alguém liga o **CC**, aparece uma pergunta para os outros: **Transcribe me** ou **Not me**. Nada é transcrito com o microfone desligado. No Chrome e no Edge, o áudio da sua voz vai para o serviço de reconhecimento de fala do Google ou da Microsoft. Escolha o idioma em que você fala na aba **Transcript** (começa em português se o navegador estiver em português). No Firefox não dá para transcrever a sua voz, mas você vê as legendas dos outros.

**Notas com IA:** precisa de transcrição ou de chat na reunião, e do `claude` funcionando no seu computador (o mesmo do passo 10). Demora uns 15 a 30 segundos. O texto da reunião vai para o Claude pela sua própria conta do Claude Code.

**Se um vídeo diz _no connection_:** a rede de uma das pessoas não deixa os navegadores se conectarem direto (acontece em algumas redes de empresa). O chat e a transcrição continuam funcionando. Avise quem roda o relay: ele pode configurar um servidor TURN (veja `docs/multiplayer.md`).

> **Quem roda o relay:** as reuniões precisam do relay novo. Pare o relay antigo e rode de novo com este `.tgz`: `npx --yes --package <caminho do .tgz> pixel-agents relay --host 0.0.0.0`. Com um relay antigo, o botão **Meet** aparece, mas ninguém vê a reunião dos outros.

### 20. Andares, escadas e elevador

O escritório pode ter vários andares. Qualquer pessoa da sala monta os andares:

1. Clique em **Layout**. No canto de cima, à esquerda, aparece o painel **Floors** (andares).
2. **+ Up** cria um andar em cima, **+ Down** cria um embaixo (um subsolo). O andar novo já vem com as mesmas paredes e o mesmo piso do andar que está na tela, sem móveis. A tela passa para o andar novo: monte ele como qualquer outro (piso, paredes, móveis, e aumentar o tamanho pela borda tracejada).
3. Dois cliques no nome renomeiam o andar (por exemplo "Térreo", "1º andar"). ▲ e ▼ mudam a ordem dos andares, e **x** apaga o andar (clique de novo em **Sure?** para confirmar).
4. **Escada:** em **Furniture → Misc**, escolha **Stairs** e coloque num lugar com piso livre na frente. A outra ponta aparece sozinha no andar de cima (ou no de baixo, se você está no último), no mesmo lugar.
5. **Elevador:** em **Furniture → Wall**, escolha **Elevator** e coloque numa parede. Aparece uma porta em todos os andares.
6. Clique na escada ou no elevador para configurar: a escada mostra **Go up to…** ou **Go down to…** e deixa escolher para qual andar ela leva; o elevador tem a lista **Stops at** para marcar em quais andares ele para.

Se sobe ou desce depende da ordem dos andares: um andar mais alto na lista fica em cima. Trocando a ordem com ▲ ▼, a escada que subia passa a descer.

Para andar entre os andares:

- Chegue na frente da escada ou da porta do elevador e continue apertando a seta na direção dela. O boneco sobe (ou desce) e a tela vai junto para o outro andar.
- Se o elevador para em mais de dois andares, aparece a pergunta **Elevator — which floor?**: clique no andar ou aperte o número (1 é o andar mais alto).
- Para voltar, solte a seta e aperte de novo.
- O painel **Floors** mostra quantas pessoas estão em cada andar e onde você está (●). Clique num andar para olhar sem ir até lá.
- O Claude sobe a escada sozinho se a sua mesa fica em outro andar. Os agentes parados às vezes vão jogar em outro andar também.

### 21. Portas

Qualquer pessoa da sala pode colocar portas entre as paredes:

1. Clique em **Layout** → **Furniture** → **Wall** e escolha **Door**.
2. Passe o mouse sobre uma parede, num ponto que tenha parede dos dois lados (a prévia fica verde). Em parede deitada a porta aparece de frente; em parede em pé, de lado.
3. Clique. A parede ali vira passagem, com o mesmo piso do lado, e a porta fica no vão.
4. Para mudar a cor: clique na porta e use **Color** (os controles de cor, com **Colorize** para uma cor forte). **Clear** volta para a madeira.

A porta abre sozinha quando alguém (você, os agentes ou os bichinhos) passa por ela, e fecha logo depois.

> **Quem roda o relay:** os andares também precisam do relay novo. Com um relay antigo, quem entra na sala continua vendo o próprio escritório.

### 22. Todo mundo edita o mapa

O mapa é da sala, não de uma pessoa. Qualquer um que está na sala pode mudar:

1. Clique em **Layout** e mude o que quiser: piso, paredes, carpete, móveis, andares, portas.
2. Cada mudança aparece **na hora** para todo mundo da sala. Não precisa clicar em **Save**.
3. Quem entrar depois já vê o mapa com as mudanças, **mesmo que a sala tenha ficado vazia** ou que o relay tenha sido reiniciado.

Para testar, combine com outra pessoa:

- Os dois abrem **Layout** e mudam coisas diferentes ao mesmo tempo (por exemplo, um coloca móveis na esquerda e o outro pinta o piso na direita). No fim, as duas mudanças devem estar no mapa dos dois.
- Os dois mexem **na mesma coisa** ao mesmo tempo (o mesmo móvel, o mesmo quadrado do piso): fica a última mudança.
- **Ctrl+Z** desfaz só o que **você** fez. O que a outra pessoa mudou continua lá.
- Saiam os dois da sala (**Leave**) e entrem de novo: o mapa tem que estar como vocês deixaram.

Algumas coisas para saber:

- Dentro da sala, **Save** não grava nada no seu computador: as mudanças já estão na sala. Ele só marca o ponto para onde **Reset** volta.
- Nada do que você muda na sala vai para o seu próprio escritório. Ao sair da sala, o seu mapa volta como era.
- Se a conexão com o relay cair enquanto você edita, a tela volta para o seu escritório e o que você mudou nesse meio tempo se perde.

> **Quem roda o relay:** editar em grupo precisa do relay novo. Com um relay antigo, só quem criou a sala edita, e o mapa some quando a sala esvazia. O relay novo guarda o mapa de cada sala em `~/.pixel-agents/relay-rooms/` (um arquivo por sala, com o nome embaralhado). Para começar uma sala do zero, apague o arquivo dela, ou rode o relay com `--no-save-rooms` para não guardar nada.

---

## O que é compartilhado com os outros

Do seu escritório, só sai isto:

- o nome que você escreveu na tela de entrada;
- onde o seu boneco está no mapa, e se está andando, sentado, digitando ou lendo;
- a cor do boneco e qual é a sua mesa;
- se o Claude está trabalhando, parado ou esperando você aprovar alguma coisa;
- as mensagens que você escreve no chat (o relay só repassa, não guarda nenhuma);
- se foi você quem criou a sala: o desenho do seu escritório (chão, paredes e móveis), que vira o mapa da sala;
- as mudanças que você faz no mapa da sala (o relay guarda o mapa, e só o mapa);
- o visual que você escolheu para o boneco, o seu status com a mensagem, e a decoração da sua mesa;
- só se você marcar **Show the room what I am listening to**: o nome da música e do artista que estão tocando;
- nas reuniões: o título da reunião, se o seu microfone e a sua câmera estão ligados, se você está compartilhando tela, gravando ou com a mão levantada, e o que você escreve no chat da reunião, as suas reações, as frases transcritas da sua voz (só se você aceitou) e as notas que o seu Claude escrever. **O vídeo, o áudio e as telas vão direto de navegador para navegador**, criptografados: não passam pelo relay.

**Nunca saem** nomes de arquivos, comandos, código, prompts, conversas, o nome das pastas, as suas reuniões, o endereço do seu calendário ou o login do Spotify. Tudo isso fica no seu computador. O máximo que o calendário mostra para a sala é o status **In a meeting**.

---

## Problemas comuns

| Sintoma                                                | O que fazer                                                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` ou `npx` não é reconhecido                      | Instale o Node.js 20+ em https://nodejs.org e **abra um terminal novo**.                                                                                                                                          |
| `relay connection error`, ou o botão diz **Leave...**  | O endereço do relay mudou ou o relay está desligado. Peça o endereço atual para quem te mandou o arquivo.                                                                                                         |
| Não aparece a tela **Join the office**                 | No navegador, confira se o comando tem `--relay`. Na extensão, clique em **Join room** na barra de baixo (a tela só abre sozinha quando já sabe o servidor). Se você clicou em **Work alone**, use o mesmo botão. |
| Não aparece ninguém dos outros                         | Confira se a **sala** está escrita exatamente igual, com as mesmas letras maiúsculas e minúsculas. Os outros também precisam estar com o escritório aberto.                                                       |
| As setas não mexem o boneco                            | Clique no mapa antes. Se aparecer o aviso de que o Claude está trabalhando, espere ele terminar. Na tela de escolher mesa, feche com **Later** primeiro.                                                          |
| O botão **Layout** está apagado                        | O relay é antigo: nele só quem criou a sala edita. Peça para quem roda o relay atualizar (passo 22).                                                                                                              |
| Mudei o mapa e a outra pessoa não viu                  | Confira se os dois estão na mesma sala e se a página foi aberta com o `?token=` na URL. Sem o token dá para ver a sala, mas não mudar o mapa.                                                                     |
| Meu Claude trabalha mas o boneco não vai para a mesa   | Rode o `claude` **na mesma pasta** onde você iniciou o escritório (passo 2).                                                                                                                                      |
| "Fulano took your desk"                                | Vocês escolheram a mesma mesa quase juntos, e ficou com quem entrou na sala primeiro. Escolha outra.                                                                                                              |
| A página abre, mas não consigo mexer nas configurações | Você abriu a URL sem o `?token=...`. Copie a URL inteira do terminal.                                                                                                                                             |
| Mando mensagem e ela não aparece no painel             | O relay não recebeu a mensagem: ele está desligado, ou você mandou mais de 5 mensagens em 10 segundos. Também não funciona sem o `?token=` na URL.                                                                |
| Quero outro nome ou outra sala                         | Clique em **Leave** e depois em **Join room**.                                                                                                                                                                    |
| O calendário mostra um erro em vermelho                | O endereço foi redefinido ou está errado. Copie o endereço secreto de novo, clique em **remove** e cole o novo.                                                                                                   |
| O Spotify diz `INVALID_CLIENT` ou `redirect_uri`       | Confira se o Redirect URI no app do Spotify está exatamente igual a `http://127.0.0.1:43117/spotify/callback`.                                                                                                    |
| Pausar ou avançar música não funciona                  | Esses botões precisam do Spotify Premium e de um app do Spotify tocando em algum aparelho.                                                                                                                        |
| Não aparecem quadradinhos verdes para decorar          | Escolha uma mesa antes (**You** → **Choose desk**). Se a mesa estiver cercada de móveis, tente outro item ou outra mesa.                                                                                          |
| O navegador não pede câmera nem microfone              | Abra pela URL `http://127.0.0.1:...` com o `?token=`. O navegador só libera câmera e microfone nesse endereço (ou em https). Se você bloqueou antes, libere no cadeado da barra de endereço.                      |
| Ninguém vê a minha reunião no **Meet**                 | O relay é antigo. Peça para quem roda o relay atualizar (passo 19).                                                                                                                                               |
| Um vídeo mostra _no connection_                        | A rede não deixa conexão direta. Chat e transcrição continuam. Quem roda o relay pode configurar um servidor TURN.                                                                                                |
| **Write notes with Claude** dá erro                    | Confira se o `claude` abre no terminal e está logado. Precisa ter transcrição ou chat na reunião.                                                                                                                 |
| A transcrição não aparece                              | Use Chrome ou Edge, aceite **Transcribe me**, deixe o microfone ligado e confira o idioma na aba **Transcript**.                                                                                                  |
| Não escuto os outros                                   | Confira o alto-falante em **⚙** e o volume do computador. Clique uma vez na página (o navegador só toca som depois de um clique).                                                                                 |
| Não consigo subir a escada                             | Fique no piso bem na frente dela e continue apertando a seta na direção da escada. Se acabou de chegar por ela, solte a seta e aperte de novo.                                                                    |
| Não consigo colocar a escada ou um móvel               | A escada precisa de piso livre na frente, e nada pode ficar na frente de uma escada ou de um elevador.                                                                                                            |
| A porta fica vermelha e não deixa colocar              | Ela precisa ficar numa parede com parede dos dois lados: numa parede deitada, à esquerda e à direita; numa parede em pé, em cima e embaixo. Não dá para colocar na quina.                                         |
| Sumi da tela depois de subir                           | Clique no andar onde está o ● no painel **Floors**.                                                                                                                                                               |

---

## Como parar

- **Sair da sala:** clique em **Leave**. Seu escritório volta a ser só seu.
- **Parar o escritório:** aperte **Ctrl+C** no terminal onde ele está rodando. Na extensão do VS Code, feche o painel **Pixel Agents** (ou a janela).
- **Remover os hooks do Claude Code:** antes de parar, desmarque **Settings → Instant Detection (Hooks)** no navegador. Se você já parou, rode o comando do passo 3 de novo, desmarque e pare.
- **Tirar a extensão do VS Code:** na aba **Extensions**, clique na engrenagem do Pixel Agents → **Uninstall**. Os hooks saem junto.
- **Apagar tudo:** apague o `.tgz` e a pasta `~/.pixel-agents` (no Windows, `C:\Users\SEU-USUARIO\.pixel-agents`).

---

Se der algum erro, copie as últimas linhas do terminal e mande para quem te enviou o arquivo.
