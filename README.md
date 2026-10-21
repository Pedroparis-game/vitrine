# Vitrine

Veja sua loja do dia, o pacote em destaque, o Mercado Noturno e a sua coleção de skins do Valorant no navegador.

Projeto pessoal e não oficial. Não tem ligação com a Riot Games.

## Baixar

- **Android:** https://github.com/Pedroparis-game/vitrine/releases/latest/download/Vitrine.apk
- **Windows:** https://github.com/Pedroparis-game/vitrine/releases/latest/download/Vitrine.exe

Os links sempre apontam para a versão mais nova e não pedem login.

## Usar no celular (Android)

1. Abra o link do `Vitrine.apk` no celular e baixe.
2. Toque no arquivo baixado. Se o Android pedir, permita **instalar apps desta fonte** para o navegador ou o app de arquivos.
3. Se aparecer um aviso do Play Protect, toque em **Mais detalhes → Instalar mesmo assim**. Isso aparece com qualquer app que não veio da Play Store.
4. Abra o Vitrine e toque em **Entrar com a conta Riot**.

Da segunda vez em diante é só abrir o app. Quando o acesso vence (cerca de 1 hora), o app renova sozinho. Tocar em **Sair** apaga o login do celular.

O app não precisa do PC: ele faz no próprio celular o que o `server.js` faz no computador.

## Usar no PC (Windows)

**Com o `Vitrine.exe`:** dois cliques. O navegador abre sozinho.

**Sem o `.exe`:** instale o [Node.js](https://nodejs.org/pt-br/download) (versão LTS, só uma vez) e dê dois cliques em `Abrir Vitrine.bat`.

Depois:

1. Clique em **Entrar com a conta Riot**.
2. Faça login na página oficial da Riot.
3. Você volta pro Vitrine com a loja aberta.

Deixe a janela preta aberta enquanto usa. Fechar ela desliga o site.

Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e depois em **Executar assim mesmo**. Isso aparece com qualquer programa que não tem assinatura paga.

### Se o login não voltar sozinho

O Vitrine precisa da porta 80 do seu PC. Se ela estiver ocupada (por exemplo, por um servidor web ou pelo Skype antigo), o site avisa na tela e mostra o plano B. Depois do login aparece uma página de erro do `localhost`. Copie o endereço dela e cole no campo indicado.

## Como funciona

```
navegador ──► Vitrine (seu PC, porta 80)
                 ├─ /redirect            recebe o login da Riot e guarda o token na memória
                 ├─ auth.riotgames.com   entitlements e nome da conta
                 ├─ riot-geo             descobre a região
                 ├─ pd.{shard}.a.pvp.net loja, carteira, skins que você tem
                 └─ valorant-api.com     nomes, imagens e raridades
```

- O login usa o mesmo cadastro do Riot Client, que a Riot sempre devolve para `http://localhost/redirect`. É por isso que o token chega sozinho no seu PC.
- Os tokens ficam **só na memória** do programa. O navegador recebe apenas um cookie `HttpOnly` com um id aleatório.
- O servidor escuta só em `127.0.0.1`. Ninguém da sua rede acessa.

## Gerar o `.exe` e o `.apk`

Cada envio para a branch `main` roda o workflow **Gerar Vitrine** (`.github/workflows/gerar-vitrine.yml`). Ele monta o `.exe` num Windows, testa se abre, monta o `.apk` e publica os dois numa *Release*.

Para gerar o `.exe` no seu próprio Windows, com Node 22:

```bash
node --experimental-sea-config sea-config.json
copy "C:\Program Files\nodejs\node.exe" Vitrine.exe
npx postject Vitrine.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `server.js` | Servidor, login, sessão e ponte com a Riot |
| `public/` | O site (HTML, CSS, JS) |
| `Abrir Vitrine.bat` | Abre com dois cliques quando o Node está instalado |
| `sea-config.json` | Receita do `.exe` (embute a pasta `public/`) |
| `.github/workflows/gerar-vitrine.yml` | Monta o `.exe` e o `.apk` e publica os dois |
| `android/` | App Android: `MainActivity.kt` (tela, login e ponte HTTP) e `assets/mobile.js` (a lógica do `server.js` adaptada para o celular) |
| `tools/build-preview.js` | Gera `preview.html`, uma prévia com dados de exemplo |

## Avisos

- A API da loja é interna e não documentada. A Riot pode mudá-la a qualquer momento.
- A Riot já derrubou vários *store checkers* públicos com DMCA. Use para você e para amigos, rodando no PC de cada um. Não hospede na internet.
- Ative a verificação em duas etapas na sua conta Riot.
- A chave que assina o `.apk` (`android/app/vitrine.keystore`) está no repositório para cada versão nova instalar por cima da anterior. Por isso, só instale o `Vitrine.apk` baixado deste repositório.
