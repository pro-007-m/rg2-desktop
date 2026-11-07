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
    private static readonly JsonSerializerOptions UpdateJsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static string CurrentAppVersion
    {
        get
        {
            Version version = typeof(MainWindow).Assembly.GetName().Version ?? new Version(1, 5, 0);
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
                "RG2 · Desktop", MessageBoxButton.OK, MessageBoxImage.Error);
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
