# Bathymétrie et marée — Ploumanac'h

> Cette branche `githubio` contient aussi une version entièrement statique à la
> racine du dépôt. Elle est directement publiable avec GitHub Pages, sans Node
> ni npm. La clé api-maree.fr est saisie dans la page et conservée uniquement
> dans le stockage local du navigateur.

## Publication avec GitHub Pages

Dans les paramètres GitHub du dépôt, ouvrir **Pages**, choisir **Deploy from a
branch**, sélectionner la branche `githubio` et le dossier `/ (root)`.

Pour tester localement la version statique :

```bash
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000>.

Carte interactive combinant la bathymétrie LITTO3D Shom/IGN, les hauteurs de
marée et plusieurs vues aériennes. La grille bathymétrique nécessaire au
fonctionnement est incluse dans le dépôt.

## Lancement immédiat

Prérequis : Node.js 22 ou plus récent.

```bash
git clone URL_DU_DEPOT
cd bathi/app
npm start
```

Ouvrir ensuite <http://localhost:3000>.

Le projet n'a aucune dépendance npm à installer. Sans configuration, il démarre
avec un modèle de marée simulé et les vues aériennes Esri et IGN.

## Marées réelles avec api-maree.fr

```bash
cd app
cp .env.example .env
```

Renseigner ensuite `TIDE_API_KEY` dans `app/.env`. Le fichier `.env` est ignoré
par Git afin de ne jamais publier les clés. La configuration fournie utilise le
site `ploumanac-h` et convertit les hauteurs ZH vers IGN69 avec l'offset Shom de
`-5.045 m`.

## Vue Google Satellite (facultative)

Activer la Map Tiles API dans un projet Google Cloud avec facturation, puis
renseigner `GOOGLE_MAPS_API_KEY` dans `app/.env`. Sans cette clé, l'option Google
reste désactivée ; Esri et IGN demeurent disponibles.

## Développement

```bash
cd app
npm run dev
```

Les fichiers bruts LITTO3D et les produits intermédiaires GDAL ne sont pas
versionnés. Le fichier final `app/data/bathy.bin`, requis à l'exécution, l'est.
