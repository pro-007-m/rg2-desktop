using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RG2.Desktop;

internal readonly record struct ReleaseVersion(int Major, int Minor, int Patch) : IComparable<ReleaseVersion>
{
    internal static bool TryParse(string? value, out ReleaseVersion version, bool allowTagPrefix = true)
    {
        version = default;
        if (value is null || value.Length > 40) return false;
        string pattern = allowTagPrefix ? @"\Av?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z" : @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z";
        Match match = Regex.Match(value, pattern, RegexOptions.CultureInvariant);
        if (!match.Success || !int.TryParse(match.Groups[1].Value, out int major) || !int.TryParse(match.Groups[2].Value, out int minor) || !int.TryParse(match.Groups[3].Value, out int patch)) return false;
        version = new(major, minor, patch);
        return true;
    }
    public int CompareTo(ReleaseVersion other)
    {
        int result = Major.CompareTo(other.Major);
        if (result == 0) result = Minor.CompareTo(other.Minor);
        return result == 0 ? Patch.CompareTo(other.Patch) : result;
    }
    public override string ToString() => $"{Major}.{Minor}.{Patch}";
}

internal sealed record ReleaseAsset(string Name, Uri DownloadUri, long Bytes, string? ApiSha256);
internal sealed record ReleaseCandidate(ReleaseVersion Version, string Tag, ReleaseAsset Installer, ReleaseAsset Checksums);
internal sealed record ReleasePlan(ReleaseCandidate Release, string Commit, string Sha256);
internal sealed record UpdateStatus(string Status, string CurrentVersion, string Message, string? Version = null, int? Progress = null)
{
    public string Type => "update-status";
}

internal static class ReleaseProtocol
{
    internal const string RepositoryUrl = "https://github.com/pro-007-m/rg2-desktop";
    internal static readonly Uri LatestApi = new("https://api.github.com/repos/pro-007-m/rg2-desktop/releases/latest");
    internal const long MaxInstallerBytes = 2L * 1024 * 1024 * 1024;
    internal const int MaxManifestBytes = 1024 * 1024;
    private static readonly HashSet<string> DownloadHosts = new(StringComparer.OrdinalIgnoreCase)
        { "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com" };

    internal static bool AllowedUri(Uri uri, bool metadata)
    {
        if (!uri.IsAbsoluteUri || uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0) return false;
        return metadata ? uri.AbsoluteUri == LatestApi.AbsoluteUri : DownloadHosts.Contains(uri.IdnHost);
    }

    internal static ReleaseCandidate? ParseLatest(byte[] json, ReleaseVersion current)
    {
        using JsonDocument document = ParseDocument(json);
        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || RequiredBoolean(root, "draft") || RequiredBoolean(root, "prerelease")) throw new InvalidDataException("Only published stable releases are accepted.");
        string tag = RequiredString(root, "tag_name");
        if (!ReleaseVersion.TryParse(tag, out ReleaseVersion version)) throw new InvalidDataException("Invalid release version.");
        if (version.CompareTo(current) <= 0) return null;
        string installerName = $"RG2-Desktop-{version}-Setup-x64.exe", checksumName = $"RG2-Desktop-{version}-checksums.json";
        if (!root.TryGetProperty("assets", out JsonElement assets) || assets.ValueKind != JsonValueKind.Array) throw new InvalidDataException("Missing release assets.");
        ReleaseAsset? installer = null, checksums = null;
        foreach (JsonElement asset in assets.EnumerateArray())
        {
            if (asset.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Invalid asset record.");
            string name = RequiredString(asset, "name");
            if (name != installerName && name != checksumName) continue;
            if (asset.TryGetProperty("state", out JsonElement uploaded) && (uploaded.ValueKind != JsonValueKind.String || uploaded.GetString() != "uploaded")) throw new InvalidDataException("Asset upload is incomplete.");
            long bytes = RequiredBytes(asset, "size", name == checksumName ? MaxManifestBytes : MaxInstallerBytes);
            string download = RequiredString(asset, "browser_download_url");
            if (!Uri.TryCreate(download, UriKind.Absolute, out Uri? uri) || !AllowedUri(uri, false) || uri.IdnHost != "github.com" || uri.Query.Length != 0 || uri.AbsolutePath != $"/pro-007-m/rg2-desktop/releases/download/{tag}/{name}") throw new InvalidDataException("Unexpected asset origin or path.");
            string? digest = null;
            if (asset.TryGetProperty("digest", out JsonElement apiDigest) && apiDigest.ValueKind != JsonValueKind.Null)
            {
                if (apiDigest.ValueKind != JsonValueKind.String || !Regex.IsMatch(apiDigest.GetString()!, @"\Asha256:[0-9a-fA-F]{64}\z", RegexOptions.CultureInvariant)) throw new InvalidDataException("Invalid API asset digest.");
                digest = apiDigest.GetString()![7..].ToLowerInvariant();
            }
            var parsed = new ReleaseAsset(name, uri, bytes, digest);
            if (name == installerName) { if (installer is not null) throw new InvalidDataException("Duplicate installer asset."); installer = parsed; }
            else { if (checksums is not null) throw new InvalidDataException("Duplicate checksum asset."); checksums = parsed; }
        }
        return new(version, tag, installer ?? throw new InvalidDataException("Installer asset is missing."), checksums ?? throw new InvalidDataException("Checksum asset is missing."));
    }

    internal static ReleasePlan ParseChecksums(byte[] json, ReleaseCandidate release)
    {
        using JsonDocument document = ParseDocument(json);
        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !ReleaseVersion.TryParse(RequiredString(root, "version"), out ReleaseVersion version, false) || version != release.Version) throw new InvalidDataException("Manifest version mismatch.");
        string commit = RequiredString(root, "commit");
        if (!Regex.IsMatch(commit, @"\A[0-9a-fA-F]{40}\z", RegexOptions.CultureInvariant)) throw new InvalidDataException("Invalid source commit.");
        if (!root.TryGetProperty("files", out JsonElement files) || files.ValueKind != JsonValueKind.Array) throw new InvalidDataException("Missing checksums.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string? hash = null;
        foreach (JsonElement file in files.EnumerateArray())
        {
            string name = RequiredString(file, "name");
            if (!Regex.IsMatch(name, @"\A[A-Za-z0-9][A-Za-z0-9._-]{0,180}\z", RegexOptions.CultureInvariant) || name is "." or ".." || !names.Add(name)) throw new InvalidDataException("Invalid or duplicate checksum filename.");
            long bytes = RequiredBytes(file, "bytes", MaxInstallerBytes);
            string digest = RequiredString(file, "sha256");
            if (!Regex.IsMatch(digest, @"\A[0-9a-fA-F]{64}\z", RegexOptions.CultureInvariant)) throw new InvalidDataException("Invalid SHA256 checksum.");
            if (name == release.Installer.Name)
            {
                if (bytes != release.Installer.Bytes || (release.Installer.ApiSha256 is not null && !digest.Equals(release.Installer.ApiSha256, StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException("Installer metadata mismatch.");
                hash = digest.ToLowerInvariant();
            }
        }
        return new(release, commit.ToLowerInvariant(), hash ?? throw new InvalidDataException("Installer checksum is missing."));
    }

    internal static ProcessStartInfo InstallerStartInfo(string dataDirectory, string installerPath, ReleasePlan plan)
    {
        string expected = Path.GetFullPath(Path.Combine(dataDirectory, "Updates", plan.Release.Version.ToString(), plan.Release.Installer.Name));
        if (!Path.GetFullPath(installerPath).Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Installer must stay inside the update staging directory.");
        return new ProcessStartInfo(expected) { Arguments = "/UPDATE /NORESTART", UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(expected)! };
    }

    internal static bool HashMatches(ReadOnlySpan<byte> actual, string expected)
    {
        byte[] wanted = Convert.FromHexString(expected);
        return actual.Length == wanted.Length && CryptographicOperations.FixedTimeEquals(actual, wanted);
    }

    private static JsonDocument ParseDocument(byte[] json)
    {
        var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 32 });
        try { RejectDuplicateProperties(document.RootElement); return document; }
        catch { document.Dispose(); throw; }
    }
    private static void RejectDuplicateProperties(JsonElement node)
    {
        if (node.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonProperty property in node.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new InvalidDataException("Duplicate JSON property.");
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (node.ValueKind == JsonValueKind.Array) foreach (JsonElement child in node.EnumerateArray()) RejectDuplicateProperties(child);
    }
    private static string RequiredString(JsonElement root, string key) => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(key, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : throw new InvalidDataException("Missing string field.");
    private static bool RequiredBoolean(JsonElement root, string key) => root.TryGetProperty(key, out JsonElement value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : throw new InvalidDataException("Missing boolean field.");
    private static long RequiredBytes(JsonElement root, string key, long max) => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(key, out JsonElement value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out long bytes) && bytes > 0 && bytes <= max ? bytes : throw new InvalidDataException("Invalid asset length.");
}

internal sealed class ReleaseUpdater : IDisposable
{
    private readonly string dataDirectory;
    private readonly ReleaseVersion current;
    private readonly HttpClient client;
    private readonly bool ownsClient;
    private readonly Action<ProcessStartInfo> launchInstaller;
    private readonly TimeSpan checkTimeout, downloadTimeout;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly object sync = new();
    private CancellationTokenSource? active;
    private ReleasePlan? available;
    private bool disposed, userCancelled;
    internal event Action<UpdateStatus>? StatusChanged;
    internal UpdateStatus CurrentStatus { get; private set; }

    internal ReleaseUpdater(string dataDirectory, string currentVersion, HttpClient? client = null, Action<ProcessStartInfo>? launchInstaller = null, TimeSpan? checkTimeout = null, TimeSpan? downloadTimeout = null)
    {
        if (!ReleaseVersion.TryParse(currentVersion, out current, false)) throw new ArgumentException("A three-part app version is required.", nameof(currentVersion));
        this.dataDirectory = Path.GetFullPath(dataDirectory);
        ownsClient = client is null;
        this.client = client ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
        this.launchInstaller = launchInstaller ?? (start => { if (Process.Start(start) is null) throw new IOException("Installer could not start."); });
        this.checkTimeout = checkTimeout ?? TimeSpan.FromSeconds(45);
        this.downloadTimeout = downloadTimeout ?? TimeSpan.FromMinutes(20);
        CurrentStatus = new("idle", current.ToString(), "Нажмите «Проверить обновления».");
    }

    internal async Task CheckAsync(CancellationToken cancellationToken = default)
    {
        if (!gate.Wait(0)) return;
        CancellationTokenSource? operation = null;
        try
        {
            operation = BeginJob(checkTimeout, cancellationToken);
            if (operation is null) return;
            available = null;
            Publish("checking", "Проверяю новый выпуск…");
            byte[] metadata = await ReadBytesAsync(ReleaseProtocol.LatestApi, true, 2 * 1024 * 1024, null, operation.Token).ConfigureAwait(false);
            ReleaseCandidate? release = ReleaseProtocol.ParseLatest(metadata, current);
            if (release is null) { Publish("up-to-date", "Обновление не требуется."); return; }
            byte[] manifest = await ReadBytesAsync(release.Checksums.DownloadUri, false, ReleaseProtocol.MaxManifestBytes, release.Checksums.Bytes, operation.Token).ConfigureAwait(false);
            if (release.Checksums.ApiSha256 is not null && !ReleaseProtocol.HashMatches(SHA256.HashData(manifest), release.Checksums.ApiSha256)) throw new InvalidDataException("Checksum manifest digest mismatch.");
            available = ReleaseProtocol.ParseChecksums(manifest, release);
            Publish("available", $"Доступна версия {release.Version}. Установить её можно отдельной кнопкой.", release.Version.ToString());
        }
        catch (OperationCanceledException) { CancelledOrTimeout(cancellationToken); }
        catch (Exception exception) when (Recoverable(exception)) { Publish("error", SafeError(exception, false)); }
        finally { EndJob(operation); gate.Release(); }
    }

    internal async Task<bool> InstallAsync(CancellationToken cancellationToken = default)
    {
        if (!gate.Wait(0)) return false;
        CancellationTokenSource? operation = null;
        string? partialPath = null;
        try
        {
            operation = BeginJob(downloadTimeout, cancellationToken);
            if (operation is null) return false;
            ReleasePlan plan = available ?? throw new InvalidDataException("Check for updates first.");
            if (plan.Release.Version.CompareTo(current) <= 0) throw new InvalidDataException("Downgrade is not permitted.");
            string updates = Path.Combine(dataDirectory, "Updates"), directory = Path.Combine(updates, plan.Release.Version.ToString());
            EnsureDirectory(updates); EnsureDirectory(directory);
            string finalPath = Path.Combine(directory, plan.Release.Installer.Name);
            partialPath = finalPath + "." + Guid.NewGuid().ToString("N") + ".part";
            Publish("downloading", "Загружаю установщик…", plan.Release.Version.ToString(), 0);
            using (HttpResponseMessage response = await GetResponseAsync(plan.Release.Installer.DownloadUri, false, operation.Token).ConfigureAwait(false))
            {
                if (response.Content.Headers.ContentLength is long length && length != plan.Release.Installer.Bytes) throw new InvalidDataException("Installer HTTP length mismatch.");
                await using Stream input = await response.Content.ReadAsStreamAsync(operation.Token).ConfigureAwait(false);
                await using var file = new FileStream(partialPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
                using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                byte[] buffer = new byte[65536]; long received = 0; int lastProgress = -1;
                while (true)
                {
                    int count = await input.ReadAsync(buffer, operation.Token).ConfigureAwait(false);
                    if (count == 0) break;
                    received += count;
                    if (received > plan.Release.Installer.Bytes) throw new InvalidDataException("Installer is larger than its verified metadata.");
                    digest.AppendData(buffer, 0, count);
                    await file.WriteAsync(buffer.AsMemory(0, count), operation.Token).ConfigureAwait(false);
                    int progress = (int)(received * 100 / plan.Release.Installer.Bytes);
                    if (progress != lastProgress) { lastProgress = progress; Publish("downloading", "Загружаю установщик…", plan.Release.Version.ToString(), progress); }
                }
                if (received != plan.Release.Installer.Bytes || !ReleaseProtocol.HashMatches(digest.GetHashAndReset(), plan.Sha256)) throw new InvalidDataException("Installer size or SHA256 mismatch.");
            }
            Publish("verifying", "Проверяю целостность установщика…", plan.Release.Version.ToString(), 100);
            operation.Token.ThrowIfCancellationRequested();
            File.Move(partialPath, finalPath, true); partialPath = null;
            await VerifyFileAsync(finalPath, plan, operation.Token).ConfigureAwait(false);
            operation.Token.ThrowIfCancellationRequested();
            ProcessStartInfo start = ReleaseProtocol.InstallerStartInfo(dataDirectory, finalPath, plan);
            launchInstaller(start);
            Publish("installing", "Открываю установщик. Приложение закроется для обновления.", plan.Release.Version.ToString());
            return true;
        }
        catch (OperationCanceledException) { CancelledOrTimeout(cancellationToken); return false; }
        catch (Exception exception) when (Recoverable(exception)) { Publish("error", SafeError(exception, true)); return false; }
        finally
        {
            if (partialPath is not null) try { File.Delete(partialPath); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            EndJob(operation); gate.Release();
        }
    }

    private async Task<HttpResponseMessage> GetResponseAsync(Uri uri, bool metadata, CancellationToken token)
    {
        for (int redirect = 0; redirect <= 5; redirect++)
        {
            if (!ReleaseProtocol.AllowedUri(uri, metadata)) throw new InvalidDataException("Untrusted update URL.");
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd("RG2.Desktop/" + current);
            request.Headers.Accept.ParseAdd(metadata ? "application/vnd.github+json" : "application/octet-stream");
            if (metadata) request.Headers.Add("X-GitHub-Api-Version", "2026-03-10");
            HttpResponseMessage response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
            if (response.StatusCode is HttpStatusCode.MovedPermanently or HttpStatusCode.Redirect or HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
            {
                Uri? location = response.Headers.Location;
                response.Dispose();
                if (location is null || redirect == 5) throw new InvalidDataException("Invalid update redirect.");
                uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
                continue;
            }
            if (!response.IsSuccessStatusCode)
            {
                HttpStatusCode status = response.StatusCode; response.Dispose();
                throw new HttpRequestException("Update HTTP error.", null, status);
            }
            return response;
        }
        throw new InvalidDataException("Too many update redirects.");
    }

    private async Task<byte[]> ReadBytesAsync(Uri uri, bool metadata, int maximum, long? expected, CancellationToken token)
    {
        using HttpResponseMessage response = await GetResponseAsync(uri, metadata, token).ConfigureAwait(false);
        if (response.Content.Headers.ContentLength is long size && (size > maximum || (expected is not null && size != expected))) throw new InvalidDataException("Update metadata length mismatch.");
        await using Stream stream = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
        using var output = new MemoryStream(); byte[] buffer = new byte[32768];
        while (true)
        {
            int count = await stream.ReadAsync(buffer, token).ConfigureAwait(false);
            if (count == 0) break;
            if (output.Length + count > maximum) throw new InvalidDataException("Update metadata is too large.");
            output.Write(buffer, 0, count);
        }
        if (expected is not null && output.Length != expected) throw new InvalidDataException("Incomplete update metadata.");
        return output.ToArray();
    }
    private static async Task VerifyFileAsync(string path, ReleasePlan plan, CancellationToken token)
    {
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (file.Length != plan.Release.Installer.Bytes || !ReleaseProtocol.HashMatches(await SHA256.HashDataAsync(file, token).ConfigureAwait(false), plan.Sha256)) throw new InvalidDataException("Staged installer verification failed.");
    }
    private static void EnsureDirectory(string path)
    {
        Directory.CreateDirectory(path);
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Update staging cannot be a reparse point.");
    }
    private CancellationTokenSource? BeginJob(TimeSpan timeout, CancellationToken token)
    {
        lock (sync)
        {
            if (disposed) return null;
            userCancelled = false; active = CancellationTokenSource.CreateLinkedTokenSource(token); active.CancelAfter(timeout); return active;
        }
    }
    private void EndJob(CancellationTokenSource? operation)
    {
        lock (sync) { if (ReferenceEquals(active, operation)) active = null; }
        operation?.Dispose();
    }
    internal void Cancel() { lock (sync) { if (active is not null) { userCancelled = true; active.Cancel(); } } }
    private void CancelledOrTimeout(CancellationToken external)
    {
        bool cancelled; lock (sync) cancelled = userCancelled || external.IsCancellationRequested;
        Publish(cancelled ? "cancelled" : "error", cancelled ? "Обновление отменено. Можно проверить его снова." : "Время ожидания истекло. Проверьте подключение и попробуйте снова.");
    }
    private void Publish(string status, string message, string? version = null, int? progress = null)
    {
        if (disposed) return;
        CurrentStatus = new(status, current.ToString(), message, version, progress);
        StatusChanged?.Invoke(CurrentStatus);
    }
    private static bool Recoverable(Exception exception) => exception is HttpRequestException or IOException or InvalidDataException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException or System.ComponentModel.Win32Exception;
    private static string SafeError(Exception exception, bool installing) => exception switch
    {
        HttpRequestException { StatusCode: HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests } => "GitHub временно ограничил запросы. Попробуйте позже или откройте страницу выпусков.",
        HttpRequestException { StatusCode: HttpStatusCode.NotFound } => "Подходящее обновление пока не опубликовано. Можно открыть страницу выпусков.",
        HttpRequestException => "Не удалось связаться с GitHub. Проверьте подключение и попробуйте снова.",
        JsonException or InvalidDataException => installing ? "Обновление не прошло проверку. Запустите проверку обновлений ещё раз." : "Не удалось проверить данные выпуска. Попробуйте позже или откройте страницу выпусков.",
        UnauthorizedAccessException or IOException => "Не удалось сохранить или открыть обновление. Проверьте доступ к папке приложения и попробуйте снова.",
        _ => "Не удалось подготовить обновление. Проверьте его ещё раз или откройте страницу выпусков."
    };
    public void Dispose()
    {
        lock (sync) { if (disposed) return; disposed = true; active?.Cancel(); }
        if (ownsClient) client.Dispose();
        // Do not dispose the semaphore while an awaited job is releasing it.
    }
}
