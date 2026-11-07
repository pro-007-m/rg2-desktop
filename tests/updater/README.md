# Updater fixtures

Run from the repository root with .NET SDK 10 and PowerShell:

```powershell
.\tests\updater\run.ps1
```

The project links the production `ReleaseUpdater.cs`. It uses fake HTTP responses and an injected installer launcher: no GitHub requests, installer execution, application windows or real user profile data are needed. Temporary fixture files stay under this test project's `artifacts/` directory and are cleaned after each download test.

The runner passes the repository's `NuGet.Config` explicitly, isolates process-local .NET/NuGet settings, disables first-run certificate generation, and restores the calling process environment when finished. There are no third-party test packages.

Coverage includes strict three-part versions, published stable releases, downgrade prevention, fixed repository/asset names, HTTPS redirect allowlists, duplicate/corrupt JSON, checksum schema, API digests, exact byte lengths and SHA-256, unprivileged fixed installer arguments, cancellation, timeouts, concurrency, retries, and partial-download cleanup.
