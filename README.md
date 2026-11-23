# Waken

Allume ton PC ou ta console à distance et joue en streaming depuis ton Mac, iPhone ou iPad.

```
apps/mobile          App Expo (SDK 58) : iOS, iPadOS, Mac (Apple Silicon), Android
packages/ui          Design system Waken : tokens (rose néon), logo, composants, icônes Lucide
packages/core        Appareils, méthodes de réveil, détection Sunshine/agent, client agent & API
modules/waken-stream Module natif de stream (V2) : moonlight-common-c + VideoToolbox (iOS/macOS)
server/Waken.Api     API homelab (.NET 10) : relais Wake-on-LAN, statut, jaquettes SteamGridDB
agent/Waken.Agent    Agent Windows (.NET 10) : santé, appairage Sunshine automatique, lancement, extinction
```

## Comment ça marche

```
iPhone / Mac ──Tailscale──▶ API homelab ──Wake-on-LAN──▶ PC
      │                                                  │
      ├──Tailscale──▶ Agent Waken (PC) ──GameStream──▶ Sunshine
      └──Tailscale──▶ flux RTSP/vidéo (moonlight-common-c) ◀── Sunshine
```

1. **Réveil** : l'app demande à l'API du homelab d'envoyer le paquet magique sur le LAN (ou coupe/rallume une prise Shelly).
2. **Attente** : l'app interroge l'agent (`/health`), puis Sunshine (`:47989/serverinfo`) via Tailscale.
3. **Lancement** : l'agent, sur le PC, s'appaire tout seul avec Sunshine la première fois (il tape le PIN via l'API admin de Sunshine), puis lance le jeu et renvoie l'URL de session RTSP + la clé d'entrée.
4. **Stream** : V1 → l'app ouvre Moonlight. V2 → l'écran de stream de Waken (module natif) ouvre la session.

## Pourquoi un relais avec une Livebox 6

La Livebox 6 n'envoie pas de Wake-on-LAN elle-même, et une redirection de port vers le PC ne tient pas : une fois le PC éteint, la box oublie son adresse matérielle (table ARP) et le paquet se perd. Deux options fiables :

- **Relais homelab** (par défaut) : `server/Waken.Api` en réseau `host`.
- **Prise Shelly** : se choisit dans Waken (Appareils → PC → Réveil). Active **Restore on AC Power Loss → Power On** dans le BIOS. La prise doit **mesurer la puissance** : Waken ne coupe que si elle voit 5 W ou moins, et refuse sinon. Un PC en veille peut passer sous ce seuil : utilise la prise avec un PC éteint, pas en veille.

> Branche le PC sur un port **1 Gb/s** de la Livebox : plusieurs utilisateurs signalent que le réveil depuis l'extinction ne marche pas sur le port 2,5 Gb/s.

## Mise en place

### 1. PC Windows

- **BIOS** : Wake-on-LAN activé (« Power On by PCI-E »), ErP / Deep Sleep désactivés.
- **Windows** : démarrage rapide désactivé ; carte réseau → « Wake on Magic Packet » activé.
- **Tailscale** : installé, avec **Run unattended** coché (sinon pas joignable avant ta connexion).
- **Sunshine** (ou Apollo) installé en service, avec des identifiants admin.
- **Runtime** : `winget install Microsoft.DotNet.AspNetCore.10` (et le SDK .NET 10 si tu publies l'agent depuis le PC).
- **Agent**, dans un PowerShell administrateur :
  ```powershell
  cd agent
  dotnet publish Waken.Agent -c Release -o publish
  .\install-agent.ps1
  ```
  Le script demande le mot de passe admin de Sunshine, génère le jeton et l'affiche : saisis-le dans Waken (Appareils → PC → Jeton de l'agent). Relancer le script met à jour en gardant le jeton (`-NewToken` pour en changer). Secrets et certificat sont dans `C:\ProgramData\Waken`, lisibles par SYSTEM et les administrateurs seulement.
- **Jeux** : le nom d'un jeu dans Waken doit exister à l'identique dans les applications de Sunshine (Desktop et Steam Big Picture y sont par défaut, pas Call of Duty). Sinon le lancement échoue en listant les noms disponibles, sans fermer le jeu en cours.

### 2. Homelab (Docker Swarm)

Génère un jeton avec `openssl rand -hex 32`, garde-le dans ton gestionnaire de mots de passe, puis :

```bash
cd server
export WAKEN_IMAGE=ghcr.io/mon-compte/waken-api:0.3.0
docker buildx build --platform linux/amd64 -t "$WAKEN_IMAGE" --push Waken.Api
```

Sur le manager Swarm :

```bash
docker node update --label-add lan=true NOM_DU_NOEUD
export WAKEN_IMAGE=ghcr.io/mon-compte/waken-api:0.3.0
export PC_MAC=AA:BB:CC:DD:EE:FF PC_LAN_IP=192.168.1.42 PC_BROADCAST=192.168.1.255
read -rs WAKEN_TOKEN && export WAKEN_TOKEN
docker stack deploy --with-registry-auth -c docker-stack.yml waken
curl http://localhost:8085/health
```

L'API et l'agent **refusent de démarrer** sans jeton d'au moins 24 caractères. Clé SteamGridDB facultative (`STEAMGRIDDB_KEY`) : steamgriddb.com → Preferences → API.

### 3. PS5

Réglages → Système → Économie d'énergie → Fonctionnalités en mode repos : **Rester connecté à Internet** + **Activer l'allumage de la PS5 depuis le réseau**. En V1, Waken ouvre l'app officielle PS Remote Play (renseigne son lien dans Réglages).

### 4. App

```bash
pnpm install
git submodule update --init --recursive
cd apps/mobile
pnpm exec expo run:ios       # build de dev (le module natif ne tourne pas dans Expo Go)
```

Sur Mac : lance la version iPad sur Apple Silicon (Xcode → destination « My Mac (Designed for iPad) »).
Dans Waken :

- **Réglages** : adresse de l'API (`http://homelab:8085`), jeton du relais, moteur de stream, qualité.
- **Appareils → PC** : nom MagicDNS ou IP 100.x, jeton de l'agent, méthode de réveil.

En HTTP, iOS n'autorise que les noms courts, `.local`, `*.ts.net` et les IP privées ou Tailscale (voir `app.json`). iOS 17 minimum, pour ces plages d'IP.

### 5. Pendant le stream

| Geste | Effet sur le PC |
|---|---|
| Toucher | Clic gauche |
| Glisser | Glisser-déposer |
| Appui long, ou toucher à deux doigts | Clic droit |
| Glisser à deux doigts | Molette |
| Bouton clavier | Clavier virtuel (PIN Windows, texte) |
| Quitter | Au choix : quitter le stream (le jeu continue) ou fermer le jeu |

## Tests

```bash
pnpm test        # core, module natif (Mac + Xcode), API et agent
pnpm typecheck
```

## État V1 / V2

| | État |
|---|---|
| Design system, écrans, édition des appareils | ✅ typecheck, build et simulateur iOS |
| Réveil relais homelab, prise Shelly | ⚠️ testé avec réseau simulé, **jamais avec le vrai PC ni une vraie prise** |
| Jaquettes SteamGridDB en cache | ✅ côté API |
| Agent : appairage auto, apps, lancement | ⚠️ testé contre un faux Sunshine (API v2026.914 et antérieure), **à valider sur ton PC** |
| Stream natif : vidéo, son Opus stéréo, manette, souris, clavier, tactile | ⚠️ logique testée et build OK, **jamais testé avec un vrai flux** |
| Android stream natif, PS5 intégrée (libchiaki) | V3 |

## Licence

`modules/waken-stream` embarque moonlight-common-c (**GPLv3**) : une app distribuée avec ce module doit être publiée sous GPLv3.
