using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows;

namespace RG2.Desktop;

public partial class App : Application
{
    // Inno Setup uses the same mutex to protect upgrades and uninstall.
    private Mutex? applicationMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        string name = @"Local\RG2.Desktop.8A0E0E87-2DC8-4E66-857F-E5881EAA379E";
        string? isolated = Environment.GetEnvironmentVariable("RG2_DESKTOP_DATA_DIRECTORY");
        if (!string.IsNullOrWhiteSpace(isolated) && Path.IsPathFullyQualified(isolated))
            name += "." + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(isolated).ToUpperInvariant())))[..16];
        applicationMutex = new Mutex(false, name, out bool created);
        if (!created)
        {
            MessageBox.Show("RG2 уже запущена. Открой её окно на панели задач.", "RG2 Desktop", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }
        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        applicationMutex?.Dispose();
        base.OnExit(e);
    }
}
