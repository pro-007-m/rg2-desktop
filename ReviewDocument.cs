using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RG2.Desktop;

/// <summary>The native envelope gate; the review model validates lesson IDs and every note.</summary>
internal static class ReviewDocument
{
    internal const int MaxBytes = 8 * 1024 * 1024;

    internal static void Validate(string text)
    {
        if (Encoding.UTF8.GetByteCount(text) > MaxBytes) throw new InvalidDataException("Review file exceeds 8 MiB.");
        using JsonDocument document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 64 });
        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Invalid review envelope.");
        var properties = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty property in root.EnumerateObject())
            if (!properties.Add(property.Name)) throw new InvalidDataException("Duplicate review property.");
        if (!root.TryGetProperty("schema", out JsonElement schema) || schema.ValueKind != JsonValueKind.String || schema.GetString() != "twistforge-review" ||
            !root.TryGetProperty("version", out JsonElement version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out int value) || value != 1)
            throw new InvalidDataException("Unsupported review envelope.");
    }

    internal static string FileName(string? proposed) => proposed is not null && Regex.IsMatch(proposed,
        @"\ATwistForge-Review(?:-[A-Za-z0-9_-]{1,60})?\.json\z", RegexOptions.CultureInvariant)
            ? proposed : "TwistForge-Review.json";
}
