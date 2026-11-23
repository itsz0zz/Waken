using System.Net;
using System.Text;
using Waken.Agent.Games;

namespace Waken.Agent.Tests;

public sealed class GamesTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("waken-games-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public void Parses_valve_keyvalues_with_comments_escapes_and_nesting()
    {
        var root = KeyValues.Parse("// header\n\"libraryfolders\"\n{\n  \"0\"\n  {\n    \"path\"  \"C:\\\\Program Files (x86)\\\\Steam\"\n    \"apps\" { \"620\" \"123\" }\n  }\n}");
        var library = root.Block("libraryfolders")!.Block("0")!;
        Assert.Equal(@"C:\Program Files (x86)\Steam", library.Text("path"));
        Assert.Equal("123", library.Block("apps")!.Text("620"));
    }

    [Fact]
    public void Rejects_an_unclosed_keyvalues_block()
    {
        Assert.Throws<FormatException>(() => KeyValues.Parse("\"AppState\" { \"appid\" \"1\""));
    }

    [Fact]
    public void Lists_installed_steam_games_from_every_library_and_skips_tools()
    {
        var steam = Path.Combine(_dir, "Steam");
        var second = Path.Combine(_dir, "SteamLibrary");
        Directory.CreateDirectory(Path.Combine(steam, "steamapps"));
        Directory.CreateDirectory(Path.Combine(second, "steamapps"));
        File.WriteAllText(Path.Combine(steam, "steamapps", "libraryfolders.vdf"),
            $"\"libraryfolders\" {{ \"0\" {{ \"path\" \"{Escape(steam)}\" }} \"1\" {{ \"path\" \"{Escape(second)}\" }} }}");
        Manifest(steam, 620, "Portal 2", 4);
        Manifest(steam, 228980, "Steamworks Common Redistributables", 4);
        Manifest(second, 1145360, "Hades", 4);
        Manifest(second, 570, "Dota 2", 1026); // update queued, files still there? flag 4 missing: not installed
        File.WriteAllText(Path.Combine(second, "steamapps", "appmanifest_9.acf"), "\"AppState\" { broken");

        var games = new SteamSource([steam], id => $"steam://rungameid/{id}").Scan().OrderBy(g => g.Title).ToList();

        Assert.Equal(["Hades", "Portal 2"], games.Select(g => g.Title));
        Assert.Equal("steam:620", games[1].Id);
        Assert.Equal(620, games[1].SteamAppId);
        Assert.Equal("steam://rungameid/620", games[1].Detached);
    }

    [Fact]
    public void Lists_complete_epic_games_only()
    {
        Directory.CreateDirectory(_dir);
        Item("a", """{"DisplayName":"Alan Wake 2","AppName":"Dodo","CatalogNamespace":"ns","CatalogItemId":"item","AppCategories":["public","games"]}""");
        Item("b", """{"DisplayName":"Half done","AppName":"Half","CatalogNamespace":"ns","CatalogItemId":"i","bIsIncompleteInstall":true}""");
        Item("c", """{"DisplayName":"Unreal Engine","AppName":"UE_5","CatalogNamespace":"ue","CatalogItemId":"i","AppCategories":["engines"]}""");
        Item("d", "not json");

        var game = Assert.Single(new EpicSource(_dir, url => url).Scan());

        Assert.Equal("epic:Dodo", game.Id);
        Assert.Equal("Alan Wake 2", game.Title);
        Assert.Equal("com.epicgames.launcher://apps/ns%3Aitem%3ADodo?action=launch&silent=true", game.Detached);
    }

    [Fact]
    public async Task Finds_art_for_a_game_that_is_not_on_steam_by_its_title()
    {
        var server = new FakeArtServer();
        server.Json("search/autocomplete/Hytale", """{"success":true,"data":[{"id":5,"name":"Hytale Legacy"},{"id":42,"name":"Hytale"}]}""");
        server.Json("grids/game/42", """{"success":true,"data":[{"url":"https://cdn2.steamgriddb.com/grid/cover.png"}]}""");
        server.Json("logos/game/42", """{"success":true,"data":[{"url":"https://cdn2.steamgriddb.com/logo/logo.png"}]}""");
        server.Image("https://cdn2.steamgriddb.com/grid/cover.png", "image/png");
        server.Image("https://cdn2.steamgriddb.com/logo/logo.png", "image/png");
        var artwork = Artwork(server, key: "test-key");
        var hytale = new GameEntry("mac:com.hypixel.hytale.client", "Hytale", "Mac", null, "open -a Hytale");

        var cover = await artwork.GetAsync(hytale, ArtworkKind.Cover, CancellationToken.None);
        var logo = await artwork.GetAsync(hytale, ArtworkKind.Logo, CancellationToken.None);
        var again = await artwork.GetAsync(hytale, ArtworkKind.Cover, CancellationToken.None);

        Assert.EndsWith("cover.png", cover);
        Assert.EndsWith("logo.png", logo);
        Assert.Equal(cover, again);
        Assert.Equal(1, server.Calls("search/autocomplete/Hytale")); // second cover request comes from disk
        Assert.All(server.ApiRequests, r => Assert.Equal("Bearer test-key", r.Headers.Authorization?.ToString()));
        Assert.Contains(server.ApiRequests, r => r.RequestUri!.Query.Contains("dimensions=600x900"));
    }

    [Fact]
    public async Task Serves_the_light_thumbnail_to_phones_and_the_full_picture_otherwise()
    {
        var server = new FakeArtServer();
        server.Json("heroes/steam/620", """{"data":[{"url":"https://cdn2.steamgriddb.com/hero/big.png","thumb":"https://cdn2.steamgriddb.com/hero_thumb/big.jpg"}]}""");
        server.Image("https://cdn2.steamgriddb.com/hero/big.png", "image/png");
        server.Image("https://cdn2.steamgriddb.com/hero_thumb/big.jpg", "image/jpeg");
        var artwork = Artwork(server, key: "test-key");
        var portal = new GameEntry("steam:620", "Portal 2", "Steam", 620, "");

        var small = await artwork.GetAsync(portal, ArtworkKind.Hero, CancellationToken.None, small: true);
        var full = await artwork.GetAsync(portal, ArtworkKind.Hero, CancellationToken.None);

        Assert.EndsWith("hero-small.jpg", small);
        Assert.EndsWith("hero.png", full);
    }

    [Fact]
    public async Task Uses_the_steam_id_on_steamgriddb_then_falls_back_to_steam_art()
    {
        var server = new FakeArtServer();
        server.Json("heroes/steam/620", """{"success":true,"data":[]}""");
        server.Image("https://shared.steamstatic.com/store_item_assets/steam/apps/620/library_hero.jpg", "image/jpeg");
        var artwork = Artwork(server, key: "test-key");

        var hero = await artwork.GetAsync(new GameEntry("steam:620", "Portal 2", "Steam", 620, ""), ArtworkKind.Hero, CancellationToken.None);

        Assert.EndsWith("hero.jpg", hero);
        Assert.Equal(0, server.Calls("search/autocomplete/Portal%202"));
    }

    [Fact]
    public async Task Works_without_a_key_for_steam_games()
    {
        var server = new FakeArtServer();
        server.Image("https://shared.steamstatic.com/store_item_assets/steam/apps/620/library_600x900_2x.jpg", "image/jpeg");
        var artwork = Artwork(server, key: "");

        var cover = await artwork.GetAsync(new GameEntry("steam:620", "Portal 2", "Steam", 620, ""), ArtworkKind.Cover, CancellationToken.None);

        Assert.NotNull(cover);
        Assert.Empty(server.ApiRequests);
    }

    [Fact]
    public async Task Never_downloads_from_a_host_outside_the_allowlist()
    {
        var server = new FakeArtServer();
        server.Json("search/autocomplete/Evil", """{"data":[{"id":1,"name":"Evil"}]}""");
        server.Json("grids/game/1", """{"data":[{"url":"https://attacker.example/x.png"},{"url":"http://cdn2.steamgriddb.com/plain.png"}]}""");
        server.Image("https://attacker.example/x.png", "image/png");
        var artwork = Artwork(server, key: "test-key");

        var cover = await artwork.GetAsync(new GameEntry("epic:Evil", "Evil", "Epic", null, ""), ArtworkKind.Cover, CancellationToken.None);

        Assert.Null(cover);
        Assert.DoesNotContain(server.Requests, r => r.RequestUri!.Host == "attacker.example");
    }

    [Fact]
    public async Task Remembers_a_miss_and_falls_back_to_the_app_icon()
    {
        var server = new FakeArtServer();
        server.Json("search/autocomplete/Indie", """{"data":[]}""");
        var icns = Path.Combine(_dir, "AppIcon.icns");
        File.WriteAllText(icns, "icns");
        var converted = 0;
        var artwork = new ArtworkService(new HttpClient(server), Path.Combine(_dir, "cache"), "test-key", (from, to) =>
        {
            converted++;
            File.WriteAllText(to, "png");
            return true;
        });
        var game = new GameEntry("mac:indie", "Indie", "Mac", null, "", icns);

        Assert.EndsWith("app-icon.png", await artwork.GetAsync(game, ArtworkKind.Icon, CancellationToken.None));
        Assert.EndsWith("app-icon.png", await artwork.GetAsync(game, ArtworkKind.Cover, CancellationToken.None));
        Assert.Null(await artwork.GetAsync(game, ArtworkKind.Hero, CancellationToken.None));
        Assert.Null(await artwork.GetAsync(game, ArtworkKind.Hero, CancellationToken.None));

        Assert.Equal(1, converted);
        Assert.Equal(1, server.Calls("search/autocomplete/Indie")); // one search per game, then the saved miss
    }

    [Fact]
    public async Task Finds_the_art_once_a_key_is_added()
    {
        var server = new FakeArtServer();
        server.Json("search/autocomplete/Hytale", """{"data":[{"id":42,"name":"Hytale"}]}""");
        server.Json("grids/game/42", """{"data":[{"url":"https://cdn2.steamgriddb.com/grid/cover.png"}]}""");
        server.Image("https://cdn2.steamgriddb.com/grid/cover.png", "image/png");
        var icns = Path.Combine(_dir, "AppIcon.icns");
        File.WriteAllText(icns, "icns");
        var game = new GameEntry("mac:hytale", "Hytale", "Mac", null, "", icns);
        bool Convert(string from, string to) { File.WriteAllText(to, "png"); return true; }

        var withoutKey = await new ArtworkService(new HttpClient(server), Path.Combine(_dir, "cache"), "", Convert).GetAsync(game, ArtworkKind.Cover, CancellationToken.None);
        var withKey = await new ArtworkService(new HttpClient(server), Path.Combine(_dir, "cache"), "test-key", Convert).GetAsync(game, ArtworkKind.Cover, CancellationToken.None);

        Assert.EndsWith("app-icon.png", withoutKey);
        Assert.EndsWith("cover.png", withKey);
    }

    [Fact]
    public void Game_ids_become_safe_folder_names()
    {
        Assert.Equal("mac_com.hypixel.hytale.client", ArtworkService.SafeName("mac:com.hypixel.hytale.client"));
        Assert.Equal("epic_.._.._etc", ArtworkService.SafeName("epic:../../etc"));
    }

    private ArtworkService Artwork(FakeArtServer server, string key) =>
        new(new HttpClient(server), Path.Combine(_dir, "cache"), key, (_, _) => false);

    private static string Escape(string path) => path.Replace("\\", "\\\\");

    private static void Manifest(string library, int appId, string name, int flags) =>
        File.WriteAllText(Path.Combine(library, "steamapps", $"appmanifest_{appId}.acf"),
            $"\"AppState\"\n{{\n\t\"appid\"\t\t\"{appId}\"\n\t\"name\"\t\t\"{name}\"\n\t\"StateFlags\"\t\t\"{flags}\"\n}}");

    private void Item(string name, string json) => File.WriteAllText(Path.Combine(_dir, name + ".item"), json);

    /// <summary>SteamGridDB API and image CDNs, answered from memory.</summary>
    private sealed class FakeArtServer : HttpMessageHandler
    {
        private const string Api = "https://www.steamgriddb.com/api/v2/";
        private readonly Dictionary<string, string> _json = new();
        private readonly Dictionary<string, string> _images = new();
        public List<HttpRequestMessage> Requests { get; } = [];
        public IEnumerable<HttpRequestMessage> ApiRequests => Requests.Where(r => r.RequestUri!.ToString().StartsWith(Api, StringComparison.Ordinal));

        public void Json(string path, string body) => _json[path] = body;
        public void Image(string url, string type) => _images[url] = type;
        public int Calls(string path) => ApiRequests.Count(r => r.RequestUri!.AbsolutePath.EndsWith("/" + path, StringComparison.Ordinal));

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request);
            var url = request.RequestUri!.ToString();
            if (url.StartsWith(Api, StringComparison.Ordinal))
            {
                var path = request.RequestUri.AbsolutePath["/api/v2/".Length..];
                return Task.FromResult(_json.TryGetValue(path, out var body)
                    ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json"), RequestMessage = request }
                    : new HttpResponseMessage(HttpStatusCode.NotFound) { RequestMessage = request });
            }
            if (_images.TryGetValue(url, out var type))
            {
                var content = new ByteArrayContent([1, 2, 3]);
                content.Headers.ContentType = new(type);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content, RequestMessage = request });
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound) { RequestMessage = request });
        }
    }
}
