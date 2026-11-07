using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using RG2.Desktop;

static class Program
{
    private static readonly string ArtifactRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../artifacts"));
    private static readonly ReleaseVersion Current = new(1, 5, 0);
    private static int assertions;
    static void Check(bool value, string reason) { assertions++; if (!value) throw new Exception(reason); }
    static void Reject(Action action, string reason) { bool failed = false; try { action(); } catch (Exception error) when (error is InvalidDataException or JsonException or ArgumentException) { failed = true; } Check(failed, reason); }
    static JsonObject Object(byte[] bytes) => JsonNode.Parse(bytes)!.AsObject();
    static byte[] Bytes(JsonNode node) => Encoding.UTF8.GetBytes(node.ToJsonString());
    static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    static async Task Main()
    {
        Directory.CreateDirectory(ArtifactRoot);
        var tests = new (string Name, Func<Task> Run)[] {
            ("strict release versions and comparisons", Versions),
            ("release origin, flags, assets and duplicate metadata", ReleaseValidation),
            ("checksum schema, hashes, sizes and path rejection", ManifestValidation),
            ("no automatic requests; explicit verified download; fixed unprivileged launch", ValidDownload),
            ("older and equal releases never become install plans", NoDowngrade),
            ("malformed metadata and missing installer are recoverable", RecoverableErrors),
            ("corrupted and incomplete payloads never launch", BadPayloads),
            ("API asset digests are enforced when present", ApiDigests),
            ("redirect allowlist is enforced before each next request", Redirects),
            ("check cancellation, timeout, concurrency and retry", Cancellation),
            ("partial installer cancellation deletes temporary data", DownloadCancellation),
        };
        int failed = 0;
        foreach (var test in tests)
        {
            try { await test.Run(); Console.WriteLine("PASS " + test.Name); }
            catch (Exception error) { failed++; Console.WriteLine("FAIL " + test.Name + ": " + error); }
        }
        Console.WriteLine($"Updater fixtures: {tests.Length - failed}/{tests.Length} groups, {assertions} assertions. No real installer, user profile or network used.");
        Environment.ExitCode = failed == 0 ? 0 : 1;
    }
    static Task Versions()
    {
        foreach (string input in new[] { "1.5.0", "v1.5.1", "0.0.0", "12.103.999" }) Check(ReleaseVersion.TryParse(input, out _), "Valid version rejected");
        foreach (string input in new[] { "1.5", "1.5.0.0", "01.5.0", "1.5.0-beta", "1.5.0+meta", " 1.5.0", "1.5.0\n", "v1.5.0/../", "999999999999.0.0" }) Check(!ReleaseVersion.TryParse(input, out _), "Noncanonical version accepted");
        Check(new ReleaseVersion(1, 10, 0).CompareTo(new(1, 9, 999)) > 0, "Numeric comparison is required");
        Check(!ReleaseVersion.TryParse("v1.5.0", out _, false), "Manifest app version must be three plain components");
        return Task.CompletedTask;
    }
    static Task ReleaseValidation()
    {
        var fixture = new Fixture();
        ReleaseCandidate parsed = ReleaseProtocol.ParseLatest(fixture.Latest, Current)!;
        Check(parsed.Version == new ReleaseVersion(1, 5, 1), "Expected newer stable version");
        foreach (string property in new[] { "draft", "prerelease" }) { var json = Object(fixture.Latest); json[property] = true; Reject(() => ReleaseProtocol.ParseLatest(Bytes(json), Current), "Unpublished/prerelease update accepted"); }
        foreach (string url in new[] {
            "http://github.com/pro-007-m/rg2-desktop/releases/download/v1.5.1/" + fixture.InstallerName,
            "https://github.com.evil.example/pro-007-m/rg2-desktop/releases/download/v1.5.1/" + fixture.InstallerName,
            "https://user@github.com/pro-007-m/rg2-desktop/releases/download/v1.5.1/" + fixture.InstallerName,
            "https://github.com:444/pro-007-m/rg2-desktop/releases/download/v1.5.1/" + fixture.InstallerName,
            "https://github.com/another/repo/releases/download/v1.5.1/" + fixture.InstallerName,
            "https://github.com/pro-007-m/rg2-desktop/releases/download/v1.5.1/" + fixture.InstallerName + "?run=1"
        }) { var json = Object(fixture.Latest); json["assets"]![0]!["browser_download_url"] = url; Reject(() => ReleaseProtocol.ParseLatest(Bytes(json), Current), "Untrusted asset URL accepted"); }
        foreach (JsonNode? value in new JsonNode?[] { 0, -1, "32", 2.5, null }) { var json = Object(fixture.Latest); json["assets"]![0]!["size"] = value?.DeepClone(); Reject(() => ReleaseProtocol.ParseLatest(Bytes(json), Current), "Invalid length accepted"); }
        { var json = Object(fixture.Latest); json["assets"]!.AsArray().Add(json["assets"]![0]!.DeepClone()); Reject(() => ReleaseProtocol.ParseLatest(Bytes(json), Current), "Duplicate installer accepted"); }
        { var json = Object(fixture.Latest); json["assets"]![0]!["digest"] = "sha1:" + new string('0', 40); Reject(() => ReleaseProtocol.ParseLatest(Bytes(json), Current), "Unsupported API digest accepted"); }
        string duplicate = Encoding.UTF8.GetString(fixture.Latest).Replace("\"draft\":false", "\"draft\":false,\"draft\":false");
        Reject(() => ReleaseProtocol.ParseLatest(Encoding.UTF8.GetBytes(duplicate), Current), "Duplicate JSON properties accepted");
        return Task.CompletedTask;
    }
    static Task ManifestValidation()
    {
        var fixture = new Fixture(); var release = ReleaseProtocol.ParseLatest(fixture.Latest, Current)!;
        Check(ReleaseProtocol.ParseChecksums(fixture.Manifest, release).Sha256 == Hash(fixture.Payload), "Valid manifest rejected");
        foreach (var mutation in new Action<JsonObject>[] {
            json => json["version"] = "1.5.2", json => json["version"] = "v1.5.1", json => json["commit"] = "main",
            json => json["files"]![0]!["bytes"] = fixture.Payload.Length + 1,
            json => json["files"]![0]!["sha256"] = new string('0', 63),
            json => json["files"]![0]!["name"] = "../outside.exe",
            json => json["files"]!.AsArray().Add(json["files"]![0]!.DeepClone()),
        }) { var json = Object(fixture.Manifest); mutation(json); Reject(() => ReleaseProtocol.ParseChecksums(Bytes(json), release), "Invalid checksum manifest accepted"); }
        var plan = ReleaseProtocol.ParseChecksums(fixture.Manifest, release);
        Reject(() => ReleaseProtocol.InstallerStartInfo(ArtifactRoot, Path.Combine(ArtifactRoot, "outside.exe"), plan), "Installer escaped staged version path");
        return Task.CompletedTask;
    }
    static async Task ValidDownload()
    {
        var fixture = new Fixture(); using var handler = new Handler(fixture.Response); using var client = new HttpClient(handler);
        var starts = new List<ProcessStartInfo>(); string directory = FixtureDirectory();
        using var updater = new ReleaseUpdater(directory, "1.5.0", client, starts.Add);
        Check(handler.Requests.Count == 0, "Constructor performed an automatic check");
        await updater.CheckAsync(); Check(updater.CurrentStatus.Status == "available", "Check did not offer newer release");
        Check(!Directory.Exists(directory), "Checking metadata should not create staging directories");
        Check(await updater.InstallAsync(), "Verified installer did not reach injected launcher");
        Check(starts.Count == 1, "Installer launched more than once");
        var start = starts.Single();
        Check(start.Arguments == "/UPDATE /NORESTART" && start.UseShellExecute && string.IsNullOrEmpty(start.Verb), "Launcher command or elevation policy changed");
        Check(start.FileName == Path.Combine(directory, "Updates", "1.5.1", fixture.InstallerName), "Unexpected staging destination");
        Check(File.ReadAllBytes(start.FileName).SequenceEqual(fixture.Payload), "Staged data changed");
        Check(updater.CurrentStatus.Status == "installing", "Success status missing");
        RemoveFixture(directory);
    }
    static async Task NoDowngrade()
    {
        foreach (string tag in new[] { "v1.5.0", "v1.4.9" })
        {
            var fixture = new Fixture(); var json = Object(fixture.Latest); json["tag_name"] = tag; fixture.Latest = Bytes(json);
            using var handler = new Handler(fixture.Response); using var client = new HttpClient(handler); int launched = 0;
            using var updater = new ReleaseUpdater(FixtureDirectory(), "1.5.0", client, _ => launched++);
            await updater.CheckAsync(); Check(updater.CurrentStatus.Status == "up-to-date", "Older release was offered");
            Check(handler.Requests.Count == 1, "Downloaded manifest for a non-update");
            Check(!await updater.InstallAsync() && launched == 0, "Downgrade was launched");
        }
    }
    static async Task RecoverableErrors()
    {
        foreach (byte[] metadata in new[] { Encoding.UTF8.GetBytes("not JSON"), Encoding.UTF8.GetBytes("{\"draft\":false}") })
        {
            var fixture = new Fixture { Latest = metadata }; using var handler = new Handler(fixture.Response); using var client = new HttpClient(handler);
            using var updater = new ReleaseUpdater(FixtureDirectory(), "1.5.0", client, _ => throw new Exception("Must not launch"));
            await updater.CheckAsync(); Check(updater.CurrentStatus.Status == "error", "Corrupt JSON did not recover");
            fixture.Latest = new Fixture().Latest; await updater.CheckAsync(); Check(updater.CurrentStatus.Status == "available", "Could not retry after metadata error");
        }
        using var unavailable = new Handler((_, _) => throw new HttpRequestException("secret connection detail")); using var unavailableClient = new HttpClient(unavailable);
        using var offline = new ReleaseUpdater(FixtureDirectory(), "1.5.0", unavailableClient, _ => throw new Exception("Must not launch"));
        await offline.CheckAsync(); Check(offline.CurrentStatus.Status == "error" && !offline.CurrentStatus.Message.Contains("secret"), "Network error exposed internal details");
    }
    static async Task BadPayloads()
    {
        foreach (string mode in new[] { "hash", "short", "long" })
        {
            var fixture = new Fixture(); using var handler = new Handler(fixture.Response); using var client = new HttpClient(handler); int starts = 0; string directory = FixtureDirectory();
            using var updater = new ReleaseUpdater(directory, "1.5.0", client, _ => starts++);
            await updater.CheckAsync();
            fixture.Download = mode == "hash" ? fixture.Payload.Select((value, index) => index == 0 ? (byte)(value ^ 1) : value).ToArray() : mode == "short" ? fixture.Payload[..^1] : fixture.Payload.Concat(new byte[] { 0 }).ToArray();
            Check(!await updater.InstallAsync() && starts == 0, "Unverified payload launched");
            Check(updater.CurrentStatus.Status == "error", "Payload verification error missing");
            Check(!Directory.EnumerateFiles(directory, "*.part", SearchOption.AllDirectories).Any(), "Temporary corrupted payload remained");
            RemoveFixture(directory);
        }
    }
    static async Task ApiDigests()
    {
        var fixture = new Fixture(); var json = Object(fixture.Latest); json["assets"]![1]!["digest"] = "sha256:" + new string('0', 64); fixture.Latest = Bytes(json);
        using var handler = new Handler(fixture.Response); using var client = new HttpClient(handler); using var updater = new ReleaseUpdater(FixtureDirectory(), "1.5.0", client, _ => throw new Exception("Must not launch"));
        await updater.CheckAsync(); Check(updater.CurrentStatus.Status == "error", "Manifest API digest was ignored");
        fixture = new Fixture(); json = Object(fixture.Latest); json["assets"]![0]!["digest"] = "sha256:" + new string('0', 64); fixture.Latest = Bytes(json);
        using var secondHandler = new Handler(fixture.Response); using var secondClient = new HttpClient(secondHandler); using var second = new ReleaseUpdater(FixtureDirectory(), "1.5.0", secondClient, _ => throw new Exception("Must not launch"));
        await second.CheckAsync(); Check(second.CurrentStatus.Status == "error", "Conflicting installer API digest was ignored");
    }
    static async Task Redirects()
    {
        foreach (string target in new[] { "https://evil.example/payload", "http://release-assets.githubusercontent.com/payload", "https://github.com.evil.example/payload", "https://release-assets.githubusercontent.com:444/payload" })
        {
            var fixture = new Fixture(); using var handler = new Handler((request, token) => request.RequestUri!.AbsolutePath.EndsWith(".exe") ? Task.FromResult(Redirect(target)) : fixture.Response(request, token));
            using var client = new HttpClient(handler); string directory = FixtureDirectory();
            using var updater = new ReleaseUpdater(directory, "1.5.0", client, _ => throw new Exception("Must not launch"));
            await updater.CheckAsync(); Check(!await updater.InstallAsync(), "Unsafe redirect reached launcher");
            Check(handler.Requests.All(uri => uri.Host is "api.github.com" or "github.com"), "Untrusted redirect was requested before validation"); RemoveFixture(directory);
        }
        { var fixture = new Fixture(); using var handler = new Handler((request, token) => request.RequestUri!.Host == "release-assets.githubusercontent.com" ? Task.FromResult(Ok(fixture.Payload)) : request.RequestUri.AbsolutePath.EndsWith(".exe") ? Task.FromResult(Redirect("https://release-assets.githubusercontent.com/fixture?signature=test")) : fixture.Response(request, token)); using var client = new HttpClient(handler); string directory = FixtureDirectory(); int starts = 0; using var updater = new ReleaseUpdater(directory, "1.5.0", client, _ => starts++); await updater.CheckAsync(); Check(await updater.InstallAsync() && starts == 1, "Approved CDN redirect failed"); RemoveFixture(directory); }
    }
    static async Task Cancellation()
    {
        var fixture = new Fixture(); var observed = new TaskCompletionSource(); bool stall = true;
        using var handler = new Handler(async (request, token) => { if (stall) { observed.TrySetResult(); await Task.Delay(Timeout.Infinite, token); } return await fixture.Response(request, token); });
        using var client = new HttpClient(handler); using var updater = new ReleaseUpdater(FixtureDirectory(), "1.5.0", client, _ => throw new Exception("Must not launch"));
        Task running = updater.CheckAsync(); await observed.Task.WaitAsync(TimeSpan.FromSeconds(3)); await updater.CheckAsync(); Check(handler.Requests.Count == 1, "Concurrent check escaped the native gate"); updater.Cancel(); await running.WaitAsync(TimeSpan.FromSeconds(3)); Check(updater.CurrentStatus.Status == "cancelled", "User cancellation not reported"); stall = false; await updater.CheckAsync(); Check(updater.CurrentStatus.Status == "available", "Cancel prevented later retry");
        using var timeoutHandler = new Handler(async (_, token) => { await Task.Delay(Timeout.Infinite, token); throw new Exception(); }); using var timeoutClient = new HttpClient(timeoutHandler); using var timeoutUpdater = new ReleaseUpdater(FixtureDirectory(), "1.5.0", timeoutClient, _ => throw new Exception(), checkTimeout: TimeSpan.FromMilliseconds(30)); await timeoutUpdater.CheckAsync(); Check(timeoutUpdater.CurrentStatus.Status == "error" && timeoutUpdater.CurrentStatus.Message.Contains("ожидания"), "Timeout was not recoverable");
    }
    static async Task DownloadCancellation()
    {
        var fixture = new Fixture(); var progressed = new TaskCompletionSource(); string directory = FixtureDirectory(); int starts = 0;
        using var handler = new Handler((request, token) => {
            if (!request.RequestUri!.AbsolutePath.EndsWith(".exe")) return fixture.Response(request, token);
            var content = new StreamContent(new PartialStream()); content.Headers.ContentLength = fixture.Payload.Length;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
        });
        using var client = new HttpClient(handler); using var updater = new ReleaseUpdater(directory, "1.5.0", client, _ => starts++);
        updater.StatusChanged += status => { if (status.Status == "downloading" && status.Progress > 0) progressed.TrySetResult(); };
        await updater.CheckAsync(); Task<bool> running = updater.InstallAsync(); await progressed.Task.WaitAsync(TimeSpan.FromSeconds(3)); updater.Cancel();
        Check(!await running.WaitAsync(TimeSpan.FromSeconds(3)) && starts == 0, "Cancelled partial download launched");
        Check(!Directory.EnumerateFiles(directory, "*.part", SearchOption.AllDirectories).Any(), "Cancelled partial file remained");
        Check(updater.CurrentStatus.Status == "cancelled", "Download cancellation status missing"); RemoveFixture(directory);
    }
    static string FixtureDirectory() => Path.Combine(ArtifactRoot, Guid.NewGuid().ToString("N"));
    static void RemoveFixture(string directory)
    {
        string full = Path.GetFullPath(directory);
        Check(full.StartsWith(ArtifactRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase), "Refusing cleanup outside fixture root");
        if (Directory.Exists(full)) Directory.Delete(full, true);
    }
    static HttpResponseMessage Ok(byte[] bytes) => new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
    static HttpResponseMessage Redirect(string destination) { var response = new HttpResponseMessage(HttpStatusCode.Redirect); response.Headers.Location = new Uri(destination); return response; }

    sealed class Fixture
    {
        internal readonly byte[] Payload = Encoding.ASCII.GetBytes("MZ-fixture-data-not-a-real-program");
        internal byte[] Latest, Manifest;
        internal byte[]? Download;
        internal readonly string InstallerName = "RG2-Desktop-1.5.1-Setup-x64.exe";
        internal Fixture()
        {
            Manifest = JsonSerializer.SerializeToUtf8Bytes(new { version = "1.5.1", commit = new string('a', 40), files = new[] { new { name = InstallerName, bytes = Payload.Length, sha256 = Hash(Payload) } } });
            Latest = JsonSerializer.SerializeToUtf8Bytes(new { tag_name = "v1.5.1", draft = false, prerelease = false, assets = new[] {
                new { name = InstallerName, state = "uploaded", size = Payload.Length, digest = "sha256:" + Hash(Payload), browser_download_url = ReleaseProtocol.RepositoryUrl + "/releases/download/v1.5.1/" + InstallerName },
                new { name = "RG2-Desktop-1.5.1-checksums.json", state = "uploaded", size = Manifest.Length, digest = "sha256:" + Hash(Manifest), browser_download_url = ReleaseProtocol.RepositoryUrl + "/releases/download/v1.5.1/RG2-Desktop-1.5.1-checksums.json" }
            } });
        }
        internal Task<HttpResponseMessage> Response(HttpRequestMessage request, CancellationToken token)
        {
            byte[] body = request.RequestUri == ReleaseProtocol.LatestApi ? Latest : request.RequestUri!.AbsolutePath.EndsWith("checksums.json") ? Manifest : Download ?? Payload;
            return Task.FromResult(Ok(body));
        }
    }
    sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        internal ConcurrentQueue<Uri> Requests = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { Requests.Enqueue(request.RequestUri!); return response(request, token); }
    }
    sealed class PartialStream : Stream
    {
        private bool first = true;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) { if (first) { first = false; buffer.Span[0] = 77; return 1; } await Task.Delay(Timeout.Infinite, cancellationToken); return 0; }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
