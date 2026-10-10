# ApplyPilot

**Postule plus vite à tes stages, sans retaper les mêmes infos.** ApplyPilot est une extension Chrome locale + un petit serveur sur ta machine :

- 📄 **Lettres de motivation sur mesure** : l'IA lit l'offre et ton CV (LaTeX), puis rédige une lettre dans la langue de l'offre, dans ton style. Elle produit un PDF propre d'une page, que tu peux retoucher.
- ✍️ **Remplissage automatique des formulaires** : Workday (pays, adresse, téléphone, « How did you hear about us? », expériences, formations, dates, questions oui/non, déclarations volontaires…), Greenhouse, Lever et la plupart des sites carrière maison.
- 📎 **Pièces jointes** : le bon CV (FR, EN ou variante spécialisée) et la lettre sont joints automatiquement.
- 🧠 **Questions ouvertes** : « Pourquoi nous ? » et les questions propres à chaque entreprise sont rédigées par l'IA, sans jamais inventer de faits.
- 🗂️ **Journal des candidatures** : statut, date, CV et lettre envoyés, avec export CSV.
- 🔁 **Mémoire** : tes réponses aux questions récurrentes sont retenues pour les candidatures suivantes.

> ApplyPilot **ne clique jamais sur « Soumettre »**. Il remplit, surligne ce qu'il faut vérifier, et c'est toi qui envoies.

<p align="center"><img src="docs/panneau.png" width="320" alt="Panneau latéral d'ApplyPilot"> &nbsp; <img src="docs/remplissage-workday.png" width="460" alt="Formulaire Workday rempli : vert = rempli, orange = à vérifier"></p>

## Comment ça marche

```
 Chrome ──────────────────────────────┐        ┌───────────── ta machine ─────────────┐
 │ Page de l'offre / formulaire      │        │  Serveur ApplyPilot (127.0.0.1)     │
 │   ↑ remplit les champs            │  HTTP  │   • profile.yaml (tes infos)        │
 │ Panneau latéral ApplyPilot ───────┼───────►│   • dossier de CV (.pdf + .tex)     │
 │   analyser · lettre · remplir     │        │   • pi --print → lettres, réponses  │
 └───────────────────────────────────┘        │   • Chrome headless → PDF           │
                                               │   • data/ : candidatures, journal   │
                                               └─────────────────────────────────────┘
```

L'extension ne peut ni lire tes fichiers ni appeler l'IA. C'est le serveur local qui s'en charge :

- il lit ton profil et tes CV ;
- il appelle [pi](https://pi.dev) en mode non interactif (avec ta connexion existante, donc aucune clé API supplémentaire) ;
- il produit le PDF de la lettre avec Chrome ;
- il tient le journal de tes candidatures.

## Installation

Prérequis :

- **Node.js 20+** ;
- **Google Chrome** ou **Edge** ;
- **[pi](https://pi.dev)** installé et connecté à un fournisseur de modèle. Sinon, indique la commande dans `config.yaml → llm.command`.

1. **Récupère le projet**
   ```sh
   git clone https://github.com/Mbaka11/ApplyPilot.git
   ```
2. **Démarre le serveur** : double-clique sur `start.cmd` (Windows) ou lance `./start.sh` (macOS/Linux).
   - Au premier lancement, les dépendances s'installent automatiquement.
   - Les fichiers `config.yaml` et `profile.yaml` sont créés à partir des exemples.
   - Laisse la fenêtre ouverte pendant que tu postules.
3. **Configure** :
   - `config.yaml` : `cvDir` = le dossier de tes CV. Pour chaque `X.pdf`, ApplyPilot lit aussi `X/main.tex` ou `X.tex`. Décris tes variantes dans `cvs` (langue, mots-clés).
   - `profile.yaml` : toutes tes infos (coordonnées, études, expériences, réponses aux questions d'admissibilité…). Les modifications sont prises en compte immédiatement.
   - Facultatif : place une ou deux de tes anciennes lettres en `.txt` dans `data/style/`, pour que l'IA imite ton style.
4. **Installe l'extension** :
   - va dans `chrome://extensions` ;
   - active le **Mode développeur** ;
   - clique sur **Charger l'extension non empaquetée** et choisis le dossier `extension/` ;
   - épingle l'icône ApplyPilot : un clic ouvre le panneau latéral.

## Utilisation

1. **Ouvre l'offre** (sur Workday, LinkedIn → site de l'entreprise, etc.) puis clique sur **Analyser cette offre**. La candidature devient *active* et reste active pendant que tu passes d'une page à l'autre du formulaire. Le CV le plus adapté est présélectionné (★).
2. **Génère la lettre**. Compte 20 à 60 s. Relis-la, corrige-la dans le panneau, puis clique sur **Mettre à jour le PDF**. Les avertissements listent ce que l'IA n'a pas pu confirmer (disponibilités, niveau de langue…).
3. **Clique « Postuler » sur le site**, puis **Remplir cette page** à chaque étape :
   - 🟩 **vert** : rempli depuis ton profil ;
   - 🟧 **orange** : à vérifier (réponses oui/non d'admissibilité, réponses de l'IA, cases de consentement à cocher toi-même) ;
   - 🟥 **rouge** : à compléter (info absente du profil : le panneau indique la clé à ajouter dans `profile.yaml`).

   Clique sur un élément de la liste pour aller au champ concerné.
4. **Vérifie, passe à l'étape suivante**, relance le remplissage, puis **soumets toi-même** et clique sur **J'ai soumis ✓**.
5. Suis tes candidatures dans l'onglet **Journal** (statuts : soumise, entrevue, refusée, offre…), avec un export CSV. Le fichier `data/candidatures.csv` est aussi tenu à jour.

### Astuces Workday

- **Autofill with Resume** : ApplyPilot joint ton CV, Workday le lit, puis ApplyPilot complète et corrige le reste.
- **Apply Manually** : ApplyPilot ajoute lui-même tes blocs *Expérience* et *Formation* si les sections sont vides (option du panneau).
- Un compte par entreprise reste nécessaire. ApplyPilot remplit le courriel, et le gestionnaire de mots de passe de Chrome s'occupe du reste.

### Mémoire des réponses

Les questions que ton profil ne couvre pas, par exemple « Do you have a valid driver's license? », sont retenues quand tu cliques sur *Suivant* (ou *Mémoriser mes réponses*). Elles sont réutilisées automatiquement la fois suivante. Tu peux les gérer dans l'onglet **Profil**.

## Confidentialité et sécurité

- Tout reste **sur ta machine** : le serveur écoute uniquement `127.0.0.1` et refuse les requêtes venant de sites web (contrôle des en-têtes `Origin` et `Host`).
- `profile.yaml`, `config.yaml` et `data/` (lettres, journal, mémoire) sont **exclus de git**.
- Pour rédiger, l'offre, ton CV et ton profil sont envoyés au modèle configuré dans pi (ton fournisseur habituel). Rien d'autre ne quitte ta machine.
- Les mots de passe, CAPTCHA, signatures et cases de consentement ne sont **jamais** remplis.

## Limites

- Aucune soumission automatique, et c'est voulu : une mauvaise réponse envoyée peut couler une candidature.
- Chaque site a ses particularités. Les composants inhabituels (calendriers, listes exotiques) peuvent rester en rouge : complète-les à la main.
- Les réponses générées par l'IA sont toujours marquées « à vérifier ».

## Configuration (extrait)

| Clé | Rôle |
|---|---|
| `cvDir`, `cvs[]` | Dossier des CV ; langue, libellé et mots-clés de chaque variante |
| `llm.model`, `llm.letterThinking` | Modèle pi (vide = modèle par défaut) et niveau de réflexion |
| `letter.paper`, `letter.showHeader` | Format (Letter/A4) et en-tête nom + coordonnées |
| `letter.fileNameFr` / `fileNameEn` | Nom du PDF, ex. `{first}_{last}_Lettre_de_motivation_{company}.pdf` |
| `fill.attachLetterWithCv` | Joint aussi la lettre dans le champ CV s'il accepte plusieurs fichiers |

## Dépannage

| Problème | Solution |
|---|---|
| « Serveur arrêté » dans le panneau | Lance `start.cmd`, puis clique sur le badge pour revérifier |
| Rien ne se passe sur une page | Recharge la page (F5), surtout après une mise à jour de l'extension |
| « Impossible d'écrire … .pdf » | Ferme le PDF s'il est ouvert dans Acrobat ou un autre lecteur |
| Erreur pi | Lance `pi` une fois dans un terminal pour vérifier la connexion (`/login`) |
| Accents bizarres dans Excel | Le CSV utilise `;` et l'UTF-8 avec BOM. Ouvre-le avec *Données → À partir d'un fichier texte* si besoin |

## Tests

```sh
cd server
npm test                 # serveur + scripts de contenu + extension complète (Chrome headless)
set APPLYPILOT_TEST_LLM=1 && npm run test:server   # + vraie génération via pi (Windows)
```

Les tests utilisent des pages qui imitent Workday et un formulaire générique, ainsi qu'un profil fictif. Ils n'utilisent jamais tes données.

## Structure

```
extension/        Extension Chrome (MV3) : panneau latéral + scripts de contenu
  content/        dom · extract (offre) · fields (inventaire) · widgets · mapping (règles) · workday · main
  sidepanel/      interface du panneau
server/src/       Serveur local : config, CV, pi, lettre → PDF, journal, mémoire
tests/            Tests (serveur, contenu, bout en bout) et pages de test
config.example.yaml, profile.example.yaml
```
