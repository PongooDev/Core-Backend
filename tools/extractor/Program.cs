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

var items = new SortedDictionary<string, object>(StringComparer.Ordinal);
var unmapped = new SortedSet<string>(StringComparer.Ordinal);
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && assetTypes.IsItemPath(f.Path)))
{
    var gamePath = "/Game/" + file.PathWithoutExtension["FortniteGame/Content/".Length..];
    var assetName = gamePath.Split('/').Last();
    if (!provider.TryLoadPackage(file, out var package)) continue;
    var export = package.GetExports().FirstOrDefault(e => e.Name.Equals(assetName, StringComparison.OrdinalIgnoreCase));
    if (export is null || export.ExportType == "FortQuestItemDefinition") continue;
    var profile = ItemClasses.ProfileType(export.ExportType);
    if (profile is null)
    {
        if (export.ExportType.EndsWith("ItemDefinition") || export.ExportType.EndsWith("Type")) unmapped.Add(export.ExportType);
        continue;
    }
    var templateId = assetTypes.TemplateId($"{gamePath}.{export.Name}", export.ExportType, true);
    if (templateId is null) continue;
    var properties = JsonNode.Parse(JsonConvert.SerializeObject(export))!["Properties"];
    items[templateId] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["class"] = export.ExportType,
        ["profile"] = profile,
        ["maxStackSize"] = properties?["MaxStackSize"]?.GetValue<int>() ?? ItemClasses.DefaultMaxStackSize(export.ExportType)
    };
}

// The client calls the schedule without a token "Default" and looks rows up by the name "%d".
var dailyRewards = new List<SortedDictionary<string, object>>();
if (!provider.TryLoadPackage("FortniteGame/Content/Balance/DefaultGameData.uasset", out var gameDataPackage))
    throw new InvalidOperationException("DefaultGameData not found");
var gameData = JsonNode.Parse(JsonConvert.SerializeObject(gameDataPackage.GetExports().First(e => e.ExportType == "FortGameData")))!;
foreach (var schedule in gameData["Properties"]?["DailyRewardSchedules"]?.AsArray() ?? [])
{
    var tokenPath = schedule!["EnablingToken"] is null ? "" : AssetPath(schedule["EnablingToken"]);
    var tablePath = schedule["Rewards"]!["ObjectPath"]!.GetValue<string>().Split('.')[0];
    if (!provider.TryLoadPackage(tablePath + ".uasset", out var tablePackage)) throw new InvalidOperationException($"{tablePath} not found");
    var rows = JsonNode.Parse(JsonConvert.SerializeObject(tablePackage.GetExports().First(e => e.ExportType == "DataTable")))!["Rows"]!.AsObject();
    if (!rows.Select(r => r.Key).OrderBy(int.Parse).SequenceEqual(Enumerable.Range(0, rows.Count).Select(i => i.ToString())))
        throw new InvalidOperationException($"{tablePath} rows are not named 0..{rows.Count - 1}");

    var entry = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["name"] = tokenPath is "" or "None" ? "Default" : tokenPath.Split('/').Last().Split('.').Last(),
        ["rewards"] = rows.OrderBy(r => int.Parse(r.Key)).Select(r => new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["templateId"] = assetTypes.TemplateId(AssetPath(r.Value!["ItemDefinition"])),
            ["quantity"] = r.Value["ItemCount"]?.GetValue<int>() ?? 1,
            ["major"] = r.Value["bIsMajorReward"]?.GetValue<bool>() ?? false
        }).ToList()
    };
    if (tokenPath is not ("" or "None")) entry["token"] = assetTypes.TemplateId(tokenPath);
    dailyRewards.Add(entry);
}

Directory.CreateDirectory(output);
var options = new JsonSerializerOptions { WriteIndented = true };
File.WriteAllText(Path.Combine(output, "quests.json"), JsonSerializer.Serialize(quests, options) + "\n");
File.WriteAllText(Path.Combine(output, "items.json"), JsonSerializer.Serialize(items, options) + "\n");
File.WriteAllText(Path.Combine(output, "dailyrewards.json"), JsonSerializer.Serialize(dailyRewards, options) + "\n");
Console.WriteLine($"{quests.Count} quests, {items.Count} items and {dailyRewards.Count} daily reward schedules from {version["BranchName"]}-CL-{version["Changelist"]} into {output}");
if (unmapped.Count > 0) Console.WriteLine($"Skipped item classes with no known profile: {string.Join(", ", unmapped)}");
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
    }).Where(i => (string)i["templateId"] != "None").ToList();

static string? Enum(JsonNode? value) => value?.GetValue<string>().Split("::").Last();

static string AssetPath(JsonNode? value) =>
    value is JsonObject path ? path["AssetPathName"]!.GetValue<string>() : value!.GetValue<string>();

// Parents from the SDK dump; constructor MaxStackSize defaults read from each class's native constructor.
static class ItemClasses
{
    private static readonly Dictionary<string, string> Parents = new()
    {
        ["FortAccountItemDefinition"] = "FortItemDefinition",
        ["FortWorldItemDefinition"] = "FortItemDefinition",
        ["FortAccountBuffItemDefinition"] = "FortAccountItemDefinition",
        ["FortAlterableItemDefinition"] = "FortAccountItemDefinition",
        ["FortAlterationItemDefinition"] = "FortAccountItemDefinition",
        ["FortCardPackItemDefinition"] = "FortAccountItemDefinition",
        ["FortCharacterCosmeticItemDefinition"] = "FortAccountItemDefinition",
        ["FortCharacterType"] = "FortAccountItemDefinition",
        ["FortCloudSaveItemDefinition"] = "FortAccountItemDefinition",
        ["FortCodeTokenItemDefinition"] = "FortAccountItemDefinition",
        ["FortCollectedResourceItemDefinition"] = "FortAccountItemDefinition",
        ["FortConsumableAccountItemDefinition"] = "FortAccountItemDefinition",
        ["FortConversionControlItemDefinition"] = "FortAccountItemDefinition",
        ["FortCurrencyItemDefinition"] = "FortAccountItemDefinition",
        ["FortExpeditionItemDefinition"] = "FortAccountItemDefinition",
        ["FortGameplayModifierItemDefinition"] = "FortAccountItemDefinition",
        ["FortHomebaseBannerColorItemDefinition"] = "FortAccountItemDefinition",
        ["FortHomebaseBannerIconItemDefinition"] = "FortAccountItemDefinition",
        ["FortHomebaseNodeItemDefinition"] = "FortAccountItemDefinition",
        ["FortPersistentResourceItemDefinition"] = "FortAccountItemDefinition",
        ["FortQuestItemDefinition"] = "FortAccountItemDefinition",
        ["FortQuotaItemDefinition"] = "FortAccountItemDefinition",
        ["FortTokenType"] = "FortAccountItemDefinition",
        ["FortAccountBuffCreditItemDefinition"] = "FortConsumableAccountItemDefinition",
        ["FortSchematicItemDefinition"] = "FortAlterableItemDefinition",
        ["FortWorkerType"] = "FortCharacterType",
        ["FortDefenderItemDefinition"] = "FortCharacterType",
        ["FortHeroType"] = "FortWorkerType",
        ["FortDailyRewardScheduleTokenDefinition"] = "FortTokenType",
        ["FortOutpostItemDefinition"] = "FortCloudSaveItemDefinition",
        ["FortDeployableBaseCloudSaveItemDefinition"] = "FortCloudSaveItemDefinition",
        ["FortAmmoItemDefinition"] = "FortWorldItemDefinition",
        ["FortBackpackItemDefinition"] = "FortWorldItemDefinition",
        ["FortBadgeItemDefinition"] = "FortWorldItemDefinition",
        ["FortConsumableItemDefinition"] = "FortWorldItemDefinition",
        ["FortEmoteItemDefinition"] = "FortWorldItemDefinition",
        ["FortGadgetItemDefinition"] = "FortWorldItemDefinition",
        ["FortIngredientItemDefinition"] = "FortWorldItemDefinition",
        ["FortMissionItemDefinition"] = "FortWorldItemDefinition",
        ["FortNeverPersistItemDefinition"] = "FortWorldItemDefinition",
        ["FortResourceItemDefinition"] = "FortWorldItemDefinition",
        ["FortWeaponItemDefinition"] = "FortWorldItemDefinition",
        ["FortBuildingItemDefinition"] = "FortWeaponItemDefinition",
        ["FortDecoItemDefinition"] = "FortWeaponItemDefinition",
        ["FortEditToolItemDefinition"] = "FortWeaponItemDefinition",
        ["FortWeaponMeleeItemDefinition"] = "FortWeaponItemDefinition",
        ["FortWeaponRangedItemDefinition"] = "FortWeaponItemDefinition",
        ["FortTrapItemDefinition"] = "FortDecoItemDefinition",
        ["FortFOBCoreDecoItemDefinition"] = "FortDecoItemDefinition"
    };

    private static readonly Dictionary<string, int> ConstructorMaxStackSize = new()
    {
        ["FortItemDefinition"] = 1,
        ["FortAccountBuffCreditItemDefinition"] = -1,
        ["FortAmmoItemDefinition"] = int.MaxValue,
        ["FortBadgeItemDefinition"] = 25,
        ["FortCodeTokenItemDefinition"] = 1000,
        ["FortConsumableAccountItemDefinition"] = -1,
        ["FortConsumableItemDefinition"] = 999,
        ["FortCurrencyItemDefinition"] = -1,
        ["FortDecoItemDefinition"] = 999,
        ["FortGadgetItemDefinition"] = 999,
        ["FortIngredientItemDefinition"] = 999,
        ["FortNeverPersistItemDefinition"] = int.MaxValue,
        ["FortPersistentResourceItemDefinition"] = -1,
        ["FortResourceItemDefinition"] = int.MaxValue
    };

    public static IEnumerable<string> Lineage(string itemClass)
    {
        for (var current = itemClass; current is not null; current = Parents.GetValueOrDefault(current))
            yield return current;
    }

    // Outposts and deployable bases live in their own profiles, which aren't mapped yet.
    public static string? ProfileType(string itemClass)
    {
        var lineage = Lineage(itemClass).ToList();
        if (lineage.Contains("FortCloudSaveItemDefinition")) return null;
        if (lineage.Contains("FortAccountItemDefinition")) return "profile";
        if (lineage.Contains("FortWorldItemDefinition")) return "theater";
        return null;
    }

    public static int DefaultMaxStackSize(string itemClass) =>
        Lineage(itemClass).Where(ConstructorMaxStackSize.ContainsKey).Select(c => ConstructorMaxStackSize[c]).First();
}

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

    public bool IsItemPath(string filePath)
    {
        if (!filePath.StartsWith("FortniteGame/Content/", StringComparison.OrdinalIgnoreCase)) return false;
        var gamePath = "/Game/" + filePath["FortniteGame/Content/".Length..];
        return rules.Any(rule => rule.Directories.Any(d => gamePath.StartsWith(d, StringComparison.OrdinalIgnoreCase)));
    }

    public string TemplateId(string objectPath) => TemplateId(objectPath, null, false)!;

    public string? TemplateId(string objectPath, string? exportClass, bool strict)
    {
        if (cache.TryGetValue(objectPath, out var known)) return known;

        var packagePath = objectPath.Split('.')[0];
        var assetName = packagePath.Split('/').Last();
        var file = "FortniteGame/Content/" + packagePath["/Game/".Length..] + ".uasset";
        exportClass ??= provider.TryLoadPackage(file, out var package)
            ? package.GetExports().FirstOrDefault(e => e.Name.Equals(assetName, StringComparison.OrdinalIgnoreCase))?.ExportType
            : null;

        List<string> lineage = exportClass is null ? [] : ItemClasses.Lineage(exportClass).ToList();
        var candidates = rules
            .Select(rule => (rule, depth: rule.Directories.Where(d => packagePath.StartsWith(d, StringComparison.OrdinalIgnoreCase)).Select(d => d.Length).DefaultIfEmpty(-1).Max()))
            .Where(c => c.depth >= 0)
            .ToList();
        // The asset manager only registers assets whose class derives from the rule's base class.
        // Rules that share a base class (Token, DailyRewardScheduleToken) are told apart by the class name.
        var match = candidates
            .Where(c => lineage.Contains(c.rule.BaseClass))
            .OrderBy(c => lineage.IndexOf(c.rule.BaseClass))
            .ThenByDescending(c => exportClass == $"Fort{c.rule.Type}Definition" || exportClass == $"Fort{c.rule.Type}ItemDefinition")
            .ThenByDescending(c => c.depth)
            .Select(c => c.rule)
            .FirstOrDefault();
        if (match.Type is null && strict) return null;
        if (match.Type is null)
            match = candidates.OrderByDescending(c => c.depth).Select(c => c.rule).FirstOrDefault();
        if (match.Type is null)
            throw new InvalidOperationException($"No primary asset type for {objectPath} ({exportClass})");

        return cache[objectPath] = $"{match.Type}:{assetName.ToLowerInvariant()}";
    }
}
