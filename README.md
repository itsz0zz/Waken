# Waken

Joue sur ton Mac ou ton PC depuis ton iPhone, ton iPad ou un autre ordinateur, chez toi comme ailleurs. Rien d'autre à installer que Waken.

- **Mac et Windows** : une seule app, qui diffuse (serveur Sunshine embarqué) et qui joue (client).
- **iPhone, iPad, Android** : le client.

```
apps/mobile            App Expo (SDK 58) : iPhone, iPad (Android en V3)
apps/mac               Waken.app actuelle : Sunshine + agent + réseau Waken (fenêtre AppKit, remplacée par l'app React Native)
packages/ui            Design system Waken : tokens (rose néon), logo, composants, icônes Lucide
packages/core          Appareils, bibliothèque, client de l'agent, réveil
modules/waken-stream   Module natif de stream : moonlight-common-c + VideoToolbox
modules/waken-tunnel   Module natif du réseau Waken pour l'app iPhone
tunnel/                Réseau Waken (Go, Tailscale embarqué via tsnet)
agent/Waken.Agent      Agent (.NET 10) embarqué dans l'app hôte : appairage Sunshine, jeux installés, pochettes, lancement
server/Waken.Api       API homelab (.NET 10) : relais Wake-on-LAN, gardée pour le réveil (hors V1)
```

## Comment ça marche

```
iPhone ──réseau Waken (chiffré)──▶ Mac / PC
  127.0.0.1 : stream, agent           ├─ Sunshine (127.0.0.1)
                                      └─ Agent Waken (127.0.0.1)
```

1. **Connexion** : une fois par appareil, connexion au même compte (page Tailscale, avec Apple, Google, GitHub…).
2. **Découverte** : l'iPhone voit seul les ordinateurs qui font tourner Waken, et chacun lui donne le jeton de son agent, uniquement aux appareils du même compte.
3. **Bibliothèque** : l'agent trouve les jeux installés (Steam, Epic, GOG, apps Mac), récupère leurs pochettes et logos (SteamGridDB, Steam) et les ajoute à Sunshine.
4. **Stream** : l'agent lance le jeu, l'app ouvre la session. En chemin direct, pleine qualité ; via un relais (réseau à NAT dur), Waken passe seul en 720p.

## Mac (hôte)

```bash
git submodule update --init --recursive
sh apps/mac/build.sh        # télécharge Sunshine (vérifié), construit l'agent et le réseau, signe l'app
open apps/mac/build/Waken.app
```

- Clé SteamGridDB (pochettes des jeux hors Steam) : `~/.config/waken/steamgriddb.key`, intégrée au build.
- Signature : certificat « Apple Development » s'il est présent, sinon ad hoc (macOS oublie alors les autorisations à chaque build).
- Au premier lancement, Waken demande l'enregistrement de l'écran et le contrôle du Mac (macOS 27.3 : « System & App Protection Override »). Un clic sur Autoriser chacun, Waken redémarre ensuite le serveur seul.

## iPhone et iPad

```bash
pnpm install
sh tunnel/build.sh                                   # réseau Waken pour iOS
cd apps/mobile/ios && LANG=en_US.UTF-8 pod install && cd ..
pnpm exec expo run:ios                               # le module natif ne tourne pas dans Expo Go
```

### Pendant le stream

| Geste | Effet |
|---|---|
| Toucher | Clic gauche |
| Glisser | Glisser-déposer |
| Appui long, ou toucher à deux doigts | Clic droit |
| Glisser à deux doigts | Molette |
| Bouton clavier | Clavier virtuel |
| Quitter | Au choix : quitter le stream (le jeu continue) ou fermer le jeu |

## Tests

```bash
pnpm test                                     # core, module natif, API et agent
pnpm typecheck
cd tunnel && .cache/go/bin/go test ./...      # réseau Waken
```

## État

| | État |
|---|---|
| Stream iPhone → Mac via le réseau Waken (image, son, souris, clavier) | ✅ testé le 2026-11-23 sur un vrai iPhone |
| Bibliothèque automatique et pochettes | ✅ testé sur Mac (Hytale) |
| Chemin relayé (NAT dur) | ✅ 720p automatique, latence plus forte |
| App Windows (hôte + client) | à faire |
| App macOS en React Native | à faire |
| Android, PS5 (libchiaki), réveil à distance | plus tard |

## Licence

`modules/waken-stream` embarque moonlight-common-c (**GPLv3**) : une app distribuée avec ce module doit être publiée sous GPLv3.
