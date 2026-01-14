# Plan de Refactorisation : Division de cours.json en fichiers par slide

> **Pour Claude (instructions pour reprendre le travail):**
>
> Ce plan documente la refactorisation du fichier `content/cours.json` en plusieurs fichiers pour optimiser les tokens.
>
> **Fichiers clés à modifier:**
> - `content/cours.json` - Fichier source contenant tout le contenu (à diviser)
> - `netlify/functions/chat.js` - Fonction serverless du chatbot (à modifier)
>
> **À créer:**
> - `content/index.json` - Index avec résumés et mots-clés
> - `content/semaine_X/slide_Y.json` - Fichiers individuels par slide
>
> **Commande pour reprendre:** "Exécute le plan de refactorisation des tokens dans PLAN_REFACTORISATION_TOKENS.md"

---

## Objectif
Réduire la consommation de tokens de ~30 000 à ~300-500 par requête en divisant le fichier monolithique `cours.json` en fichiers individuels par slide avec un index intelligent.

## Structure Actuelle
```
content/
└── cours.json          # ~30 000 tokens (tout le contenu)
```

## Nouvelle Structure (Option C - Optimisée)
```
content/
├── index.json                    # ~800 tokens (métadonnées + résumés + mots-clés)
├── semaine_1/
│   ├── slide_1.json              # ~100-300 tokens chacun (contenu compressé)
│   ├── slide_2.json
│   └── ...
├── semaine_2/
│   └── ...
└── semaine_6/
    └── ...
```

## Optimisations Clés

### 1. Index Intelligent avec Résumés
L'index contient suffisamment d'info pour répondre aux questions simples SANS charger les slides :
```json
{
  "semaines": {
    "6": {
      "titre": "Statistiques Descriptives",
      "slides": [
        {
          "numero": 7,
          "titre": "Médiane",
          "resume": "Valeur centrale des données triées. Pour n impair: valeur du milieu. Pour n pair: moyenne des 2 valeurs centrales.",
          "mots_cles": ["médiane", "central", "trier", "milieu", "quartile"]
        }
      ]
    }
  }
}
```

### 2. Compression du Contenu des Slides
- Supprimer le formatage redondant (### SLIDE X : déjà dans les métadonnées)
- Convertir les tableaux verbeux en format compact
- Garder uniquement l'essentiel pédagogique

### 3. Chargement en 2 Niveaux
- **Niveau 1** : Index seul (~800 tokens) - suffisant pour 70% des questions
- **Niveau 2** : Index + 1 slide (~1000-1100 tokens) - pour explications détaillées

### 4. Cache Intelligent
- Index en mémoire permanente
- Slides récemment consultées en cache temporaire

---

## Fichiers à Modifier

### 1. `content/index.json` (CRÉER) - ~800 tokens
Structure optimisée avec résumés et mots-clés :
```json
{
  "semaines": {
    "1": {
      "titre": "Concepts Clés en Probabilité",
      "slides": [
        {
          "n": 1,
          "t": "Page de titre",
          "r": "Introduction au cours de statistique",
          "k": ["intro", "statistique"]
        },
        {
          "n": 5,
          "t": "Moyenne",
          "r": "Somme des valeurs divisée par n. Formule: x̄ = Σxi/n",
          "k": ["moyenne", "mean", "somme", "diviser"]
        }
      ]
    }
  }
}
```
- `n`: numéro, `t`: titre, `r`: résumé (1-2 phrases), `k`: mots-clés

### 2. `content/semaine_X/slide_Y.json` (CRÉER) - ~100-300 tokens chacun
Structure compacte :
```json
{
  "c": "**Univers** : S = {1, 2, 3, 4, 5, 6}\n\n**Événements** :\n- I = impair = {1, 3, 5}\n- P = pair = {2, 4, 6}"
}
```
- Pas de métadonnées redondantes (déjà dans index)
- Contenu compressé, formules essentielles uniquement

### 3. `netlify/functions/chat.js` (MODIFIER)

#### Modifications principales :

**a) Nouvelles fonctions de chargement :**
```javascript
// Charge uniquement l'index (métadonnées)
async function loadIndex(baseUrl) { ... }

// Charge une slide spécifique
async function loadSlide(baseUrl, semaine, slideNum) { ... }

// Charge toutes les slides d'une semaine (si nécessaire)
async function loadWeekSlides(baseUrl, semaine) { ... }
```

**b) Logique de chargement intelligent :**
```
Question reçue
    ↓
Charger index.json (toujours, ~800 tokens)
    ↓
Analyser la question :
    ├─ "slide X semaine Y" → Charger slide spécifique (+200 tokens)
    ├─ "semaine X" → Charger toutes slides de la semaine (+2000-3000)
    └─ Question générale → Utiliser résumés de l'index (0 tokens supplémentaires)
                          ↓
                    Si besoin de détails → Charger 1-2 slides pertinentes (+400)
```

**c) Prompt système adaptatif :**
- Pour questions simples : injecter seulement les résumés pertinents de l'index
- Pour questions détaillées : injecter le contenu complet de la slide

**d) Supprimer les fonctions devenues inutiles :**
- `extractSlide()` - plus nécessaire (slides déjà séparées)
- `getSlideIndex()` - remplacé par l'index.json

---

## Étapes d'Implémentation

### Étape 1 : Créer le script de migration
Créer un script PowerShell/Node.js pour :
1. Lire `cours.json`
2. Générer `index.json`
3. Créer les dossiers `semaine_X/`
4. Générer les fichiers `slide_Y.json`

### Étape 2 : Générer les nouveaux fichiers
Exécuter le script pour créer la nouvelle structure.

### Étape 3 : Modifier `chat.js`
1. Remplacer `loadCoursContent()` par les nouvelles fonctions
2. Adapter la logique de construction du prompt
3. Conserver le caching en mémoire pour l'index

### Étape 4 : Tester
1. Tester localement avec `netlify dev`
2. Vérifier les 3 cas d'usage :
   - Question sur slide spécifique
   - Question sur semaine
   - Question générale

### Étape 5 : Nettoyer
Supprimer `cours.json` une fois la migration validée.

---

## Estimation des Tokens par Cas d'Usage

| Cas | Avant | Après | Réduction |
|-----|-------|-------|-----------|
| Question simple (résumé suffit) | 30 000 | ~800 | **-97%** |
| Slide spécifique | 30 000 | ~1 000 | **-97%** |
| Question complexe (2-3 slides) | 30 000 | ~1 500 | **-95%** |
| Semaine complète (rare) | 30 000 | ~4 000 | -87% |

### Détail des calculs :
- **Index seul** : ~800 tokens (résumés + mots-clés pour toutes les slides)
- **1 slide** : ~200 tokens en moyenne (contenu compressé)
- **Question simple** : Index seul suffit grâce aux résumés
- **Question détaillée** : Index (~800) + slide (~200) = ~1 000 tokens

---

## Vérification

1. **Test local** : `netlify dev` et tester le chatbot
2. **Cas de test** :
   - "Explique-moi la slide 5 de la semaine 1"
   - "C'est quoi la médiane?"
   - "Quelles semaines sont disponibles?"
3. **Vérifier** : Réponses identiques à avant la migration

---

## Risques et Mitigations

| Risque | Mitigation |
|--------|------------|
| Erreur de parsing des slides | Validation du script de migration |
| Latence accrue (plusieurs fetches) | Caching de l'index en mémoire |
| Régression fonctionnelle | Tests manuels des 3 cas d'usage |
