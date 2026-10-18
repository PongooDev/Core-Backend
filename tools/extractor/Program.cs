using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using JsonConvert = Newtonsoft.Json.JsonConvert;

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: extractor <build folder containing FortniteGame and Engine> <aes key> [output folder]");
    return 1;
}

var buildRoot = args[0];
var aesKey = args[1].StartsWith("0x") ? args[1] : "0x" + args[1];
var output = args.Length > 2 ? args[2] : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "gamedata"));

var version = JsonNode.Parse(File.ReadAllText(Path.Combine(buildRoot, "Engine", "Build", "Build.version")))!;
var engine = $"{version["MajorVersion"]}.{version["MinorVersion"]}";
var game = engine switch
{
    "4.16" => EGame.GAME_UE4_16,
    _ => throw new NotSupportedException($"Engine {engine} is not mapped yet")
};

var provider = new DefaultFileProvider(Path.Combine(buildRoot, "FortniteGame", "Content", "Paks"), SearchOption.TopDirectoryOnly,
    new VersionContainer(game), StringComparer.OrdinalIgnoreCase);
provider.Initialize();
provider.SubmitKeys([new KeyValuePair<FGuid, FAesKey>(new FGuid(), new FAesKey(aesKey))]);
provider.PostMount();

var assetTypes = new AssetTypes(provider);

var quests = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("FortniteGame/Content/Quests/", StringComparison.OrdinalIgnoreCase)))
{
    foreach (var export in provider.LoadPackage(file).GetExports())
    {
        if (export.ExportType != "FortQuestItemDefinition") continue;
        var properties = JsonNode.Parse(JsonConvert.SerializeObject(export))!["Properties"] ?? new JsonObject();
        quests[export.Name.ToLowerInvariant()] = Quest(properties, assetTypes);
    }
}

Directory.CreateDirectory(output);
var options = new JsonSerializerOptions { WriteIndented = true };
File.WriteAllText(Path.Combine(output, "quests.json"), JsonSerializer.Serialize(quests, options) + "\n");
Console.WriteLine($"{quests.Count} quests from {version["BranchName"]}-CL-{version["Changelist"]} into {output}");
return 0;

static object Quest(JsonNode p, AssetTypes assetTypes)
{
    var quest = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["type"] = Enum(p["QuestType"]) ?? "Task",
        ["objectives"] = (p["Objectives"]?.AsArray() ?? []).Select(o => new SortedDictionary<string, object>
        {
            ["name"] = o!["BackendName"]!.GetValue<string>().ToLowerInvariant(),
            ["count"] = o["Count"]?.GetValue<int>() ?? 1
        }).ToList()
    };
    AddItems(quest, "rewards", p["Rewards"], assetTypes);
    AddItems(quest, "hiddenRewards", p["HiddenRewards"], assetTypes);
    var selectable = (p["SelectableRewards"]?.AsArray() ?? [])
        .Select(group => Items(group!["Rewards"], assetTypes))
        .Where(group => group.Count > 0)
        .ToList();
    if (selectable.Count > 0) quest["selectableRewards"] = selectable;
    var prerequisiteQuest = p["PrerequisiteQuest"] is null ? null : AssetPath(p["PrerequisiteQuest"]);
    if (!string.IsNullOrEmpty(prerequisiteQuest) && prerequisiteQuest != "None")
        quest["prerequisiteQuest"] = prerequisiteQuest.Split('.').Last().ToLowerInvariant();
    var tags = p["Prerequisites"]?.AsArray().Select(t => t!.GetValue<string>()).ToList();
    if (tags is { Count: > 0 }) quest["prerequisites"] = tags;
    if (p["bHidden"]?.GetValue<bool>() == true) quest["hidden"] = true;
    if (p["bDeprecated"]?.GetValue<bool>() == true) quest["deprecated"] = true;
    if (p["ExpirationDuration"]?.GetValue<int>() is int expiration and > 0) quest["expirationDuration"] = expiration;
    return quest;
}

static void AddItems(IDictionary<string, object> target, string key, JsonNode? items, AssetTypes assetTypes)
{
    var list = Items(items, assetTypes);
    if (list.Count > 0) target[key] = list;
}

static List<SortedDictionary<string, object>> Items(JsonNode? items, AssetTypes assetTypes) =>
    (items?.AsArray() ?? []).Select(i => new SortedDictionary<string, object>
    {
        ["templateId"] = i!["TemplateId"]?.GetValue<string>() ?? assetTypes.TemplateId(AssetPath(i["ItemDefinition"])),
        ["quantity"] = i["Quantity"]?.GetValue<int>() ?? 1
    }).ToList();

static string? Enum(JsonNode? value) => value?.GetValue<string>().Split("::").Last();

static string AssetPath(JsonNode? value) =>
    value is JsonObject path ? path["AssetPathName"]!.GetValue<string>() : value!.GetValue<string>();

sealed class AssetTypes
{
    private readonly DefaultFileProvider provider;
    private readonly List<(string Type, string BaseClass, string[] Directories)> rules = [];
    private readonly Dictionary<string, string> cache = new(StringComparer.OrdinalIgnoreCase);

    public AssetTypes(DefaultFileProvider provider)
    {
        this.provider = provider;
        var config = Encoding.UTF8.GetString(provider.SaveAsset("FortniteGame/Config/DefaultGame.ini"));
        foreach (Match line in Regex.Matches(config, @"^\+PrimaryAssetTypesToScan=\((.*)\)\s*$", RegexOptions.Multiline))
        {
            var body = line.Groups[1].Value;
            var type = Regex.Match(body, "PrimaryAssetType=\"([^\"]+)\"").Groups[1].Value;
            var baseClass = Regex.Match(body, @"AssetBaseClass=/Script/[^.]+\.(\w+)").Groups[1].Value;
            var directories = Regex.Matches(body, "Path=\"([^\"]+)\"").Select(m => m.Groups[1].Value.TrimEnd('/') + "/").ToArray();
            if (type.Length > 0 && directories.Length > 0) rules.Add((type, baseClass, directories));
        }
    }

    public string TemplateId(string objectPath)
    {
        if (cache.TryGetValue(objectPath, out var known)) return known;

        var packagePath = objectPath.Split('.')[0];
        var assetName = packagePath.Split('/').Last();
        var file = "FortniteGame/Content/" + packagePath["/Game/".Length..] + ".uasset";
        var exportClass = provider.TryLoadPackage(file, out var package)
            ? package.GetExports().FirstOrDefault(e => e.Name.Equals(assetName, StringComparison.OrdinalIgnoreCase))?.ExportType
            : null;

        var candidates = rules
            .Select(rule => (rule, depth: rule.Directories.Where(d => packagePath.StartsWith(d, StringComparison.OrdinalIgnoreCase)).Select(d => d.Length).DefaultIfEmpty(-1).Max()))
            .Where(c => c.depth >= 0)
            .ToList();
        var match = candidates.Where(c => c.rule.BaseClass == exportClass).OrderByDescending(c => c.depth).Select(c => c.rule).FirstOrDefault();
        if (match.Type is null)
            match = candidates.OrderByDescending(c => c.depth).Select(c => c.rule).FirstOrDefault();
        if (match.Type is null)
            throw new InvalidOperationException($"No primary asset type for {objectPath} ({exportClass})");

        return cache[objectPath] = $"{match.Type}:{assetName.ToLowerInvariant()}";
    }
}
