# Vitrine

Veja sua loja do dia, o pacote em destaque, o Mercado Noturno e a sua coleção de skins do Valorant no navegador.

Projeto pessoal e não oficial. Não tem ligação com a Riot Games.

## Usar (Windows)

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

## Gerar o `Vitrine.exe`

O executável é montado pelo GitHub, num Windows de verdade:

1. Crie um repositório no GitHub e envie esta pasta inteira (pode ser arrastando os arquivos no site).
2. Abra a aba **Actions**. O "Gerar Vitrine.exe" roda sozinho em uns 2 minutos.
3. Clique nele e baixe **Vitrine-windows** em *Artifacts*.

Para gerar no seu próprio Windows, com Node 22:

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
| `.github/workflows/gerar-exe.yml` | Monta e testa o `.exe` no GitHub |
| `tools/build-preview.js` | Gera `preview.html`, uma prévia com dados de exemplo |

## Avisos

- A API da loja é interna e não documentada. A Riot pode mudá-la a qualquer momento.
- A Riot já derrubou vários *store checkers* públicos com DMCA. Use para você e para amigos, rodando no PC de cada um. Não hospede na internet.
- Ative a verificação em duas etapas na sua conta Riot.
