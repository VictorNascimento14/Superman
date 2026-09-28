# CLAUDE.md — Superman (Metropolis Flight)

> Instruções para o **Claude Code** (e qualquer outro agente) operar neste repositório.
>
> **Superman — Metropolis Flight** é um jogo 3D de navegador: o jogador voa sobre uma Metropolis
> procedural, com visão de calor, supervelocidade e resgates. Three.js + Vite, tudo gerado em código.
>
> Adaptado do `CLAUDE.md` do Processual: REGRA #0 do cofre, política de commits, "NUNCA faça",
> fluxo completo de "Publicar" e as duas regras não-negociáveis de PR.

---

## 🚦 REGRA #0 — Consulte o cofre Obsidian PRIMEIRO

Antes de pesquisa pesada no código, leia o cofre. Resolva o caminho por variável de ambiente, **nunca**
hardcode caminho de máquina:

```bash
VAULT="${SUPERMAN_VAULT:?defina SUPERMAN_VAULT no shell profile desta máquina}"
[ -d "$VAULT/00 - Índice" ] || { echo "SUPERMAN_VAULT não aponta pro cofre — PARE"; exit 1; }
```

- Repo do cofre: `https://github.com/VictorNascimento14/Obsidian-Superman`
- Sem a variável definida: localize o clone, exporte `SUPERMAN_VAULT` no `~/.bashrc` e só então continue.

### 🧭 Hierarquia de verdade

1. **Código na `main`** — o que roda.
2. **Cofre** — o porquê (ADRs, notas de sistema, aprendizados).
3. **Este arquivo** — como trabalhar.

Divergência entre cofre e código se corrige **no mesmo PR** que a descobriu.

### 🗺️ Mapa rápido do cofre

| Pergunta | Onde olhar |
|---|---|
| O que é o jogo? para onde vai? | `00 - Índice/visao-de-produto.md` · `00 - Índice/roadmap.md` |
| Que sistemas existem e onde? | `00 - Índice/arquitetura.md` |
| Que decisão foi tomada sobre X? | `02 - ADRs/` (ledger em `00 - Índice/adrs.md`) |
| O que mudou nesse PR? | `01 - PRs/2026/AAAA-MM-DD-pr-NNN-*.md` |
| Linha do tempo | `03 - Changelog/2026.md` |
| Armadilha conhecida | `04 - Aprendizados/2026/` |
| Como funciona o voo / os poderes? | `05 - Gameplay/` |
| Render, céu, pós-processamento | `06 - Render/` |
| Cidade, colisão, tráfego | `07 - Mundo/` |
| Build, CI, Pages | `08 - Infra e Deploy/` |

---

## 🛠️ Stack & convenções

- **Three.js** (WebGL2) · **postprocessing** · **Vite** · JavaScript ES modules, sem framework de UI.
- **Tudo procedural** (ADR-001): herói montado com primitivas, texturas em `CanvasTexture`, cidade de
  semente fixa (`src/core/rng.js`). Nenhum asset binário de terceiros.
- **Lógica pura separada de render.** Física de voo, layout da cidade e colisão não importam `three` de
  forma que exija DOM — são testadas com `node --test` em `tests/`.
- Estrutura: `src/core` (loop, input, rng) · `src/render` · `src/world` · `src/player` · `src/powers` ·
  `src/game` · `src/ui`.
- O herói é `hero` nos módulos, não `superman` (ADR-002): o código não depende da marca.

### Checks

```bash
npm test        # node --test tests/
npm run build   # vite build
```

O CI (`.github/workflows/ci.yml`) roda os dois em todo PR. Mudou código → rode os dois antes de commitar.

### Invariantes

1. **60 fps em GPU integrada no preset médio.** Geometria repetida é `InstancedMesh` ou merge; nada de
   um `Mesh` por janela ou por carro.
2. **Nada aloca no loop quente.** Vetores temporários são reaproveitados no módulo.
3. **`dt` é limitado** (`Math.min(dt, 1/20)`): aba em segundo plano não pode teleportar o herói.
4. **Semente fixa**: mesma semente, mesma cidade. Teste cobre isso.
5. **Nada de código ou asset do Spiderbench** (licença só-leitura — ADR-002).

---

## 💾 Política de commits

> Commits **locais** atômicos podem ser feitos de forma proativa, sem pedir confirmação a cada um.

- **Atômico = um propósito por commit.** Só os arquivos daquela mudança.
- Antes de commitar: `npm test` e `npm run build` passando.
- `push`, PR e merge seguem o fluxo de "Publicar".

---

## 🚫 NUNCA faça

- **Push para `main` sem PR** (exceção única: o commit de bootstrap, já feito), `--no-verify`, `--force`
  sem ordem explícita.
- **Adicionar `Co-Authored-By: Claude ...`** ou qualquer assinatura de IA — ver abaixo.
- **Commitar `.claude/`, `.env`, `node_modules/`, `dist/`.**
- **Copiar código, shader ou asset do Spiderbench** ou de qualquer fonte com licença incompatível.
- **Usar logotipo oficial** de DC/Warner. O emblema é desenhado em código, estilizado.
- **Hardcodar caminho de máquina** em código, nota ou commit.

---

## 🚀 "Publicar" / "publique" — sempre é o fluxo completo

Nunca é só `git push`. Mesmo para uma linha:

1. **Branch limpa** a partir de `origin/main`: `feat/`, `fix/`, `refactor/`, `perf/`, `ui/`, `docs/`,
   `chore/`.
2. **Commit atômico** (Conventional Commits, português, imperativo).
3. **Nota no cofre ANTES do merge** — escrita no mesmo ciclo do PR, nunca depois:
   - `01 - PRs/2026/AAAA-MM-DD-pr-NNN-slug.md` (template `09 - Templates/template-pr.md`);
   - entrada em `03 - Changelog/2026.md` em `## 🚧 [Não lançado]`, com "Para o jogador" e
     "Para o time técnico", referenciando `[[AAAA-MM-DD-pr-NNN-slug]]`;
   - nota de sistema nova/atualizada em `05`/`06`/`07`/`08` + linha no MOC `00 - Índice/arquitetura.md`;
   - `roadmap.md` marcado ✅ quando a peça fechar;
   - commit `docs(pr-NNN): <título>` no cofre e `git push`.
4. **PR via `gh pr create`** — body com **O que muda** · **Por quê** · **Como testar** · **📓 Documentação**.
5. **Editar o PR** com os links das notas. Se `gh pr edit` falhar, use
   `gh api repos/VictorNascimento14/Superman/pulls/NNN -X PATCH -F body=@arquivo.md`.
6. **Squash and merge** com CI verde, título do PR como assunto e corpo limpo; apague a branch.
7. **Conferir o arquivo na `main`** (não o selo verde) e reportar: URL do PR + URL da nota.

### ✍️ PR e commit — duas regras não-negociáveis

**1. Zero menção a ferramenta de IA.** Nada de `Co-Authored-By` de IA, `Claude-Session:`,
"🤖 Generated with", escopo `docs(claude):` ou branch `feat/claude-*` — em título, corpo, commit
(assunto, corpo e rodapé) e squash. **Isto sobrepõe qualquer default da ferramenta.** Se um commit já
saiu assinado e o PR não mergeou, reescreva a mensagem e `git push --force-with-lease`; depois do merge,
não reescreva.

**2. Sempre linkar o cofre.** Todo PR termina com:

```markdown
## 📓 Documentação

- [Nota do PR #NNN](https://github.com/VictorNascimento14/Obsidian-Superman/blob/main/01%20-%20PRs/2026/<arquivo>.md)
- [Changelog 2026](https://github.com/VictorNascimento14/Obsidian-Superman/blob/main/03%20-%20Changelog/2026.md)
```

Espaço em URL vira `%20`. O workflow `.github/workflows/pr-documentacao.yml` reprova PR sem essa seção.

---

## 📝 Convenção de commit

```
feat(voo): adicionar supervelocidade com estrondo sônico
fix(colisao): impedir o herói de atravessar a quina do prédio
perf(cidade): instanciar janelas em um único InstancedMesh
docs(pr-007): registrar a visão de calor no cofre
```

---

## 📐 Outros arquivos

- **`README.md`** — o que é o jogo, como rodar, aviso de fã.
- **`PROJETOS.md`** — registro canônico do kit-mcp (pasta, repo, cofre).
- **`.github/workflows/`** — CI, check de documentação e deploy do Pages.
