using Waken.Agent.Games;

namespace Waken.Agent.Tests;

public sealed class StoreSourcesTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("waken-stores-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private sealed class FakePrograms(List<InstalledProgram> programs, List<(string, string)>? values = null) : IInstalledPrograms
    {
        public IReadOnlyList<InstalledProgram> List() => programs;
        public IReadOnlyList<(string SubKey, string Value)> Values(string keyPath, string valueName) => values ?? [];
    }

    private static InstalledProgram Program(string key, string name, string publisher, string? icon = null) => new(key, name, publisher, null, icon, null);

    [Fact]
    public void Reads_the_executable_of_a_display_icon()
    {
        Assert.Equal(@"C:\Games\Apex\r5apex.exe", Program("k", "Apex", "EA", "\"C:\\Games\\Apex\\r5apex.exe\",0").IconExecutable());
        Assert.Equal(@"C:\Games\x.exe", Program("k", "X", "EA", @"C:\Games\x.exe").IconExecutable());
        Assert.Null(Program("k", "X", "EA", @"C:\Games\x.ico").IconExecutable());
    }

    [Fact]
    public void Lists_ea_games_and_skips_its_tools()
    {
        var programs = new FakePrograms([
            Program("{EA-1}", "Apex Legends", "Electronic Arts", @"C:\Games\Apex\r5apex.exe,0"),
            Program("{EA-2}", "EA app", "Electronic Arts", @"C:\EA\EADesktop.exe"),
            Program("{EA-3}", "The Sims 4", "Electronic Arts", @"C:\Gone\TS4.exe"),
            Program("{X}", "Notepad++", "Notepad++ Team", @"C:\npp.exe"),
        ]);

        var game = Assert.Single(new EaSource(programs, path => !path.Contains("Gone")).Scan());

        Assert.Equal("Apex Legends", game.Title);
        Assert.Equal("\"C:\\Games\\Apex\\r5apex.exe\"", game.Detached);
    }

    [Fact]
    public void Lists_ubisoft_installs_with_their_real_title()
    {
        var programs = new FakePrograms(
            [Program("Uplay Install 635", "Assassin's Creed Origins", "Ubisoft")],
            [("635", @"C:\Ubisoft\ACO"), ("720", @"C:\Ubisoft\Far Cry 6"), ("999", @"C:\Removed")]);

        var games = new UbisoftSource(programs, dir => !dir.Contains("Removed")).Scan().OrderBy(g => g.Title).ToList();

        Assert.Equal(["Assassin's Creed Origins", "Far Cry 6"], games.Select(g => g.Title));
        Assert.Equal("uplay://launch/635/0", games[0].Detached);
    }

    [Fact]
    public void Starts_battle_net_games_by_product_code()
    {
        var programs = new FakePrograms([
            Program("Overwatch", "Overwatch", "Blizzard Entertainment"),
            Program("Diablo III", "Diablo III", "Blizzard Entertainment"),
            Program("Battle.net", "Battle.net", "Blizzard Entertainment"),
            Program("New", "Some New Game", "Blizzard Entertainment", @"C:\Games\New\new.exe"),
        ]);
        const string bnet = @"C:\Program Files (x86)\Battle.net\Battle.net.exe";

        var games = new BattleNetSource(programs, bnet, _ => true).Scan().ToDictionary(g => g.Title);

        Assert.Equal(3, games.Count);
        Assert.Equal($"\"{bnet}\" --exec=\"launch Pro\"", games["Overwatch"].Detached);
        Assert.Equal($"\"{bnet}\" --exec=\"launch D3\"", games["Diablo III"].Detached);
        Assert.Equal("\"C:\\Games\\New\\new.exe\"", games["Some New Game"].Detached);
    }

    [Fact]
    public void Computes_windows_publisher_ids()
    {
        Assert.Equal("8wekyb3d8bbwe", XboxSource.PublisherId("CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"));
    }

    [Fact]
    public void Lists_xbox_games_from_their_manifest()
    {
        var root = Path.Combine(_dir, "XboxGames");
        Directory.CreateDirectory(Path.Combine(root, "Forza Horizon 5", "Content"));
        File.WriteAllText(Path.Combine(root, "Forza Horizon 5", "Content", "appxmanifest.xml"), """
            <Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
              <Identity Name="Microsoft.624F8B84B80" Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" Version="1.0.0.0" />
              <Properties><DisplayName>ms-resource:AppName</DisplayName></Properties>
              <Applications><Application Id="Game" Executable="ForzaHorizon5.exe" /></Applications>
            </Package>
            """);
        Directory.CreateDirectory(Path.Combine(root, "Broken", "Content"));
        File.WriteAllText(Path.Combine(root, "Broken", "Content", "appxmanifest.xml"), "<Package");

        var game = Assert.Single(new XboxSource([root, Path.Combine(_dir, "Missing")]).Scan());

        Assert.Equal("Forza Horizon 5", game.Title);
        Assert.Equal(@"shell:AppsFolder\Microsoft.624F8B84B80_8wekyb3d8bbwe!Game", game.Detached);
    }

    [Fact]
    public void Finds_steam_games_inside_crossover_bottles()
    {
        var bottle = Path.Combine(_dir, "Bottles", "Jeux Windows");
        var steamapps = Path.Combine(bottle, "drive_c", "Program Files (x86)", "Steam", "steamapps");
        Directory.CreateDirectory(steamapps);
        File.WriteAllText(Path.Combine(steamapps, "appmanifest_1091500.acf"), "\"AppState\" { \"appid\" \"1091500\" \"name\" \"Cyberpunk 2077\" \"StateFlags\" \"4\" }");
        File.WriteAllText(Path.Combine(bottle, "drive_c", "Program Files (x86)", "Steam", "steam.exe"), "");

        var games = new CrossOverSource(Path.Combine(_dir, "Bottles"), "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine").Scan().ToDictionary(g => g.Title);

        var cyberpunk = games["Cyberpunk 2077"];
        Assert.Equal("crossover:Jeux Windows:steam:1091500", cyberpunk.Id);
        Assert.Equal(1091500, cyberpunk.SteamAppId);
        Assert.Equal("\"/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine\" --bottle \"Jeux Windows\" \"C:\\\\Program Files (x86)\\\\Steam\\\\steam.exe\" -applaunch 1091500", cyberpunk.Detached);
        Assert.Equal("Launcher", games["Steam (Jeux Windows)"].Store);
    }

    [Fact]
    public void Quotes_shell_arguments_safely()
    {
        Assert.Equal("\"a \\\"b\\\" \\$HOME \\`x\\`\"", CrossOverSource.Quote("a \"b\" $HOME `x`"));
    }

    [Fact]
    public void Lists_only_the_installed_launchers()
    {
        var candidates = LauncherSource.Windows(@"C:\Program Files", @"C:\Program Files (x86)").ToList();
        var installed = new HashSet<string> { Path.Combine(@"C:\Program Files (x86)", "Steam", "steam.exe"), Path.Combine(@"C:\Program Files (x86)", "Battle.net", "Battle.net.exe") };

        var launchers = new LauncherSource(candidates, installed.Contains).Scan().ToDictionary(l => l.Title);

        Assert.Equal(["Battle.net", "Steam Big Picture"], launchers.Keys.Order());
        Assert.Equal("steam://open/bigpicture", launchers["Steam Big Picture"].Detached);
        Assert.All(launchers.Values, l => Assert.Equal("Launcher", l.Store));
    }
}
