using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

namespace Waken.Agent;

/// <summary>
/// Sunshine's admin API, used to approve the agent's own pairing request.
/// v2026.906+ lists requests on GET /api/pin and needs their id to approve one. Older versions only have the POST.
/// </summary>
internal sealed class SunshineAdminClient : IDisposable
{
    private const string PinPath = "/api/pin";
    private const string ClientName = "Waken";
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(250);

    private readonly HttpClient _http;

    /// <param name="certificate">The only certificate accepted: this connection carries Sunshine's admin password.</param>
    public SunshineAdminClient(Uri baseAddress, string user, string password, X509Certificate2 certificate)
    {
        var expected = certificate.RawData;
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, presented, _, _) => presented?.RawData.AsSpan().SequenceEqual(expected) == true,
            AllowAutoRedirect = false,
        };
        _http = new HttpClient(handler) { BaseAddress = baseAddress };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{password}")));
    }

    public async Task<bool> UsesPairingIdsAsync(CancellationToken ct)
    {
        using var response = await _http.GetAsync(PinPath, ct);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed) return false;

        EnsureAccepted(response, "GET");
        return true;
    }

    /// <summary>Waits for the request made under <paramref name="deviceName"/>, a name only this attempt knows.</summary>
    public async Task<string> WaitForPairingIdAsync(string deviceName, Task pairingRequest, CancellationToken ct)
    {
        while (true)
        {
            // It only ends this early when Sunshine refused it: surface that error instead of polling.
            if (pairingRequest.IsCompleted)
            {
                await pairingRequest;
                throw new InvalidOperationException("Sunshine a clos la demande d'appairage avant le PIN.");
            }

            using var response = await _http.GetAsync(PinPath, ct);
            EnsureAccepted(response, "GET");
            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            foreach (var pairing in json.RootElement.GetProperty("pairings").EnumerateArray())
            {
                if (pairing.GetProperty("name").GetString() == deviceName && pairing.GetProperty("id").GetString() is { } id) return id;
            }

            await Task.Delay(PollInterval, ct);
        }
    }

    /// <summary>
    /// With a pairing id, the response only arrives once the client has completed every pairing phase:
    /// do not await this before running them.
    /// </summary>
    public async Task SubmitPinAsync(string pin, string? pairingId, CancellationToken ct)
    {
        object body = pairingId is null ? new { pin, name = ClientName } : new { pairing_id = pairingId, pin, name = ClientName };
        using var content = JsonContent.Create(body);
        // Sunshine reads the body by Content-Length, so it must not be chunked.
        await content.LoadIntoBufferAsync(ct);
        using var response = await _http.PostAsync(PinPath, content, ct);
        EnsureAccepted(response, "POST");

        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        if (json.RootElement.TryGetProperty("status", out var status) && status.ToString().ToLowerInvariant() == "false")
        {
            throw new InvalidOperationException("Sunshine a refusé le PIN d'appairage.");
        }
    }

    // ---------- Applications (apps.json) ----------

    private const string AppsPath = "/api/apps";

    /// <summary>Every application entry as Sunshine stores it, with its current index. Unknown fields are kept by Sunshine.</summary>
    public async Task<List<JsonElement>> GetAppsAsync(CancellationToken ct)
    {
        using var response = await _http.GetAsync(AppsPath, ct);
        EnsureAccepted(response, "GET", AppsPath);
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return json.RootElement.TryGetProperty("apps", out var apps) && apps.ValueKind == JsonValueKind.Array
            ? apps.EnumerateArray().Select(a => a.Clone()).ToList()
            : [];
    }

    /// <summary>Adds an entry. Sunshine then sorts the list by name: indexes read before are stale.</summary>
    public async Task AddAppAsync(IDictionary<string, object?> app, CancellationToken ct)
    {
        var body = new Dictionary<string, object?>(app) { ["index"] = -1 };
        using var content = JsonContent.Create(body);
        await content.LoadIntoBufferAsync(ct);
        using var response = await _http.PostAsync(AppsPath, content, ct);
        EnsureAccepted(response, "POST", AppsPath);
    }

    public async Task DeleteAppAsync(int index, CancellationToken ct)
    {
        using var response = await _http.DeleteAsync($"{AppsPath}/{index}", ct);
        EnsureAccepted(response, "DELETE", AppsPath);
    }

    private static void EnsureAccepted(HttpResponseMessage response, string method, string path = PinPath)
    {
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            throw new InvalidOperationException("Sunshine refuse l'accès à son API d'administration. Vérifie SunshineUser et SunshinePassword.");
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Sunshine {method} {path} a répondu {(int)response.StatusCode} : version de Sunshine non prise en charge ?");
        }
    }

    public void Dispose() => _http.Dispose();
}
