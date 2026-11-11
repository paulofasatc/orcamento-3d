# Orça3D — Orçamento de impressão 3D

Ferramenta estática (sem servidor) para calcular volume, peso estimado, tempo estimado e preço de venda de uma peça a partir de um arquivo STL. Tudo roda no navegador; o modelo não é enviado a nenhum servidor. Idioma: português (Brasil). Moeda: R$.

## O que ela faz

- Lê STL ASCII e binário no navegador
- Calcula o volume pelo método dos tetraedros com sinal, a área de superfície e a caixa delimitadora
- Mostra uma pré-visualização 3D (three.js)
- Estima o filamento usado com uma aproximação de casca (paredes) + preenchimento
- Estima o tempo de impressão pela vazão volumétrica (mm³/s), ajustada pela altura de camada
- Quebra os custos: filamento, energia, depreciação da máquina, mão de obra e reserva para falhas
- Sugere o preço de venda e o preço de anúncio já reajustado pela taxa do Mercado Livre ou da Shopee
- Guarda os parâmetros no `localStorage`

A lógica de cálculo está isolada em `src/quote.js`, pronta para virar uma API no futuro. O parser de STL está em `src/stl.js`.

## Como rodar localmente

Não precisa instalar dependências.

```bash
cd orcamento-3d
python3 -m http.server 4173
```

Abra http://localhost:4173 no navegador.

Os testes (incluem um cubo de 20 mm cujo volume deve ser 8000 mm³):

```bash
npm test
# ou: node tests/quote.test.js
```

## Como as contas são feitas

**Volume.** Cada triângulo ABC forma um tetraedro com a origem. Soma-se \(A \cdot (B \times C) / 6\) e usa-se o valor absoluto. Unidades assumidas: milímetros (padrão de STL para impressão 3D).

**Material.** Espessura das paredes = perímetros × largura da linha. Volume da casca ≈ min(volume sólido, área × espessura). O interior recebe o percentual de preenchimento. A massa é \((\mathrm{mm}^3 / 1000) \times\) densidade (g/cm³).

**Tempo.** Tempo de extrusão = volume de material / vazão efetiva, em que a vazão efetiva escala com `altura da camada / altura de referência`. Soma-se um tempo fixo de preparação (aquecimento). É uma estimativa grosseira — peças pequenas ou com muitos retracionamentos podem demorar mais.

**Custos.**

- Filamento = (massa em kg) × preço do kg
- Energia = horas × (W / 1000) × R$/kWh
- Máquina = horas × depreciação por hora
- Mão de obra = valor fixo de preparação
- Reserva para falhas = soma acima × margem de falha
- Custo total = soma + reserva
- Preço sugerido = custo total × (1 + margem de lucro)
- Preço de anúncio = preço sugerido / (1 − taxa do marketplace), para que o líquido depois da comissão seja o preço sugerido

Peso e tempo aparecem claramente como **estimativas**.

## Publicar (grátis)

O site é só HTML, CSS e JavaScript. Não tem etapa de build. Qualquer hospedagem estática serve. As duas opções mais simples:

### Opção 1 — Vercel (recomendada)

1. Crie uma conta gratuita em [vercel.com](https://vercel.com) (pode entrar com o GitHub).
2. Envie esta pasta para um repositório Git (GitHub, GitLab ou Bitbucket) — veja os comandos abaixo.
3. No painel da Vercel: **Add New… → Project**, importe o repositório.
4. Deixe o *Framework Preset* em **Other**. Não preencha *Build Command*. *Output Directory* pode ficar em branco (a raiz do projeto já é o site).
5. Clique em **Deploy**. Em um ou dois minutos o site entra no ar, com um endereço do tipo `https://orcamento-3d.vercel.app`.
6. Se quiser, ligue um domínio próprio em **Settings → Domains**.

Contas necessárias: uma conta Vercel (e, na prática, uma conta GitHub para importar o projeto).

### Opção 2 — GitHub Pages

1. Crie uma conta gratuita em [github.com](https://github.com).
2. Crie um repositório público (por exemplo `orcamento-3d`) e envie os arquivos:

```bash
cd orcamento-3d
git init
git add .
git commit -m "Initial commit: Orça3D"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/orcamento-3d.git
git push -u origin main
```

3. No GitHub: **Settings → Pages**. Em *Source*, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
4. Salve. Em alguns minutos o site fica em `https://SEU_USUARIO.github.io/orcamento-3d/`.

Contas necessárias: apenas uma conta GitHub.

### Comandos Git iniciais (as duas opções)

Se a pasta ainda não for um repositório:

```bash
cd orcamento-3d
git init
git add .
git commit -m "Initial commit: Orça3D"
```

Depois, crie o repositório vazio no GitHub e faça o `git remote add` + `git push` como acima.

## Limitações (MVP)

- Estimativa de material e tempo, não um fatiador. Não modela suportes, brim, retracionamento nem preenchimento especial.
- A casca pela área de superfície superestima um pouco nas arestas e não distingue paredes laterais de topo/base.
- Modelos já ocos podem ser superestimados.
- Assume STL em milímetros. Arquivos em polegadas ou metros saem com escala errada.
- A pré-visualização 3D precisa de um navegador com WebGL. O cálculo em si não depende disso.
- Sem backend, login, histórico na nuvem ou cobrança — o próximo passo natural é transformar `src/quote.js` numa API.

## Estrutura

```
index.html          página principal
css/styles.css
src/quote.js        cálculos puros (futura API)
src/stl.js          parser STL + volume + caixa
src/preview.js      pré-visualização three.js
src/app.js          interface e localStorage
vendor/             three.js e OrbitControls (locais)
tests/quote.test.js
tests/cube.stl      cubo de 20 mm (gerado pelos testes)
```
