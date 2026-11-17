using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace RG2.Desktop;

public partial class MainWindow : Window
{
    private const string LocalHost = "rg2.local";
    private static readonly string DataDirectory = ResolveDataDirectory();
    private static readonly string SettingsPath = Path.Combine(DataDirectory, "appearance.json");
    private string themePreference = "system";
    private readonly ReleaseUpdater updater;
    private bool disposed;
    private bool documentPickerOpen;
    private static readonly JsonSerializerOptions UpdateJsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static string CurrentAppVersion
    {
        get
        {
            Version version = typeof(MainWindow).Assembly.GetName().Version ?? new Version(1, 7, 1);
            return $"{version.Major}.{version.Minor}.{Math.Max(0, version.Build)}";
        }
    }

    private static string ResolveDataDirectory()
    {
        string? isolatedDirectory = Environment.GetEnvironmentVariable("RG2_DESKTOP_DATA_DIRECTORY");
        return !string.IsNullOrWhiteSpace(isolatedDirectory) && Path.IsPathFullyQualified(isolatedDirectory)
            ? Path.GetFullPath(isolatedDirectory)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RG2 Desktop");
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    public MainWindow()
    {
        InitializeComponent();
        updater = new ReleaseUpdater(DataDirectory, CurrentAppVersion);
        updater.StatusChanged += PostUpdateStatus;
        string iconPath = Path.Combine(AppContext.BaseDirectory, "data", "app-icon.png");
        if (File.Exists(iconPath)) Icon = BitmapFrame.Create(new Uri(iconPath));
        ReadAppearance();
        SourceInitialized += (_, _) => ApplyAppearance();
        Loaded += InitializeBrowserAsync;
        SystemEvents.UserPreferenceChanged += SystemPreferencesChanged;
        Closed += (_, _) =>
        {
            disposed = true;
            updater.Dispose();
            SystemEvents.UserPreferenceChanged -= SystemPreferencesChanged;
            Browser.Dispose();
        };
    }

    private async void InitializeBrowserAsync(object sender, RoutedEventArgs e)
    {
        Loaded -= InitializeBrowserAsync;
        try
        {
            string dataDirectory = Path.Combine(AppContext.BaseDirectory, "data");
            if (!File.Exists(Path.Combine(dataDirectory, "index.html")))
                throw new FileNotFoundException("Не найден файл data/index.html рядом с приложением.");

            string profileDirectory = Path.Combine(DataDirectory, "WebView2");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: profileDirectory);
            await Browser.EnsureCoreWebView2Async(environment);

            CoreWebView2 core = Browser.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(
                LocalHost, dataDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsWebMessageEnabled = true;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.WebMessageReceived += async (_, message) =>
            {
                if (!IsLocalUri(message.Source)) return;
                try
                {
                    using JsonDocument json = JsonDocument.Parse(message.WebMessageAsJson);
                    JsonElement data = json.RootElement;
                    if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("type", out JsonElement type) || type.ValueKind != JsonValueKind.String) return;
                    string? command = type.GetString();
                    if (command is "puzzle-focus" or "export-puzzle" or "import-puzzle" or "export-review" or "import-review")
                    {
                        if (!IsUpdateMessageSource(message.Source)) return;
                        if (command == "puzzle-focus")
                        {
                            if (data.TryGetProperty("enabled", out JsonElement enabled) && enabled.ValueKind is JsonValueKind.True or JsonValueKind.False)
                                core.Settings.AreBrowserAcceleratorKeysEnabled = !enabled.GetBoolean();
                        }
                        else if (command is "export-review" or "import-review") await ReviewDocumentAsync(command, data);
                        else await PuzzleDocumentAsync(command, data);
                        return;
                    }
                    if (command is "update-check" or "update-install" or "update-cancel")
                    {
                        if (!IsUpdateMessageSource(message.Source)) return;
                        // Renderer messages choose an action only. All release URLs,
                        // versions, staging paths and installer arguments are native.
                        if (command == "update-check") await updater.CheckAsync();
                        else if (command == "update-cancel") updater.Cancel();
                        else if (await updater.InstallAsync() && !disposed) Application.Current.Shutdown();
                        return;
                    }
                    if (command != "theme") return;
                    if (!data.TryGetProperty("preference", out JsonElement value)) return;
                    string? selected = value.GetString();
                    if (selected is not ("system" or "atelier" or "graphite")) return;
                    themePreference = selected;
                    SaveAppearance();
                    ApplyAppearance();
                }
                catch (Exception error) when (error is JsonException or InvalidOperationException) { /* Ignore malformed renderer messages. */ }
            };
            core.NavigationCompleted += (_, args) => { if (args.IsSuccess) PostUpdateStatus(updater.CurrentStatus); };
            ApplyAppearance();

            core.NavigationStarting += (_, args) =>
            {
                if (IsLocalUri(args.Uri)) return;
                args.Cancel = true;
                if (args.IsUserInitiated) OpenExternalLink(args.Uri);
            };
            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (IsLocalUri(args.Uri)) core.Navigate(args.Uri);
                else if (args.IsUserInitiated) OpenExternalLink(args.Uri);
            };
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, args) => args.Cancel = true;

            // The UI and imported articles are local. Remote links open only on a user's click.
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, args) =>
            {
                if (Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out Uri? uri) &&
                    (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
                    !IsLocalUri(args.Request.Uri))
                {
                    args.Response = environment.CreateWebResourceResponse(
                        new MemoryStream(), 403, "Offline application", "Content-Type: text/plain");
                }
            };

            core.Navigate($"https://{LocalHost}/index.html");
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, "Не удалось открыть приложение.\n\n" + exception.Message,
                "TwistForge", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void ReadAppearance()
    {
        try
        {
            if (!File.Exists(SettingsPath)) return;
            using JsonDocument data = JsonDocument.Parse(File.ReadAllText(SettingsPath));
            string? selected = data.RootElement.GetProperty("theme").GetString();
            if (selected is "system" or "atelier" or "graphite") themePreference = selected;
        }
        catch (Exception exception) when (exception is IOException or JsonException or KeyNotFoundException) { }
    }

    private void PostUpdateStatus(UpdateStatus status)
    {
        if (disposed) return;
        Dispatcher.BeginInvoke(() =>
        {
            if (disposed || Browser.CoreWebView2 is not { } core) return;
            core.PostWebMessageAsJson(JsonSerializer.Serialize(status, UpdateJsonOptions));
        });
    }

    private static bool IsUpdateMessageSource(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out Uri? uri) && IsLocalUri(value) &&
        uri.IsDefaultPort && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/index.html";

    private async Task PuzzleDocumentAsync(string command, JsonElement data)
    {
        if (documentPickerOpen) return;
        documentPickerOpen = true;
        try
        {
            if (command == "export-puzzle")
            {
                if (!data.TryGetProperty("text", out JsonElement textElement) || textElement.ValueKind != JsonValueKind.String) return;
                string text = textElement.GetString() ?? "";
                if (System.Text.Encoding.UTF8.GetByteCount(text) > 8 * 1024 * 1024) throw new IOException("Файл партии больше 8 МБ.");
                using JsonDocument game = JsonDocument.Parse(text);
                if (!game.RootElement.TryGetProperty("schema", out JsonElement schema) || schema.GetString() != "rg2-puzzle-game") return;
                string name = data.TryGetProperty("name", out JsonElement proposed) && proposed.ValueKind == JsonValueKind.String ? Path.GetFileName(proposed.GetString() ?? "TwistForge-puzzle.json") : "TwistForge-puzzle.json";
                if (string.IsNullOrWhiteSpace(name) || !name.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) name = "TwistForge-puzzle.json";
                SaveFileDialog dialog = new() { Title = "Сохранить партию TwistForge", Filter = "Партия TwistForge (*.json)|*.json", DefaultExt = ".json", FileName = name, AddExtension = true };
                if (dialog.ShowDialog(this) == true)
                {
                    await File.WriteAllTextAsync(dialog.FileName, text);
                    await PuzzleToastAsync("Партия сохранена.");
                }
            }
            else
            {
                OpenFileDialog dialog = new() { Title = "Открыть партию TwistForge", Filter = "Партия TwistForge (*.json)|*.json|Все файлы (*.*)|*.*", Multiselect = false };
                if (dialog.ShowDialog(this) != true) return;
                if (new FileInfo(dialog.FileName).Length > 8 * 1024 * 1024) throw new IOException("Файл партии больше 8 МБ.");
                string text = await File.ReadAllTextAsync(dialog.FileName);
                using JsonDocument game = JsonDocument.Parse(text);
                string argument = JsonSerializer.Serialize(text);
                if (!disposed) await Browser.CoreWebView2.ExecuteScriptAsync("(()=>{const tool=document.querySelector('#tool-host')?.virtualPuzzle;if(tool)tool.receiveImport(" + argument + ");else window.RG2App?.toast('Открой виртуальные головоломки и повтори импорт.');})()");
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException)
        {
            await PuzzleToastAsync(error is JsonException ? "Не удалось прочитать JSON-партию." : "Не удалось открыть или сохранить файл партии.");
        }
        finally { documentPickerOpen = false; }
    }

    private async Task ReviewDocumentAsync(string command, JsonElement data)
    {
        if (documentPickerOpen) return;
        documentPickerOpen = true;
        try
        {
            if (command == "export-review")
            {
                if (!data.TryGetProperty("text", out JsonElement element) || element.ValueKind != JsonValueKind.String) return;
                string text = element.GetString() ?? "";
                ReviewDocument.Validate(text);
                string? proposed = data.TryGetProperty("name", out JsonElement name) && name.ValueKind == JsonValueKind.String ? name.GetString() : null;
                SaveFileDialog dialog = new() { Title = "Сохранить все пометки TwistForge", Filter = "Пометки TwistForge (*.json)|*.json", DefaultExt = ".json", FileName = ReviewDocument.FileName(proposed), AddExtension = true };
                if (dialog.ShowDialog(this) != true) return;
                await File.WriteAllTextAsync(dialog.FileName, text, new System.Text.UTF8Encoding(false));
                await PuzzleToastAsync("Все пометки сохранены одним файлом.");
            }
            else
            {
                OpenFileDialog dialog = new() { Title = "Открыть пометки TwistForge", Filter = "Пометки TwistForge (*.json)|*.json", Multiselect = false };
                if (dialog.ShowDialog(this) != true) return;
                // Limit the actual read too: a selected file can change after the size check.
                await using FileStream stream = new(dialog.FileName, FileMode.Open, FileAccess.Read, FileShare.Read, 16384, FileOptions.Asynchronous);
                if (stream.Length > ReviewDocument.MaxBytes) throw new InvalidDataException("Review file exceeds 8 MiB.");
                using var bytes = new MemoryStream();
                byte[] block = new byte[16384];
                int count;
                while ((count = await stream.ReadAsync(block)) != 0)
                {
                    if (bytes.Length + count > ReviewDocument.MaxBytes) throw new InvalidDataException("Review file exceeds 8 MiB.");
                    await bytes.WriteAsync(block.AsMemory(0, count));
                }
                string text = new System.Text.UTF8Encoding(false, true).GetString(bytes.ToArray()).TrimStart('\uFEFF');
                ReviewDocument.Validate(text);
                if (!disposed) await Browser.CoreWebView2.ExecuteScriptAsync("window.TwistForgeReview?.receiveImport(" + JsonSerializer.Serialize(text) + ")");
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or System.Text.DecoderFallbackException)
        {
            await PuzzleToastAsync("Не удалось открыть или сохранить пометки. Нужен файл TwistForge JSON до 8 МБ.");
        }
        finally { documentPickerOpen = false; }
    }

    private async Task PuzzleToastAsync(string text)
    {
        if (!disposed && Browser.CoreWebView2 is { } core)
            await core.ExecuteScriptAsync("window.RG2App?.toast(" + JsonSerializer.Serialize(text) + ")");
    }

    private void SaveAppearance()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
            File.WriteAllText(SettingsPath, JsonSerializer.Serialize(new { theme = themePreference }));
        }
        catch (IOException) { /* The UI preference still persists in its local profile. */ }
    }

    private static bool SystemUsesDarkTheme()
    {
        try
        {
            using RegistryKey? key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
        }
        catch (Exception exception) when (exception is IOException or System.Security.SecurityException) { return false; }
    }

    private void SystemPreferencesChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (disposed) return;
        Dispatcher.BeginInvoke(() =>
        {
            if (disposed) return;
            ApplyAppearance();
            Browser.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(
                new { type = "system-theme", dark = SystemUsesDarkTheme() }));
        });
    }

    private void ApplyAppearance()
    {
        bool dark = themePreference == "graphite" || (themePreference == "system" && SystemUsesDarkTheme());
        Color background = (Color)ColorConverter.ConvertFromString(dark ? "#171A20" : "#F7F6F2");
        Background = new SolidColorBrush(background);
        Browser.DefaultBackgroundColor = System.Drawing.Color.FromArgb(background.R, background.G, background.B);
        if (Browser.CoreWebView2 is { } core)
        {
            core.Profile.PreferredColorScheme = themePreference switch
            {
                "atelier" => CoreWebView2PreferredColorScheme.Light,
                "graphite" => CoreWebView2PreferredColorScheme.Dark,
                _ => CoreWebView2PreferredColorScheme.Auto
            };
        }
        IntPtr handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero) return;
        int immersiveDark = dark ? 1 : 0;
        DwmSetWindowAttribute(handle, 20, ref immersiveDark, sizeof(int));
        int caption = dark ? 0x00261F1C : 0x00E8F0EE;
        int text = dark ? 0x00F0EAE7 : 0x00343A20;
        DwmSetWindowAttribute(handle, 35, ref caption, sizeof(int));
        DwmSetWindowAttribute(handle, 36, ref text, sizeof(int));
    }

    private static bool IsLocalUri(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out Uri? uri) &&
        uri.Scheme == Uri.UriSchemeHttps &&
        uri.Host.Equals(LocalHost, StringComparison.OrdinalIgnoreCase);

    private static void OpenExternalLink(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out Uri? uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception) { /* A missing default browser must not interrupt the local app. */ }
    }
}
