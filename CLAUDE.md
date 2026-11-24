# Waken : contexte pour Claude Code

App perso d'Enzo : réveiller son PC Windows (ou sa PS5) à distance et jouer en streaming depuis Mac / iPhone / iPad.
Réponds en français.

## Architecture
- `apps/mobile` : Expo SDK 58 + expo-router, TypeScript strict. Écrans : (tabs) Accueil/Jeux/Appareils/Réglages, `device/[id]`, `wake/[id]`, `stream/[id]`.
- `packages/ui` : design system Waken (thème Nuit). Couleur principale **neon #FF3D7F** (texte dessus #0A0B10), fonds bg0→bg3, Unbounded (titres), Inter (UI), JetBrains Mono (métriques). Icônes **Lucide uniquement** (`lucide-react-native`), jamais d'emoji. Une seule action en `neon` par écran.
- `packages/core` : types appareils, méthodes de réveil (`homelab-relay`, `shelly-cloud`, `playstation`, `wake-on-lan`, `none`), `wakeAndWait` (étapes signal → ping agent → Sunshine → stream), `AgentClient`, `WakenApi`.
- Manettes (page `screens/Gamepads.tsx`, réglages `settings.gamepads`) : `Bridge/MLGamepads.m` (iPhone et Mac, GameController + CoreHaptics) et `apps/windows/windows/Waken/Stream/Gamepads.cpp` (SDL3 en sous-module `apps/windows/windows/vendor/SDL`, compilé une fois par CMake via `SDL.targets`). Vibrations, gâchettes, gyro, pavé tactile, LED, batterie. Hôte Mac : Sunshine n'a pas de manette virtuelle.
- `modules/waken-stream` : module Expo natif (V2). iOS : `Bridge/MLStreamSession.m` (moonlight-common-c + VideoToolbox → AVSampleBufferDisplayLayer), `WakenStreamView.swift` (manette/souris/clavier). Android = placeholder (V3). moonlight-common-c en sous-module dans `ios/vendor/` (GPLv3).
- `server/Waken.Api` : .NET 10 minimal API sur le homelab (Docker Swarm, réseau host) : relais Wake-on-LAN, statut, jaquettes SteamGridDB en cache.
- `server/Waken.Cloud` : comptes Waken (.NET 10, Identity + SQLite) devant Headscale v0.29.7 (`server/headscale`, `docker-compose.cloud.yml`, `server/DEPLOY.md` pour Dokploy). `/network/join` donne `controlUrl` + clé d'appareil à usage unique (10 min) que le tunnel prend dans `authKey`. Adresses `api.wakenplay.fr` / `net.wakenplay.fr`, déployé. Bibliothèque : l'app hôte envoie ses jeux (`PUT /library/{nom réseau}`, images en adresses publiques via l'agent `GET /library`), les autres appareils lisent `GET /library` ; la machine n'est jointe que pour réveiller et jouer. Apps : `packages/app/src/account.ts` (mode compte ou Tailscale, `networkFor`), écran `AccountOverlay`, notifications APNs (expo-notifications sur iPhone, `PushRegistrar.swift` sur Mac, `NetworkWatcher` côté serveur).
- `tunnel/` : réseau Waken (Go, tsnet = Tailscale embarqué). Hôte (Mac/PC) : Sunshine et l'agent restent sur 127.0.0.1, le tunnel n'accepte que les appareils du même compte et donne le jeton de l'agent (port 47101). Client (iPhone) : ports de stream relayés depuis 127.0.0.1 vers l'hôte choisi (`setPeer`), agents joints via le proxy `http://127.0.0.1:47102/h/<hôte>/`. `tunnel/build.sh` produit `waken-tunnel` (Mac) et `WakenTunnel.xcframework` (copié dans `modules/waken-tunnel`).
- `agent/Waken.Agent` : .NET 10 sur le PC, port 47100. Lancé par l'app Windows, ou dès le démarrage de Windows en SYSTEM (`apps/windows/scripts/install-service.ps1`, tâche planifiée « Waken », Sunshine lancé dans la session à l'écran via `Host/ConsoleSession.cs`, réglages dans `%ProgramData%\Waken\agent.json`). Appairage GameStream automatique avec Sunshine (PIN tapé via l'API admin 47990), /apps, /launch (renvoie rtspSessionUrl + riKey), /quit, /shutdown, /sleep.

## Réseau
- Tout passe par Tailscale (PC en « Run unattended »). Box : **Livebox 6**, qui n'envoie pas de WoL et perd l'ARP du PC éteint. Réveil `wake-on-lan` (`packages/app/src/wakeOnLan.ts`) : l'hôte laisse MAC, IP, broadcast et IP publique dans sa bibliothèque sur le serveur ; le client envoie le paquet par lui-même (agent local sur desktop, socket sur iPhone), vers l'IP publique (redirection UDP 9 sur la box, marche depuis la veille grâce à l'ARP offload) et via les agents des autres machines allumées (`POST /wake`). Sinon relais homelab ou prise Shelly. PC sur un port 1 Gb/s de la box.
- PS5 : chiaki-ng v1.10.1 (AGPLv3) et mbedtls 2.28.10 en sous-modules dans `modules/waken-stream/ios/vendor/`, compilés dans les pods (Mac et iPhone) : cœur réseau local seulement, la partie Internet de Sony (curl, json-c…) remplacée par `ios/Chiaki/remote_stubs.c` ; messages nanopb générés une fois dans `ios/Chiaki/generated` ; `ios/Chiaki/build-check.sh` compile tout avec clang. Pont `Bridge/MLPlayStation.m` (découverte, liaison avec le code à 8 chiffres, réveil) ; Windows : même code via `apps/windows/windows/Chiaki/Chiaki.vcxproj` (bibliothèque statique, un dossier d'objets par groupe car chiaki et mbedtls ont des fichiers de même nom) et `Waken/Stream/PlayStation.cpp`. Compte PSN : `packages/core/src/psn.ts` (page de Sony, l'adresse de redirection collée dans l'app). Écran `screens/PlayStationAdd.tsx`. Stream PS5 dans Waken : à faire (en attendant, l'app PS Remote Play).

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
- `sh apps/macos/scripts/build.sh` (Waken.app React Native : Sunshine + agent + tunnel ; clé SteamGridDB lue dans ~/.config/waken/steamgriddb.key). `apps/mac/build.sh` est l'ancienne app hôte sans interface.
