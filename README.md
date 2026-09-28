# Superman — Metropolis Flight

Jogo de voo em 3D que roda no navegador: o jogador é o Superman sobrevoando uma
Metropolis procedural, com visão de calor, supervelocidade e resgates.

Feito com **Three.js** (WebGL2), **Vite** e geração procedural de cidade, modelos
e texturas, sem nenhum asset binário baixado de terceiros.

> Projeto de fã, sem fins comerciais e sem vínculo com a DC Comics ou a Warner
> Bros. Discovery. Superman e os nomes, personagens e marcas relacionados
> pertencem aos seus donos; nenhum direito sobre eles é reivindicado. O código
> deste repositório é original, e a licença (MIT) cobre só ele.

## Jogar

**https://victornascimento14.github.io/Superman/** — publicado a cada merge na `main`.

Clique para voar · mouse olha · W A S D voa · Espaço sobe · C desce · Shift acelera
(segure para supervelocidade) · T troca a hora do dia · Esc pausa.

## Rodar

Requer Node.js 20.19+ ou 22.12+ e um navegador com WebGL2.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm test
npm run build    # build de produção em dist/
```

## Documentação

O cofre Obsidian do projeto vive em
[VictorNascimento14/Obsidian-Superman](https://github.com/VictorNascimento14/Obsidian-Superman):
notas de PR, ADRs, changelog e aprendizados.
