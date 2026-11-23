# Déployer les comptes Waken avec Dokploy

Deux services, un seul compose (`server/docker-compose.cloud.yml`) :

| Service | Rôle | Adresse publique |
|---|---|---|
| `headscale` | Réseau Waken (Headscale 0.29.7) : les appareils s'y connectent | `https://net.wakenplay.fr` |
| `accounts` | Comptes, clés d'appareil, notifications (`server/Waken.Cloud`) | `https://api.wakenplay.fr` |

Dokploy construit l'image `accounts` depuis le dépôt et sert les deux en HTTPS par Traefik. Aucun port n'est publié.

Les données vont sur le disque iSCSI du serveur, dans `/srv/iscsi/docker-data/waken` :

| Dossier | Contenu |
|---|---|
| `headscale/` | le réseau (`db.sqlite`, clé privée du serveur, socket de la CLI) |
| `accounts/` | les comptes (`waken.db`) et les clés qui signent les sessions (`keys/`) |

Rien à créer à la main : au déploiement, un petit conteneur `accounts-init` crée `accounts/` et le donne à
l'utilisateur non root des images .NET (uid 1654), Docker crée `headscale/`. Pour un autre emplacement, la
variable `WAKEN_DATA` dans l'onglet **Environment**. Le disque iSCSI est vu comme un disque local : SQLite y est
fiable (à éviter sur NFS ou SMB). Il doit être monté avant que Docker démarre, sinon les conteneurs écriraient
dans un dossier vide du disque système.

## 1. DNS

Chez le registrar de `wakenplay.fr`, deux enregistrements `A` (et `AAAA` si le serveur a de l'IPv6) vers l'IP publique
du serveur Dokploy :

```
api.wakenplay.fr  A  <IP du serveur>
net.wakenplay.fr  A  <IP du serveur>
```

Avec Cloudflare : **proxy désactivé (nuage gris)** pour `net`, le protocole des appareils ne passe pas par le proxy
Cloudflare. `api` peut rester en gris aussi, c'est le plus simple. Les ports 80 et 443 doivent arriver au serveur
(Let's Encrypt).

## 2. Le service dans Dokploy

1. **Projects** : créer (ou ouvrir) le projet `Waken`.
2. **Create Service**, puis **Compose**, nom `waken-cloud`.
3. Onglet **General** :
   - Provider : ton Git (le dépôt `Waken/waken`) ;
   - Branch : la branche qui contient `server/docker-compose.cloud.yml` (`main` une fois fusionnée) ;
   - Compose Path : `./server/docker-compose.cloud.yml` ;
   - Compose Type : **Docker Compose**.
4. Onglet **Domains**, deux domaines :
   - `net.wakenplay.fr`, service `headscale`, port `8080`, HTTPS activé, certificat Let's Encrypt ;
   - `api.wakenplay.fr`, service `accounts`, port `8080`, HTTPS activé, certificat Let's Encrypt.
5. **Deploy**.

Au premier déploiement, `headscale` démarre et `accounts` redémarre en boucle avec
`Cloud:HeadscaleApiKey manquant` : normal, la clé n'existe pas encore.

## 3. La clé d'API Headscale

Dans le terminal du serveur (onglet **Terminal** du serveur dans Dokploy, ou en SSH) :

```bash
docker ps --format '{{.Names}}' | grep headscale
```

```bash
docker exec <nom du conteneur headscale> headscale apikeys create --expiration 365d
```

La commande affiche la clé une seule fois. Dans Dokploy, onglet **Environment** du service :

```
HEADSCALE_API_KEY=<la clé>
```

**Save**, puis **Deploy** à nouveau. Note la date d'expiration : dans un an, recréer une clé et la remplacer ici
(sinon les apps ne peuvent plus ajouter d'appareil).

## 4. Vérifier

```bash
curl https://api.wakenplay.fr/health
```

```bash
curl https://net.wakenplay.fr/health
```

Les deux répondent `ok` / `{"ok":true,...}`. Ensuite, dans l'app : **Créer un compte**, puis le Mac et l'iPhone se
connectent avec le même compte et se trouvent tout seuls.

Dans les logs du service `accounts` (onglet **Logs**), chaque événement du réseau apparaît, par exemple
`Notification device pour le compte ... : Nouvel appareil sur ton compte`.

## 5. Sauvegardes

Sauvegarder `/srv/iscsi/docker-data/waken` (de préférence service arrêté, ou avec `sqlite3 .backup`) :

- `headscale/` : le réseau. Le perdre déconnecte tous les appareils (ils devront se reconnecter à leur compte).
- `accounts/` : les comptes et les clés qui signent les sessions.

## 6. Notifications push (plus tard)

Il faut l'Apple Developer Program (équipe payante) : l'équipe personnelle n'a pas droit au push.

1. developer.apple.com, **Keys**, une clé « Apple Push Notifications service » : un fichier `.p8`, son Key ID, le Team ID.
2. Copier le `.p8` dans `/srv/iscsi/docker-data/waken/accounts/apns.p8` (vu comme `/data/apns.p8`), propriétaire 1654.
3. Variables du service :
   ```
   APNS_KEY_PATH=/data/apns.p8
   APNS_KEY_ID=<Key ID>
   APNS_TEAM_ID=<Team ID>
   APNS_IOS_TOPIC=<bundle id de l'app iPhone>
   APNS_MAC_TOPIC=<bundle id de l'app Mac>
   ```
4. Remettre l'autorisation push dans les apps (`aps-environment` côté iPhone, `com.apple.developer.aps-environment`
   côté Mac) et les recompiler avec l'équipe payante.

Sans ces variables, les notifications sont seulement écrites dans les logs.

## Tester en local

Avec Docker Desktop, la même pile tourne sur le Mac. Un fichier d'override publie les ports en local et pointe
les adresses sur `127.0.0.1` :

```bash
cd server && WAKEN_DATA=$(mktemp -d) docker compose -p waken-local -f docker-compose.cloud.yml -f <override local> up -d --build
```

Vérifié ainsi le 2026-11-23 : compte créé, clé d'appareil, tunnel Waken connecté sans page web,
session conservée après redémarrage, notification « nouvel appareil » émise.
