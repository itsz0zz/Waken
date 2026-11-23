# Waken : contexte pour Claude Code

App perso d'Enzo : réveiller son PC Windows (ou sa PS5) à distance et jouer en streaming depuis Mac / iPhone / iPad.
Réponds en français.

## Architecture
- `apps/mobile` : Expo SDK 58 + expo-router, TypeScript strict. Écrans : (tabs) Accueil/Jeux/Appareils/Réglages, `device/[id]`, `wake/[id]`, `stream/[id]`.
- `packages/ui` : design system Waken (thème Nuit). Couleur principale **neon #FF3D7F** (texte dessus #0A0B10), fonds bg0→bg3, Unbounded (titres), Inter (UI), JetBrains Mono (métriques). Icônes **Lucide uniquement** (`lucide-react-native`), jamais d'emoji. Une seule action en `neon` par écran.
- `packages/core` : types appareils, méthodes de réveil (`homelab-relay`, `shelly-cloud`, `playstation`, `none`), `wakeAndWait` (étapes signal → ping agent → Sunshine → stream), `AgentClient`, `WakenApi`.
- `modules/waken-stream` : module Expo natif (V2). iOS : `Bridge/MLStreamSession.m` (moonlight-common-c + VideoToolbox → AVSampleBufferDisplayLayer), `WakenStreamView.swift` (manette/souris/clavier). Android = placeholder (V3). moonlight-common-c en sous-module dans `ios/vendor/` (GPLv3).
- `server/Waken.Api` : .NET 10 minimal API sur le homelab (Docker Swarm, réseau host) : relais Wake-on-LAN, statut, jaquettes SteamGridDB en cache.
- `server/Waken.Cloud` : comptes Waken (.NET 10, Identity + SQLite) devant Headscale v0.29.7 (`server/headscale`, `docker-stack.cloud.yml`). `/network/join` donne `controlUrl` + clé d'appareil à usage unique (10 min) que le tunnel prend dans `authKey`. Adresses `api.wakenplay.fr` / `net.wakenplay.fr`, pas encore déployé. Apps : `packages/app/src/account.ts` (mode compte ou Tailscale, `networkFor`), écran `AccountOverlay`, notifications APNs (expo-notifications sur iPhone, `PushRegistrar.swift` sur Mac, `NetworkWatcher` côté serveur).
- `tunnel/` : réseau Waken (Go, tsnet = Tailscale embarqué). Hôte (Mac/PC) : Sunshine et l'agent restent sur 127.0.0.1, le tunnel n'accepte que les appareils du même compte et donne le jeton de l'agent (port 47101). Client (iPhone) : ports de stream relayés depuis 127.0.0.1 vers l'hôte choisi (`setPeer`), agents joints via le proxy `http://127.0.0.1:47102/h/<hôte>/`. `tunnel/build.sh` produit `waken-tunnel` (Mac) et `WakenTunnel.xcframework` (copié dans `modules/waken-tunnel`).
- `agent/Waken.Agent` : .NET 10 sur le PC (tâche SYSTEM au démarrage, port 47100, limité à Tailscale). Appairage GameStream automatique avec Sunshine (PIN tapé via l'API admin 47990), /apps, /launch (renvoie rtspSessionUrl + riKey), /quit, /shutdown, /sleep.

## Réseau
- Tout passe par Tailscale (PC en « Run unattended »). Box : **Livebox 6**, qui n'envoie pas de WoL et perd l'ARP du PC éteint → réveil via le relais homelab ou une prise Shelly. PC sur un port 1 Gb/s de la box.
- PS5 : V1 ouvre l'app PS Remote Play ; V3 = libchiaki.

## Vérifié / à faire
- ✅ `pnpm test` (core, natif, API, agent), `pnpm typecheck`, build iOS avec Xcode 27.2 (la bêta 27A5209h ne compile pas react-native-screens).
- ⚠️ Agent testé contre un faux Sunshine fidèle à v2026.914 (`agent/Waken.Agent.Tests/FakeSunshine.cs`), jamais contre un vrai → premier test à faire sur le PC.
- ✅ 2026-11-23 : stream réel iPhone physique → Mac (Waken.app) à travers le tunnel : image, son, clics, clavier. Bibliothèque auto (Hytale, pochettes SteamGridDB).
- ⚠️ Réseau à NAT dur (ex. réseau d'établissement 195.221.x) : chemin relayé (DERP), l'app passe seule en 720p / 6 Mb/s. Débit plein seulement en chemin direct.
- RTSP : Sunshine v2026.914 rattache la connexion à la session en attente sans comparer les IP (lu dans rtsp.cpp). Le client doit se connecter dans les 10 s après /launch.
- Pièges macOS 27.3 : contrôle souris/clavier = page « System & App Protection Override » (ancre `Privacy_Accessibility`), la page « Accessibilité » n'accepte plus que les apps d'aide ; c'est Waken (processus parent) qui doit demander l'accès, puis Sunshine redémarré. Signer Waken.app avec le certificat Apple Development, sinon chaque build perd ses autorisations.
- Piège édition de liens iOS : `libWakenTunnel.a` (pod) et `libwakentunnel.a` se confondent sur disque insensible à la casse, d'où `libwakennet.a`.
- Pièges : bufferList moonlight = un élément par paquet RTP (toujours concaténer) ; POST /api/pin ne répond qu'après la fin de l'appairage (ne pas l'attendre avant) ; ne jamais couper une prise sans mesure de puissance ; ATS : NSAllowsLocalNetworking annule NSAllowsArbitraryLoads.
- À faire : import et édition des jeux, éteindre / veille dans l'app, PS5 (libchiaki), mise en page Mac, Android.

## Commandes
- `pnpm install` (racine, workspaces pnpm, jamais npm)
- `git submodule update --init --recursive` (après un clone : moonlight-common-c)
- `cd apps/mobile && pnpm exec expo run:ios` (le module natif ne tourne pas dans Expo Go)
- `cd apps/mobile && pnpm exec tsc --noEmit`
- `dotnet build server/Waken.Api` / `dotnet build server/Waken.Cloud` / `dotnet build agent/Waken.Agent`
- `pnpm test` (tous les tests) ; `cd tunnel && .cache/go/bin/go test ./...` (tunnel)
- `sh tunnel/build.sh` puis `cd apps/mobile/ios && LANG=en_US.UTF-8 pod install` (après un changement du tunnel)
- `sh apps/mac/build.sh` (Waken.app : Sunshine + agent + tunnel ; clé SteamGridDB lue dans ~/.config/waken/steamgriddb.key)
