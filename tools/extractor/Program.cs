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
    Console.Error.WriteLine("usage: extractor <build folder containing FortniteGame and Engine> <aes key> [output folder] [version]");
    return 1;
}

var buildRoot = args[0];
var aesKey = args[1].StartsWith("0x") ? args[1] : "0x" + args[1];
var output = args.Length > 2 ? args[2] : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "gamedata"));

// Engine/Build/Build.version, or for a build that ships without it (1.10, CL 3790078) the version the client's
// User-Agent gives, "4.19.0-3790078+++Fortnite+Release-Cert", as the fourth argument.
var versionFile = Path.Combine(buildRoot, "Engine", "Build", "Build.version");
JsonNode version;
if (File.Exists(versionFile)) version = JsonNode.Parse(File.ReadAllText(versionFile))!;
else if (args.Length > 3 && Regex.Match(args[3], @"^(\d+)\.(\d+)\.\d+-(\d+)\+(\+.+)$") is { Success: true } named)
{
    version = new JsonObject
    {
        ["MajorVersion"] = int.Parse(named.Groups[1].Value), ["MinorVersion"] = int.Parse(named.Groups[2].Value),
        ["Changelist"] = int.Parse(named.Groups[3].Value), ["BranchName"] = named.Groups[4].Value
    };
}
else
{
    Console.Error.WriteLine($"{versionFile} is missing: give the build's version (\"4.19.0-3790078+++Fortnite+Release-Cert\") as the fourth argument");
    return 1;
}
var engine = $"{version["MajorVersion"]}.{version["MinorVersion"]}";
var changelist = version["Changelist"]?.GetValue<int>() ?? 0;
var game = engine switch
{
    "4.16" => EGame.GAME_UE4_16,
    "4.19" => EGame.GAME_UE4_19,
    "4.20" => EGame.GAME_UE4_20,
    _ => throw new NotSupportedException($"Engine {engine} is not mapped yet")
};

var provider = new DefaultFileProvider(Path.Combine(buildRoot, "FortniteGame", "Content", "Paks"), SearchOption.TopDirectoryOnly,
    new VersionContainer(game), StringComparer.OrdinalIgnoreCase);
provider.Initialize();
provider.SubmitKeys([new KeyValuePair<FGuid, FAesKey>(new FGuid(), new FAesKey(aesKey))]);
provider.PostMount();

var assetTypes = new AssetTypes(provider);

var quests = new SortedDictionary<string, object>(StringComparer.Ordinal);
// Each quest's object path ("/Game/Quests/.../Name.Name"), as world info names quests (theater and region Requirements,
// tiles' LinkedQuests).
var questPaths = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("FortniteGame/Content/Quests/", StringComparison.OrdinalIgnoreCase)))
{
    foreach (var export in provider.LoadPackage(file).GetExports())
    {
        if (export.ExportType != "FortQuestItemDefinition") continue;
        var properties = JsonNode.Parse(JsonConvert.SerializeObject(export))!["Properties"] ?? new JsonObject();
        quests[export.Name.ToLowerInvariant()] = Quest(properties, assetTypes);
        questPaths[export.Name.ToLowerInvariant()] = "/Game/" + file.PathWithoutExtension["FortniteGame/Content/".Length..] + "." + export.Name;
    }
}

var items = new SortedDictionary<string, object>(StringComparer.Ordinal);
var transmogKeys = new SortedDictionary<string, object>(StringComparer.Ordinal);
var tables = new Dictionary<string, JsonObject>(StringComparer.OrdinalIgnoreCase);
JsonObject TableRows(JsonNode? table)
{
    var key = table?["ObjectPath"]?.GetValue<string>() ?? AssetPath(table);
    if (!tables.TryGetValue(key, out var rows)) tables[key] = rows = LoadRows(provider, table);
    return rows;
}

// GetMaxDurability: 1 without the stats row or its WeaponDurabilityRarity row (DurabilityRowName), else
// (max(0, Level - BaseLevel) x DurabilityScale + 1) x the row's column for the definition's rarity, truncated, and 1 if
// that is 0.
JsonNode? Row(JsonObject rows, string name) => rows.FirstOrDefault(r => r.Key.Equals(name, StringComparison.OrdinalIgnoreCase)).Value;
int MaxDurability(JsonNode? statHandle, string rarity, int level)
{
    if (statHandle?["DataTable"] is not JsonObject statTable || statHandle["RowName"]?.GetValue<string>() is not { } statRow || statRow == "None"
        || Row(TableRows(statTable), statRow) is not JsonObject stats) return 1;
    if (stats["Durability"] is not JsonObject durabilityTable || stats["DurabilityRowName"]?.GetValue<string>() is not { } durabilityRow || durabilityRow == "None"
        || Row(TableRows(durabilityTable), durabilityRow) is not JsonObject byRarity) return 1;
    var baseLevel = stats["BaseLevel"]?.GetValue<int>() ?? 0;
    var scale = stats["DurabilityScale"]?.GetValue<float>() ?? 0f;
    var max = (int)(((float)Math.Max(0, level - baseLevel) * scale + 1.0f) * (byRarity[rarity]?.GetValue<int>() ?? 1));
    return max == 0 ? 1 : max;
}

var expeditions = new SortedDictionary<string, object>(StringComparer.Ordinal);
var characters = new SortedDictionary<string, object>(StringComparer.Ordinal);
var cardPacks = new SortedDictionary<string, object>(StringComparer.Ordinal);
var unmapped = new SortedSet<string>(StringComparer.Ordinal);
var accountBuffEffects = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
var disintegrationItems = new SortedDictionary<string, (bool FromRecipe, int FabricationOverride)>(StringComparer.Ordinal);
var schematicRecipes = new Dictionary<string, (int Produced, List<(string TemplateId, int Count)> Costs)>(StringComparer.Ordinal);
var craftingRecipes = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && assetTypes.IsItemPath(f.Path)))
{
    var gamePath = "/Game/" + file.PathWithoutExtension["FortniteGame/Content/".Length..];
    var assetName = gamePath.Split('/').Last();
    if (!provider.TryLoadPackage(file, out var package)) continue;
    var export = package.GetExports().FirstOrDefault(e => e.Name.Equals(assetName, StringComparison.OrdinalIgnoreCase));
    if (export is null || export.ExportType == "FortQuestItemDefinition") continue;
    var profile = ItemClasses.ProfileType(export.ExportType, changelist);
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
        ["maxStackSize"] = properties?["MaxStackSize"]?.GetValue<int>() ?? ItemClasses.DefaultMaxStackSize(export.ExportType),
        // UFortItemDefinition's constructor leaves Rarity at Ordinary and Tier at No_Tier.
        ["rarity"] = Enum(properties?["Rarity"]) ?? "Ordinary",
        ["tier"] = Enum(properties?["Tier"]) ?? "No_Tier"
    };
    if (Strings(properties?["GameplayTags"]) is { Count: > 0 } itemTags) ((SortedDictionary<string, object>)items[templateId])["tags"] = itemTags;
    // bNeverPersisted: the world profile's save (ConstructBatchUpdate 0x6A9750) only adds items whose definition passes
    // 0x5C53E0 ((+0xF4 & 3) == 0: not bIsAccountItem, not bNeverPersisted), so MCP never holds one.
    if (profile == "theater" && (properties?["bNeverPersisted"]?.GetValue<bool>() ?? ItemClasses.NeverPersistedByDefault(export.ExportType)))
        ((SortedDictionary<string, object>)items[templateId])["neverPersisted"] = true;
    // bInventorySizeLimited: counts toward the account vault limit (account items) or the backpack limit (world items).
    if (properties?["bInventorySizeLimited"]?.GetValue<bool>() ?? ItemClasses.InventorySizeLimitedByDefault(export.ExportType))
        ((SortedDictionary<string, object>)items[templateId])["inventorySizeLimited"] = true;
    // The MCP template's static_max_durability (UFortWorldItemDefinition's template export sub_5FCE60 writes it when
    // bItemHasDurability is set): GetMaxDurability at level 0. Weapons, traps, the edit tool and building pieces
    // (UFortWeaponItemDefinition, sub_837C20) read it from their WeaponStatHandle row; gadgets have their own.
    if (profile == "theater" && ItemClasses.Lineage(export.ExportType).Contains("FortWeaponItemDefinition")
        && (properties?["bItemHasDurability"]?.GetValue<bool>() ?? true))
        ((SortedDictionary<string, object>)items[templateId])["maxDurability"] = MaxDurability(properties?["WeaponStatHandle"], (string)((SortedDictionary<string, object>)items[templateId])["rarity"], 0);
    // The in-game name (DisplayName), for the admin panel.
    if (properties?["DisplayName"]?["SourceString"]?.GetValue<string>() is { Length: > 0 } displayName)
        ((SortedDictionary<string, object>)items[templateId])["name"] = displayName;

    // Account buffs (UFortAccountBuffItemDefinition BuffEffects): the gameplay effects the buff puts on the homebase.
    if (export.ExportType == "FortAccountBuffItemDefinition")
        accountBuffEffects[templateId] = (properties?["BuffEffects"]?.AsArray() ?? []).Select(e => AssetPath(e)).ToList();

    // An item's power (RatingLookup into the BaseItemRating curves, by level): squads add these up for expeditions.
    if (properties?["RatingLookup"]?["RowName"]?.GetValue<string>() is { } ratingRow and not "None"
        && properties["RatingLookup"]?["CurveTable"]?["ObjectName"]?.GetValue<string>() == "CurveTable'BaseItemRating'")
        ((SortedDictionary<string, object>)items[templateId])["rating"] = ratingRow;

    // Expeditions (UFortExpeditionItemDefinition): how long they run and stay on offer, their power range, and the
    // ExpeditionRecipes row with their cost, reward and required vehicle tag.
    if (export.ExportType == "FortExpeditionItemDefinition")
    {
        expeditions[templateId] = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["durationMinutes"] = properties?["ExpeditionDuration_Minutes"]?.GetValue<double>() ?? 0,
            ["expirationMinutes"] = properties?["ExpeditionExpirationDuration_Minutes"]?.GetValue<double>() ?? 0,
            ["basePower"] = properties?["BaseTargetPowerRating"]?.GetValue<int>() ?? 0,
            ["tierFactor"] = properties?["TierFactor"]?.GetValue<int>() ?? 0,
            ["powerClamp"] = properties?["MaxTargetPowerClamp"]?.GetValue<int>() ?? 0,
            ["recipe"] = properties?["ExpeditionRules"]?["RowName"]?.GetValue<string>() ?? "",
            // The loot tier group Epic's server rolled the bonus criteria (expedition_criteria) from.
            ["criteriaTier"] = properties?["CriteriaRequirementsLootTier"]?.GetValue<string>() ?? "None"
        };
    }

    // Badges (UFortBadgeItemDefinition): what the MCP template says a badge earns (template export sub_5D1FD0):
    // static_cardpack_reward (BadgeCardPackReward) and static_item_rewards (ItemRewards, FFortItemQuantityPair
    // {ItemDefinition, Quantity}). The gameserver reports earned badges in EndPrimaryMission's earnedBadgeData.
    if (export.ExportType == "FortBadgeItemDefinition")
    {
        var badge = (SortedDictionary<string, object>)items[templateId];
        if (properties?["BadgeCardPackReward"] is { } packReward && AssetPath(packReward) is { Length: > 0 } packPath and not "None")
            badge["cardPackReward"] = assetTypes.TemplateId(ObjectPath(packPath));
        var itemRewards = (properties?["ItemRewards"] as JsonArray ?? []).OfType<JsonObject>()
            .Where(pair => pair["ItemDefinition"] is { } reward && AssetPath(reward) is { Length: > 0 } and not "None")
            .Select(pair => new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                ["templateId"] = assetTypes.TemplateId(ObjectPath(AssetPath(pair["ItemDefinition"]))),
                ["quantity"] = pair["Quantity"]?.GetValue<int>() ?? 0
            }).ToList();
        if (itemRewards.Count > 0) badge["itemRewards"] = itemRewards;
    }

    // Account items level up and are recycled and evolved (UFortAccountItemDefinition): the XPAccountItemLevels and
    // XPAccountItemRewards curve rows, the MetaRecipes rows, and MaxLevel (UFortItemDefinition).
    if (properties?["LevelToXpHandle"]?["RowName"]?.GetValue<string>() is { } levelRow)
    {
        var item = (SortedDictionary<string, object>)items[templateId];
        item["levelCost"] = levelRow;
        if (properties["LevelToSacrificeXpHandle"]?["RowName"]?.GetValue<string>() is { } recycleRow) item["recycleXp"] = recycleRow;
        if (properties["SacrificeRecipe"]?["RowName"]?.GetValue<string>() is { } recycleRecipe) item["recycleRecipe"] = recycleRecipe;
        var conversions = (properties["ConversionRecipes"] as JsonArray)?.Select(r => r?["RowName"]?.GetValue<string>()).OfType<string>().ToList() ?? [];
        // 1.10 (CL 3790078) clears the conversions of the heroes it retires to unset rows ("None").
        if (conversions.Any(row => row != "None")) item["conversions"] = conversions;
        // From 1.10 (CL 3790078), the MetaRecipes row that raises the item's rarity (UpgradeRarityRecipeHandle,
        // UFortAccountItemDefinition::GetUpgradeRarityRecipe; UpgradeItemRarity).
        if (properties["UpgradeRarityRecipeHandle"]?["RowName"]?.GetValue<string>() is { } rarityRow and not "None") item["rarityUpgrade"] = rarityRow;
        item["maxLevel"] = properties["MaxLevel"]?.GetValue<int>() ?? 1;
    }

    // What an item is worth when sacrificed in an item transform (TransmogSacrificeRow -> TransmogSacrificePoints).
    if (properties?["TransmogSacrificeRow"] is { } sacrifice && sacrifice["RowName"]?.GetValue<string>() is { } sacrificeRow and not "None"
        && TableRows(sacrifice["DataTable"])[sacrificeRow]?["TransmogSacrificePoints"]?.GetValue<int>() is { } sacrificePoints)
        ((SortedDictionary<string, object>)items[templateId])["transmogPoints"] = sacrificePoints;

    // Transform keys (UFortConversionControlItemDefinition): the ConversionControlCosts row (the resource it takes and,
    // per EFortRarity, the points needed and how much of that resource), the skill tree tags that unlock it without
    // owning one, whether a use consumes it (the property defaults to false), and its loot tier group.
    if (export.ExportType == "FortConversionControlItemDefinition" && properties?["ConversionPointsToTierCosts"] is { } costHandle)
    {
        var costs = TableRows(costHandle["DataTable"])[costHandle["RowName"]!.GetValue<string>()]!;
        string[] rarityNames = ["Handmade", "Ordinary", "Sturdy", "Quality", "Fine", "Elegant", "Masterwork", "Epic", "Badass", "Legendary"];
        transmogKeys[templateId] = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["requiredItem"] = costs["RequiredItem"] is { } required && AssetPath(required) is { Length: > 0 } requiredPath and not "None" ? assetTypes.TemplateId(requiredPath) : "",
            ["tiers"] = rarityNames.Select(rarity => new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                ["cost"] = costs[rarity]?["TierCost"]?.GetValue<int>() ?? -1,
                ["quantity"] = costs[rarity]?["RequiredItemQuantity"]?.GetValue<int>() ?? 0
            }).ToList(),
            ["catalysts"] = Strings(costs["RequiredCatalysts"]),
            ["consumed"] = properties["bConsumedOnConversion"]?.GetValue<bool>() ?? false,
            ["lootTierGroup"] = properties["LootTierGroup"]?.GetValue<string>() ?? ""
        };
    }

    // Quotas (UFortQuotaItemDefinition, Quota:RestXP): where the value starts, its cap, and how it refills.
    if (export.ExportType == "FortQuotaItemDefinition")
    {
        var item = (SortedDictionary<string, object>)items[templateId];
        item["startingValue"] = properties?["StartingValue"]?.GetValue<double>() ?? 0;
        item["maximumValue"] = properties?["MaximumValue"]?.GetValue<int>() ?? 0;
        item["rechargePerMinute"] = properties?["UnitsPerMinuteRechargeRate"]?.GetValue<double>() ?? 0;
        item["rechargeDelayMinutes"] = properties?["RechargeDelayMinutes"]?.GetValue<int>() ?? 0;
    }

    // Account consumables (UFortConsumableAccountItemDefinition, the XP boosts): who they can be used on.
    if (export.ExportType == "FortConsumableAccountItemDefinition")
    {
        var item = (SortedDictionary<string, object>)items[templateId];
        item["activateOnSelf"] = properties?["bCanActivateOnSelf"]?.GetValue<bool>() ?? true;
        item["activateOnOthers"] = properties?["bCanActivateOnOthers"]?.GetValue<bool>() ?? false;
    }

    // Storm shields and deployable bases (UFortCloudSaveItemDefinition): their level range and save ContentVersion.
    if (export.ExportType is "FortOutpostItemDefinition" or "FortDeployableBaseCloudSaveItemDefinition")
    {
        var item = (SortedDictionary<string, object>)items[templateId];
        item["minLevel"] = properties?["MinLevel"]?.GetValue<int>() ?? 1;
        item["maxLevel"] = properties?["MaxLevel"]?.GetValue<int>() ?? 1;
        item["contentVersion"] = properties?["ContentVersion"]?.GetValue<int>() ?? 0;
    }

    // Squad slots filter on these: TagFilter (defenders), bIsManager (survivor slot 0), RequiredGPTags (hero classes).
    if (export.ExportType is "FortHeroType" or "FortWorkerType" or "FortDefenderItemDefinition")
    {
        var character = new SortedDictionary<string, object>(StringComparer.Ordinal) { ["tags"] = Strings(properties?["GameplayTags"]) };
        var required = Strings(properties?["RequiredGPTags"]);
        if (required.Count > 0) character["requiredTags"] = required;
        if (properties?["bIsManager"]?.GetValue<bool>() == true) character["manager"] = true;
        // A hero's gender is its definition's (AFortPlayerState::SetHeroType sub_7B1BD0 takes HeroType->Gender). Only
        // the male heroes save it: UFortWorkerType's constructor (sub_5A62C0) makes Female the default.
        if (export.ExportType == "FortHeroType")
            character["gender"] = Enum(properties?["Gender"]) is { } heroGender and not "Invalid" ? heroGender : "Female";
        // Survivors (UFortWorkerType): what the definition fixes; the rest is rolled when one is granted.
        if (export.ExportType == "FortWorkerType")
        {
            if (Enum(properties?["Gender"]) is { } gender and not "Invalid") character["gender"] = gender;
            if (properties?["FixedPortrait"] is { } portrait && AssetPath(portrait) is { Length: > 0 } portraitPath and not "None") character["portrait"] = ObjectPath(portraitPath);
            if (Strings(properties?["FixedPersonalityTag"]) is [var personality, ..]) character["personality"] = personality;
            if (Strings(properties?["FixedSetBonusTag"]) is [var setBonus, ..]) character["setBonus"] = setBonus;
            if (Strings(properties?["ManagerSynergyTag"]) is [var synergy, ..]) character["managerSynergy"] = synergy;
        }
        characters[templateId] = character;
    }

    // The storm shield fabricator (UFortWorldItemDefinition): bHasDisintegrationValue, bUsesCraftingRecipeToGetDisintegrationValue
    // (class constructor defaults in ItemClasses) and FabricationValueOverride (-1, sub_5DB330). A recipe-valued item takes
    // its value from the schematic that makes it (Result, QuantityProduced 1 by default, and the CraftingRequirements row's
    // Requirements, which UFortSchematicItemDefinition::GetRequirements sub_5EB780 reads).
    if (profile == "theater" && (properties?["bHasDisintegrationValue"]?.GetValue<bool>() ?? ItemClasses.HasDisintegrationValue(export.ExportType)))
        disintegrationItems[templateId] = (properties?["bUsesCraftingRecipeToGetDisintegrationValue"]?.GetValue<bool>() ?? ItemClasses.UsesCraftingRecipeForDisintegration(export.ExportType),
            properties?["FabricationValueOverride"]?.GetValue<int>() ?? -1);
    // Recycling a world item in the backpack (UFortWorldItemDefinition::GetDisassemblyResults, 1.11 sub_6D8910): its
    // DisassembleRecipe row (DisassembleRecipes) and the share of the recipe's results it gives back at no and at full
    // durability, DisassembleDurabilityDegradeMin/MaxLootPercent (the class constructor's 0.2 and 0.8, sub_6CB730).
    if (profile == "theater" && properties?["DisassembleRecipe"]?["RowName"]?.GetValue<string>() is { } disassembleRow and not "None")
    {
        var item = (SortedDictionary<string, object>)items[templateId];
        item["disassembleRecipe"] = disassembleRow;
        item["disassembleLootPercent"] = new List<double>
        {
            Math.Round(properties["DisassembleDurabilityDegradeMinLootPercent"]?.GetValue<double>() ?? 0.2, 6),
            Math.Round(properties["DisassembleDurabilityDegradeMaxLootPercent"]?.GetValue<double>() ?? 0.8, 6)
        };
    }
    if (export.ExportType == "FortSchematicItemDefinition" && properties?["Result"] is { } schematicResult
        && AssetPath(schematicResult) is { Length: > 0 } resultPath and not "None"
        && properties["CraftingRequirements"] is { } craftingRequirements && craftingRequirements["RowName"]?.GetValue<string>() is { } craftingRow and not "None"
        && TableRows(craftingRequirements["DataTable"])[craftingRow] is { } craftingRequirementsRow)
        schematicRecipes.TryAdd(assetTypes.TemplateId(resultPath), (properties["QuantityProduced"]?.GetValue<int>() ?? 1,
            (craftingRequirementsRow["Requirements"]?.AsArray() ?? []).Select(r => (assetTypes.TemplateId(GamePath(r!["ItemDefinition"]!["ObjectPath"]!.GetValue<string>())), r["Count"]?.GetValue<int>() ?? 0)).ToList()));
    // Later schematics name a CraftingRecipe row (CraftingRecipes_New, FRecipe): what crafting one costs and makes
    // (UFortSchematicItemDefinition::GetRecipe, GetResultWorldItemDefinition, GetQuantityProduced), as the Save the
    // World backpack's CraftWorldItem crafts it from 1.11 (CL 3807424). upgrades.json holds the rows as craftingRecipes.
    if (export.ExportType == "FortSchematicItemDefinition" && properties?["CraftingRecipe"] is { } craftingRecipe
        && craftingRecipe["RowName"]?.GetValue<string>() is { } recipeRow and not "None"
        && TableRows(craftingRecipe["DataTable"])[recipeRow] is { } craftingRecipeRow)
    {
        ((SortedDictionary<string, object>)items[templateId])["craftingRecipe"] = recipeRow;
        craftingRecipes.TryAdd(recipeRow, new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["costs"] = Items(craftingRecipeRow["RecipeCosts"], assetTypes),
            ["results"] = Items(craftingRecipeRow["RecipeResults"], assetTypes),
            ["catalysts"] = Strings(craftingRecipeRow["RequiredCatalysts"])
        });
    }

    if (export.ExportType == "FortCardPackItemDefinition")
    {
        cardPacks[templateId] = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["lootTierGroup"] = properties?["LootTierGroup"]?.GetValue<string>() ?? "",
            ["lootTier"] = properties?["LootTier"]?.GetValue<int>() ?? 0,
            ["choice"] = properties?["bIsChoicePack"]?.GetValue<bool>() ?? false,
            ["displayRarityLevel"] = properties?["DisplayRarityLevel"]?.GetValue<int>() ?? 0,
            ["rarity"] = Enum(properties?["Rarity"]) ?? "Ordinary",
            ["displayName"] = properties?["DisplayName"]?["SourceString"]?.GetValue<string>() ?? "",
            ["description"] = properties?["Description"]?["SourceString"]?.GetValue<string>() ?? "",
            // The store's offer metadata names the pack by asset (FortCatalogMeta.PackDefinition).
            ["path"] = $"{gamePath}.{export.Name}",
            // UFortCardPackItemDefinition's constructor sets bAutoOpenAsReward (sub_5A4290); only
            // CardPack_Bronze_Reward turns it off.
            ["autoOpenAsReward"] = properties?["bAutoOpenAsReward"]?.GetValue<bool>() ?? true
        };
    }
}

// The fabricator's goo values, as Epic's MCP had them in each world item template (UFortWorldItemDefinition's template export,
// sub_5FCE60): static_disintegration_value is the OutpostFabricatorData row (FortOutpostData::GetDisintegrationValueFromFabricatorData,
// sub_55CA90) or, for recipe items, the schematic's ingredients' values times their counts over QuantityProduced
// (CalculateDisintegrationValueFromRecipe, sub_5DE470); static_fabrication_value is FabricationValueOverride when it is set,
// else DisintegrationToFabricationRatio times the disintegration value. The fabricator's own numbers come from OutpostData's
// FabricatorBuildingData, whose constructor defaults (UFortOutpostData sub_54DDF0) are FabricationDuration 1,
// DisintegrationToFabricationRatio 3 and QuantumGooProductionTime 10.
var outpostData = LoadExport(provider, JsonValue.Create("/Game/TheOutpost/OutpostData.OutpostData"), "FortOutpostData")["Properties"]!;
var fabricatorData = outpostData["FabricatorData"]!;
var fabricationRatio = fabricatorData["DisintegrationToFabricationRatio"]?.GetValue<int>() ?? 3;
var tableValues = new Dictionary<string, int>(StringComparer.Ordinal);
foreach (var (_, row) in LoadRows(provider, fabricatorData["DefaultIngredientDisintergrationData"]))
{
    if (row?["ItemDefinition"] is { } rowItem && AssetPath(rowItem) is { Length: > 0 } rowPath and not "None")
        tableValues.TryAdd(assetTypes.TemplateId(rowPath), row["DisintegrationValue"]?.GetValue<int>() ?? 0);
}
var disintegrationValues = new Dictionary<string, int>(StringComparer.Ordinal);
int DisintegrationValue(string templateId, int depth)
{
    if (!disintegrationItems.TryGetValue(templateId, out var flags) || depth > 16) return 0;
    if (disintegrationValues.TryGetValue(templateId, out var known)) return known;
    var value = 0;
    if (!flags.FromRecipe) value = tableValues.GetValueOrDefault(templateId);
    else if (schematicRecipes.TryGetValue(templateId, out var recipe))
    {
        value = recipe.Costs.Sum(cost => cost.Count * DisintegrationValue(cost.TemplateId, depth + 1));
        if (recipe.Produced > 0) value /= recipe.Produced;
    }
    return disintegrationValues[templateId] = value;
}
var fabricatorValues = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (templateId, flags) in disintegrationItems)
{
    var disintegration = DisintegrationValue(templateId, 0);
    fabricatorValues[templateId] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["disintegration"] = disintegration,
        ["fabrication"] = flags.FabricationOverride >= 0 ? flags.FabricationOverride : fabricationRatio * disintegration
    };
}
string OutpostTemplateId(JsonNode? definition) => $"Outpost:{AssetName(AssetPath(definition)).ToLowerInvariant()}";
var fabricator = new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["fabricatorTemplateId"] = OutpostTemplateId(fabricatorData["ItemDefinition"]),
    ["postTemplateId"] = OutpostTemplateId(outpostData["OutpostUpgradeAndPrestigeData"]?["ItemDefinition"]),
    ["fabricationDuration"] = fabricatorData["FabricationDuration"]?.GetValue<double>() ?? 1,
    ["fabricationRatio"] = fabricationRatio,
    ["quantumGooProductionTime"] = fabricatorData["QuantumGooProductionTime"]?.GetValue<int>() ?? 10,
    ["quantumGooCapacityPerLevel"] = (fabricatorData["QuantumGooCapacityPerLevel"] as JsonArray)?.Select(v => v!.GetValue<int>()).ToList() ?? [],
    ["alwaysAvailable"] = (fabricatorData["AlwaysAvailableFabricationItems"] as JsonArray)?.Select(v => assetTypes.TemplateId(AssetPath(v))).Distinct().ToList() ?? [],
    ["values"] = fabricatorValues
};

// The client calls the schedule without a token "Default" and looks rows up by the name "%d".
var dailyRewards = new List<SortedDictionary<string, object>>();
if (!provider.TryLoadPackage("FortniteGame/Content/Balance/DefaultGameData.uasset", out var gameDataPackage))
    throw new InvalidOperationException("DefaultGameData not found");
var gameData = JsonNode.Parse(JsonConvert.SerializeObject(gameDataPackage.GetExports().First(e => e.ExportType == "FortGameData")))!;
// DefaultGameData holds the schedules up to 1.2; 1.7.2 moved them to their own asset
// (Balance/DailyRewardScheduleDefinitions, UFortDailyRewardScheduleDefinitions Schedules), which also names each one.
var scheduleSource = gameData["Properties"]?["DailyRewardSchedules"];
var schedules = scheduleSource is JsonObject
    ? LoadExport(provider, scheduleSource, "FortDailyRewardScheduleDefinitions")["Properties"]?["Schedules"]?.AsArray()
    : scheduleSource?.AsArray();
foreach (var schedule in schedules ?? [])
{
    var tokenPath = schedule!["EnablingToken"] is null ? "" : AssetPath(schedule["EnablingToken"]);
    var tablePath = schedule["Rewards"]!["ObjectPath"]!.GetValue<string>().Split('.')[0];
    if (!provider.TryLoadPackage(tablePath + ".uasset", out var tablePackage)) throw new InvalidOperationException($"{tablePath} not found");
    var rows = JsonNode.Parse(JsonConvert.SerializeObject(tablePackage.GetExports().First(e => e.ExportType == "DataTable")))!["Rows"]!.AsObject();
    if (!rows.Select(r => r.Key).OrderBy(int.Parse).SequenceEqual(Enumerable.Range(0, rows.Count).Select(i => i.ToString())))
        throw new InvalidOperationException($"{tablePath} rows are not named 0..{rows.Count - 1}");

    var entry = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["name"] = tokenPath is "" or "None" ? "Default" : AssetName(tokenPath),
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

// The hero a new account starts with (UFortGameData DefaultHero: HID_Commando_GrenadeGun_UC_T01, DefaultHeroName
// "Ramirez").
var newAccount = new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["defaultHero"] = assetTypes.TemplateId(AssetPath(gameData["Properties"]!["DefaultHero"]))
};

// Survivor personalities (with each gender's portraits) and set bonuses, from MyFortData (Balance/HomebaseData,
// UMyTownData): what a new survivor is rolled from.
var townData = LoadExport(provider, gameData["Properties"]!["MyFortData"], "MyTownData")["Properties"]!;
var workerData = new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["personalities"] = (townData["WorkerPersonalities"]?.AsArray() ?? []).Select(entry => new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["tag"] = Strings(entry!["PersonalityTypeTag"]).FirstOrDefault() ?? "",
        ["weight"] = entry["SelectionWeight"]?.GetValue<double>() ?? 1,
        ["genders"] = (entry["GenderData"]?.AsArray() ?? []).Select(gender => new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["gender"] = Enum(gender!["Gender"]) ?? "",
            ["weight"] = gender["SelectionWeight"]?.GetValue<double>() ?? 1,
            ["portraits"] = (gender["PotraitData"]?.AsArray() ?? []).Select(portrait => new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                ["portrait"] = ObjectPath(AssetPath(portrait!["Portrait"])),
                ["weight"] = portrait["SelectionWeight"]?.GetValue<double>() ?? 1
            }).ToList()
        }).ToList()
    }).ToList(),
    ["setBonuses"] = (townData["WorkerSetBonuses"]?.AsArray() ?? []).Select(entry => new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["tag"] = Strings(entry!["SetBonusTypeTag"]).FirstOrDefault() ?? "",
        ["weight"] = entry["SelectionWeight"]?.GetValue<double>() ?? 1,
        ["name"] = entry["DisplayName"]?["SourceString"]?.GetValue<string>() ?? "",
        ["requiredWorkers"] = entry["RequiredWorkersCount"]?.GetValue<int>() ?? 0
    }).ToList()
};

// The skill tree and squads come from the homebase manager DefaultGameData points at.
var manager = LoadExport(provider, gameData["Properties"]!["HomebaseManager"], "FortHomebaseManager")["Properties"]!;

// Banners: the editor lists the profile0 items HomebaseBannerIcon:<row> and HomebaseBannerColor:<row> the player owns
// (UFortBannerUtilities::GetBannerIconsForCategory), by the rows' categories. 2.4.2 (CL 3870737) moved the tables from
// the homebase manager (HomebaseBannerIconData, HomebaseBannerColorData) to DefaultGameData (UFortGameData
// BannerIconData, BannerColorData).
SortedDictionary<string, string> BannerRows(JsonObject rows) =>
    new(rows.ToDictionary(r => r.Key, r => r.Value!["CategoryRowName"]?.GetValue<string>() ?? ""), StringComparer.Ordinal);
var banners = new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["icons"] = BannerRows(LoadRows(provider, manager["HomebaseBannerIconData"] ?? gameData["Properties"]!["BannerIconData"])),
    ["colors"] = BannerRows(LoadRows(provider, manager["HomebaseBannerColorData"] ?? gameData["Properties"]!["BannerColorData"]))
};
var nodes = new SortedDictionary<string, object>(StringComparer.Ordinal);
// What a node unlocks are the gameplay tags its effect rows grant (HomebaseNodeGameplayEffectDataTable
// GrantedTagsContainer): Unlocks.Class.*, Unlocks.Recycler.*, Evolution.*, Expedition.* and so on.
var nodeEffects = LoadRows(provider, manager["HomebaseNodeGameplayEffectDataTable"]);
foreach (var (id, row) in LoadRows(provider, manager["HomebaseNodeDataTable"]))
{
    var node = new SortedDictionary<string, object>(StringComparer.Ordinal);
    var grantedTags = Strings(row!["GameplayEffectRowNames"])
        .SelectMany(effect => Strings(nodeEffects[effect]?["GrantedTagsContainer"]))
        .Distinct(StringComparer.Ordinal).OrderBy(tag => tag, StringComparer.Ordinal).ToList();
    if (grantedTags.Count > 0) node["tags"] = grantedTags;
    var cost = (row["Cost"]?.AsArray() ?? []).Select(c => new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["templateId"] = assetTypes.TemplateId(AssetPath(c!["ItemDefinition"])),
        ["quantity"] = c["Quantity"]?.GetValue<int>() ?? 0
    }).ToList();
    if (cost.Count > 0) node["cost"] = cost;
    var prerequisites = (row["OR_Prerequisites"]?.AsArray() ?? []).Select(group => (group!["AND_Prerequisites"]?.AsArray() ?? []).Select(a =>
    {
        var nodeId = a!["NodeInstanceId"]?.GetValue<string>() ?? "None";
        return nodeId != "None"
            ? new SortedDictionary<string, object>(StringComparer.Ordinal) { ["node"] = nodeId }
            : new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                ["page"] = a["PrereqPageId"]?.GetValue<string>() ?? "None",
                ["nodeType"] = Enum(a["PrereqNodeType"]) ?? "Invalid",
                ["min"] = a["MinOwnedNodesRequiredFromPrereqPage"]?.GetValue<int>() ?? 0
            };
    }).ToList()).ToList();
    if (prerequisites.Count > 0) node["prerequisites"] = prerequisites;
    var questRequirements = (row["QuestTemplateRequirements"]?.AsArray() ?? []).Select(q => AssetName(AssetPath(q)).ToLowerInvariant()).ToList();
    if (questRequirements.Count > 0) node["quests"] = questRequirements;
    var squadSlots = (row["UnlockedSquadSlots"]?.AsArray() ?? []).Select(slot => new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["squadId"] = slot!["SquadId"]!.GetValue<string>(),
        ["slot"] = slot["SquadSlotIndex"]?.GetValue<int>() ?? 0
    }).ToList();
    if (squadSlots.Count > 0) node["squadSlots"] = squadSlots;
    nodes[id] = node;
}
var pages = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, manager["HomebaseNodePageDataTable"])) pages[id] = Strings(row!["NodeList"]);

// Research points come from a resource collector (UFortCollectedResourceItem, profile0 CollectedResource:<X>). The
// client's rate and capacity for it are the homebase attributes rate_per_second_collector_<X> and
// max_capacity_collector_<X> (UHomeBaseContext::GetResourceCollectorRateInfo, sub_5C03D0: <X> is the collector's
// template id after the ':'), and the research wallet's cap is ResearchPointMaxBonus (WarehouseCollectorSubWidget
// enables Collect only below it). All three are FortHomebaseSet attributes that skill tree nodes raise through their
// effect rows (Additive), and the VIP account buff doubles the rate (Buff_DoubleResearchPointRate, Multiplicitive).
const string ratePrefix = "rate_per_second_collector_", capacityPrefix = "max_capacity_collector_", walletAttribute = "ResearchPointMaxBonus";
static bool ResearchAttribute(string attribute) => attribute.StartsWith(ratePrefix) || attribute.StartsWith(capacityPrefix) || attribute == walletAttribute;
var researchNodes = new SortedDictionary<string, SortedDictionary<string, double>>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, manager["HomebaseNodeDataTable"]))
{
    foreach (var effect in Strings(row!["GameplayEffectRowNames"]))
    {
        var modifier = nodeEffects[effect];
        var attribute = modifier?["Attribute"]?["AttributeName"]?.GetValue<string>() ?? "";
        if (!ResearchAttribute(attribute)) continue;
        if (Enum(modifier!["Operation"]) != "Additive") throw new InvalidOperationException($"{effect} is not additive");
        var sums = researchNodes.TryGetValue(id, out var existing) ? existing : researchNodes[id] = new(StringComparer.Ordinal);
        sums[attribute] = (sums.TryGetValue(attribute, out var sum) ? sum : 0) + modifier["Magnitude"]!.GetValue<double>();
    }
}
// The item limits (UFortHomebaseManager's FortHomebaseSet attributes, raised by skill tree node effect rows): the account
// vault's InventorySizeBonus (UFortInventoryContext GetVaultItemLimit, sub_2BEF5B0: the attribute plus the account
// inventory bonus tokens), the backpack's WorldInventorySizeBonus and the storage vault's StorageInventorySizeBonus.
string[] inventoryAttributes = ["InventorySizeBonus", "WorldInventorySizeBonus", "StorageInventorySizeBonus"];
var inventoryNodes = new SortedDictionary<string, SortedDictionary<string, double>>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, manager["HomebaseNodeDataTable"]))
{
    foreach (var effect in Strings(row!["GameplayEffectRowNames"]))
    {
        var modifier = nodeEffects[effect];
        var attribute = modifier?["Attribute"]?["AttributeName"]?.GetValue<string>() ?? "";
        if (!inventoryAttributes.Contains(attribute)) continue;
        if (Enum(modifier!["Operation"]) != "Additive") throw new InvalidOperationException($"{effect} is not additive");
        var sums = inventoryNodes.TryGetValue(id, out var existing) ? existing : inventoryNodes[id] = new(StringComparer.Ordinal);
        sums[attribute] = (sums.TryGetValue(attribute, out var sum) ? sum : 0) + modifier["Magnitude"]!.GetValue<double>();
    }
}
// Account buffs that raise them (BuffEffects modifiers, Additive), e.g. Buff_World_Inventory_20.
var inventoryBuffs = new SortedDictionary<string, SortedDictionary<string, double>>(StringComparer.Ordinal);
foreach (var (buff, effects) in accountBuffEffects)
{
    foreach (var effect in effects)
    {
        if (!provider.TryLoadPackage(PackageFile(JsonValue.Create(effect)), out var package)) continue;
        var defaults = JsonNode.Parse(JsonConvert.SerializeObject(package.GetExports().First(e => e.Name.StartsWith("Default__"))))!["Properties"];
        foreach (var modifier in defaults?["Modifiers"]?.AsArray() ?? [])
        {
            var attribute = modifier!["Attribute"]?["AttributeName"]?.GetValue<string>() ?? "";
            if (!inventoryAttributes.Contains(attribute)) continue;
            if (Enum(modifier["ModifierOp"]) is not (null or "Additive")) throw new InvalidOperationException($"{effect} is not additive");
            var sums = inventoryBuffs.TryGetValue(buff, out var existing) ? existing : inventoryBuffs[buff] = new(StringComparer.Ordinal);
            sums[attribute] = (sums.TryGetValue(attribute, out var sum) ? sum : 0) + modifier["ModifierMagnitude"]!["ScalableFloatMagnitude"]!["Value"]!.GetValue<double>();
        }
    }
}
var researchBuffs = new SortedDictionary<string, SortedDictionary<string, double>>(StringComparer.Ordinal);
foreach (var (buff, effects) in accountBuffEffects)
{
    foreach (var effect in effects)
    {
        if (!provider.TryLoadPackage(PackageFile(JsonValue.Create(effect)), out var package)) continue;
        var defaults = JsonNode.Parse(JsonConvert.SerializeObject(package.GetExports().First(e => e.Name.StartsWith("Default__"))))!["Properties"];
        foreach (var modifier in defaults?["Modifiers"]?.AsArray() ?? [])
        {
            var attribute = modifier!["Attribute"]?["AttributeName"]?.GetValue<string>() ?? "";
            if (!ResearchAttribute(attribute)) continue;
            if (Enum(modifier["ModifierOp"]) != "Multiplicitive") throw new InvalidOperationException($"{effect} is not multiplicative");
            var factors = researchBuffs.TryGetValue(buff, out var existing) ? existing : researchBuffs[buff] = new(StringComparer.Ordinal);
            factors[attribute] = modifier["ModifierMagnitude"]!["ScalableFloatMagnitude"]!["Value"]!.GetValue<double>();
        }
    }
}
// Each collector the rate attributes name. Its payout is <X> with its first '_' back to ':' (the attributes spell the
// payout's template id that way: Token_collectionresource_nodegatetoken01); the wallet cap is the research one when
// the payout is the research point token (UFortHomebaseManager ResearchPointItemDefinition).
var collectors = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var name in researchNodes.Values.SelectMany(sums => sums.Keys).Where(a => a.StartsWith(ratePrefix)).Distinct())
{
    var suffix = name[ratePrefix.Length..];
    var payout = suffix[..suffix.IndexOf('_')] + ":" + suffix[(suffix.IndexOf('_') + 1)..];
    var collector = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["payout"] = payout, ["rateAttribute"] = name, ["capacityAttribute"] = capacityPrefix + suffix
    };
    if (payout.Equals("Token:collectionresource_nodegatetoken01", StringComparison.OrdinalIgnoreCase)) collector["walletAttribute"] = walletAttribute;
    collectors[$"CollectedResource:{suffix}"] = collector;
}

var squads = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, manager["HomebaseSquadDataTable"]))
{
    squads[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["type"] = Enum(row!["SquadType"]) ?? "",
        ["slots"] = (row["CrewSlots"]?.AsArray() ?? []).Select(slot => new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["types"] = Strings(slot!["ValidSlottableItemTypes"]).Select(t => t.Split("::").Last()).ToList(),
            ["tags"] = Strings(slot["TagFilter"])
        }).ToList()
    };
}

// Objective stat rows ({type, targetTags, condition, templateId, sourceTags, contextTags}) by row name.
SortedDictionary<string, object> ObjectiveStatRows(string table)
{
    var stats = new SortedDictionary<string, object>(StringComparer.Ordinal);
    foreach (var (id, row) in LoadRows(provider, JsonValue.Create(table)))
    {
        var stat = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["type"] = Enum(row!["Type"]) ?? "",
            ["targetTags"] = row["TargetTags"]?.GetValue<string>() ?? "",
            ["condition"] = row["Condition"]?.GetValue<string>() ?? "",
            ["templateId"] = row["TemplateId"]?.GetValue<string>() ?? ""
        };
        // Who did it (Class.IsCommando, Stat.Source.OnCriticalMission) and where (Stat.Theater.PvE02), when the row says.
        if (row["SourceTags"]?.GetValue<string>().Trim() is { Length: > 0 } sourceTags) stat["sourceTags"] = sourceTags;
        if (row["ContextTags"]?.GetValue<string>().Trim() is { Length: > 0 } contextTags) stat["contextTags"] = contextTags;
        stats[id.ToLowerInvariant()] = stat;
    }
    return stats;
}
var objectiveStats = ObjectiveStatRows("/Game/Quests/ObjectiveStatTable.ObjectiveStatTable");
// 3.0 (CL 3901517) adds Battle Royale's own table, Athena/Items/Quests/AthenaObjectiveStatTable, which its challenge
// bundles' quests count most of their objectives by (land_location_*, damage_athena_player_*, visit_location_*).
var athenaObjectiveStats = provider.Files.ContainsKey("FortniteGame/Content/Athena/Items/Quests/AthenaObjectiveStatTable.uasset")
    ? ObjectiveStatRows("/Game/Athena/Items/Quests/AthenaObjectiveStatTable.AthenaObjectiveStatTable") : [];

// Pieces a theater is built from: zone themes (map tiles), mission generators and mission difficulty rows.
var zoneThemes = new SortedDictionary<string, object>(StringComparer.Ordinal);
var missionGenerators = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" &&
    (f.Path.StartsWith("FortniteGame/Content/World/ZoneThemes/", StringComparison.OrdinalIgnoreCase) ||
     f.Path.StartsWith("FortniteGame/Content/World/MissionGens/", StringComparison.OrdinalIgnoreCase))))
{
    if (!provider.TryLoadPackage(file, out var package)) continue;
    var exports = package.GetExports().ToList();
    var generated = exports.FirstOrDefault(e => e.ExportType == "BlueprintGeneratedClass");
    var defaults = exports.FirstOrDefault(e => e.Name.StartsWith("Default__"));
    if (generated is null || defaults is null) continue;
    var classPath = "/Game/" + file.PathWithoutExtension["FortniteGame/Content/".Length..] + "." + generated.Name;
    var props = JsonNode.Parse(JsonConvert.SerializeObject(defaults))!["Properties"] ?? new JsonObject();
    var parent = JsonNode.Parse(JsonConvert.SerializeObject(generated))!["SuperStruct"]?["ObjectName"]?.GetValue<string>() ?? "";
    parent = parent.Split('\'').ElementAtOrDefault(1) ?? "";

    if (file.Path.Contains("/ZoneThemes/", StringComparison.OrdinalIgnoreCase))
    {
        if (!generated.Name.StartsWith("BP_ZT_", StringComparison.OrdinalIgnoreCase)) continue;
        var theme = new SortedDictionary<string, object>(StringComparer.Ordinal) { ["parent"] = parent };
        if (props["TheaterMapTileClass"] is { } tile) theme["tileClass"] = AssetPath(tile).Split('.')[0]; // the package, as for primaryMission below
        if (props["ZoneName"]?["SourceString"]?.GetValue<string>() is { } zoneName) theme["name"] = zoneName;
        var validDifficulties = (props["DifficultyProperties"]?.AsArray() ?? [])
            .SelectMany(d => d!["ValidDifficulties"]?.AsArray() ?? [])
            .Select(d => d!["RowName"]!.GetValue<string>())
            .Distinct().ToList();
        if (validDifficulties.Count > 0) theme["difficulties"] = validDifficulties;
        var zoneTags = Strings(props["ZoneTags"]);
        if (zoneTags.Count > 0) theme["tags"] = zoneTags;
        // Storm shields: the outpost item a player needs to enter (UFortMatchmakingContext::EnterOutpost).
        if (props["CloudSaveItemDefinition"] is { } cloudSave) theme["cloudSaveItem"] = assetTypes.TemplateId(AssetPath(cloudSave));
        zoneThemes[classPath] = theme;
    }
    else
    {
        var generator = new SortedDictionary<string, object>(StringComparer.Ordinal) { ["parent"] = parent };
        // The mission's package: 4.16 gives the soft reference without its object name, 4.19 (1.10) with it.
        if (props["PrimaryMissionInfo"] is { } primary) generator["primaryMission"] = AssetPath(primary).Split('.')[0];
        missionGenerators[classPath] = generator;
    }
}

// The primary missions the generators run, with their MissionTags: the Stat.Mission.Primary.* tags that quest objectives
// (ObjectiveStatTable TargetTags) count a won mission by.
var primaryMissions = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var missionPath in missionGenerators.Values.Cast<SortedDictionary<string, object>>()
    .Select(generator => generator.TryGetValue("primaryMission", out var primary) ? primary as string : null)
    .OfType<string>().Distinct())
{
    var packagePath = "FortniteGame/Content/" + missionPath["/Game/".Length..].Split('.')[0] + ".uasset";
    if (!provider.TryLoadPackage(packagePath, out var missionPackage)) continue;
    var info = missionPackage.GetExports().FirstOrDefault(e => e.ExportType == "FortMissionInfo");
    if (info is null) continue;
    var infoProps = JsonNode.Parse(JsonConvert.SerializeObject(info))!["Properties"] ?? new JsonObject();
    primaryMissions[missionPath] = new SortedDictionary<string, object>(StringComparer.Ordinal) { ["tags"] = Strings(infoProps["MissionTags"]) };
}

// The world map: theaters sit on sockets of the globe mesh and spawn a pin class there.
var mapPins = provider.Files.Values
    .Where(f => f.Extension == "uasset" && f.Path.StartsWith("FortniteGame/Content/Environments/WorldMap/Blueprints/WM_Pin", StringComparison.OrdinalIgnoreCase))
    .Select(f => provider.TryLoadPackage(f, out var package)
        ? package.GetExports().Where(e => e.ExportType == "BlueprintGeneratedClass").Select(e => "/Game/" + f.PathWithoutExtension["FortniteGame/Content/".Length..] + "." + e.Name).FirstOrDefault()
        : null)
    .OfType<string>().OrderBy(path => path, StringComparer.Ordinal).ToList();
var globeSockets = new List<string>();
if (provider.TryLoadPackage("FortniteGame/Content/Environments/WorldMap/Meshes/WM_Globe.uasset", out var globe))
{
    globeSockets = globe.GetExports().Where(e => e.ExportType == "StaticMeshSocket")
        .Select(e => JsonNode.Parse(JsonConvert.SerializeObject(e))!["Properties"]?["SocketName"]?.GetValue<string>())
        .OfType<string>().OrderBy(name => name, StringComparer.Ordinal).ToList();
}

var difficulties = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, JsonValue.Create("/Game/Balance/DataTables/GameDifficultyGrowthBounds.GameDifficultyGrowthBounds")))
{
    difficulties[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["difficulty"] = row!["Difficulty"]?.GetValue<double>() ?? 0,
        ["recommendedRating"] = row["RecommendedRating"]?.GetValue<int>() ?? 0,
        ["lootTierGroup"] = row["LootTierGroup"]?.GetValue<string>() ?? "",
        ["threat"] = row["ThreatDisplayName"]?["SourceString"]?.GetValue<string>() ?? ""
    };
}

// Mission alerts (DefaultGameData MissionAlerts and DailyMissionAlertQuota): which tile difficulties an alert can sit
// on, the loot tier group its rewards come from, its category (a MissionAlertCategories row: the map's storm swirl is
// for Storm and StormLow), the event flag it waits for, whether it only spreads storms, and its modifiers' tier group.
// The client counts the quota as the claim times over 24 hours old.
var missionAlerts = LoadRows(provider, gameData["Properties"]!["MissionAlerts"]).Select(entry => new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["name"] = entry.Key,
    ["category"] = entry.Value!["CategoryRowName"]?.GetValue<string>() ?? "",
    ["requiredEventFlag"] = entry.Value["RequiredEventFlag"]?.GetValue<string>() ?? "",
    ["onlyUsedForSpreading"] = entry.Value["bOnlyUsedForSpreading"]?.GetValue<bool>() ?? false,
    ["modifierTierGroup"] = entry.Value["ModifierTierGroup"]?.GetValue<string>() ?? "",
    ["minimumDifficulty"] = entry.Value["MinimumTileDifficulty"]?.GetValue<int>() ?? 0,
    ["maximumDifficulty"] = entry.Value["MaximumTileDifficulty"]?.GetValue<int>() ?? 0,
    ["zoneThemes"] = (entry.Value["AllowedZoneThemes"]?.AsArray() ?? []).Select(AssetPath).ToList(),
    ["missionGenerator"] = entry.Value["MissionGenerator"] is { } generator ? AssetPath(generator) : "",
    ["lootTierGroup"] = entry.Value["LootTierGroup"]?.GetValue<string>() ?? "",
    ["lootTier"] = entry.Value["LootTier"]?.GetValue<int>() ?? 0,
    ["spreadRowName"] = entry.Value["SpreadRowName"]?.GetValue<string>() is { } spread && spread != "None" ? spread : ""
}).ToList();
var dailyMissionAlertQuota = gameData["Properties"]?["DailyMissionAlertQuota"]?.GetValue<int>() ?? 0;
// From 1.7.2, MissionAlertCategories rows (FortMissionAlertCategoryData): the EFortMissionAlertCategory each category
// is, its daily quota (the profile's mission_alert_redemption_record keeps one claim slot per quota for each category)
// and whether an alert of it can be done again. MissionAlertSpreadDatas: how a storm alert spreads to nearby tiles.
// 2.2 (CL 3841827) drops the enum: its rows name themselves (CategoryRowName, an FName) and the record's claims are keyed
// by that name (FFortMissionAlertRecord ClaimDataMap, TMap<FString, FFortMissionAlertClaimData>), so `category` is the
// row's CategoryRowName there: what the record is keyed by, either way.
var missionAlertCategories = new SortedDictionary<string, object>(StringComparer.Ordinal);
if (gameData["Properties"]?["MissionAlertCategories"] is { } categoryTable)
{
    foreach (var (name, row) in LoadRows(provider, categoryTable))
    {
        missionAlertCategories[name] = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["category"] = row!["Category"]?.GetValue<string>() is { } category ? category.Split("::").Last()
                : row["CategoryRowName"]?.GetValue<string>() is { } rowName && rowName != "None" ? rowName : "",
            ["quota"] = row["Quota"]?.GetValue<int>() ?? 0,
            ["repeatable"] = row["MissionAlertRepeatable"]?.GetValue<bool>() ?? false
        };
    }
}
var missionAlertSpreads = new SortedDictionary<string, object>(StringComparer.Ordinal);
if (gameData["Properties"]?["MissionAlertSpreadDatas"] is { } spreadTable)
{
    foreach (var (name, row) in LoadRows(provider, spreadTable))
    {
        missionAlertSpreads[name] = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["chanceToSpread"] = row!["ChanceToSpread"]?.GetValue<double>() ?? 0,
            ["totalChancesToSpread"] = row["TotalChancesToSpread"]?.GetValue<int>() ?? 0,
            ["maxNumTilesToSpreadTo"] = row["MaxNumTilesToSpreadTo"]?.GetValue<int>() ?? 0,
            ["spreadInterval"] = row["SpreadInterval"]?.GetValue<double>() ?? 0,
            ["missionAlertRowName"] = row["MissionAlertRowName"]?.GetValue<string>() ?? ""
        };
    }
}

// Item upgrades: XP per level by curve row (index = level), XP back for recycling at a level, and the MetaRecipes
// (Evolve.* and Recycle.*: costs, results and the gameplay tags that unlock them).
static SortedDictionary<string, List<double>> Curves(DefaultFileProvider provider, string path)
{
    var curves = new SortedDictionary<string, List<double>>(StringComparer.Ordinal);
    if (!provider.TryLoadPackage(path, out var package)) throw new InvalidOperationException($"{path} not found");
    var rows = JsonNode.Parse(JsonConvert.SerializeObject(package.GetExports().First(e => e.ExportType == "CurveTable")))!["Rows"]!.AsObject();
    foreach (var (name, row) in rows)
    {
        var keys = row!["Keys"]!.AsArray().Select(k => (time: (int)k!["Time"]!.GetValue<double>(), value: k["Value"]!.GetValue<double>())).ToList();
        var values = new List<double> { 0 };
        for (var level = 1; level <= keys.Max(k => k.time); level++) values.Add(keys.FirstOrDefault(k => k.time == level).value);
        curves[name] = values;
    }
    return curves;
}
var recipes = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, JsonValue.Create("/Game/Items/Datatables/MetaRecipes.MetaRecipes")))
{
    recipes[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["costs"] = Items(row!["RecipeCosts"], assetTypes),
        ["results"] = Items(row["RecipeResults"], assetTypes),
        ["catalysts"] = Strings(row["RequiredCatalysts"])
    };
}
// The DisassembleRecipes rows world items name (what recycling one in the backpack gives back, at full value).
var disassembleRecipes = new SortedDictionary<string, object>(StringComparer.Ordinal);
if (provider.TryLoadPackage("FortniteGame/Content/Items/Datatables/DisassembleRecipes.uasset", out _))
{
    var named = items.Values.OfType<SortedDictionary<string, object>>()
        .Select(item => item.GetValueOrDefault("disassembleRecipe") as string).OfType<string>().ToHashSet(StringComparer.Ordinal);
    foreach (var (id, row) in LoadRows(provider, JsonValue.Create("/Game/Items/Datatables/DisassembleRecipes.DisassembleRecipes")))
        if (named.Contains(id)) disassembleRecipes[id] = Items(row!["RecipeResults"], assetTypes);
}
var upgrades = new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["levelCosts"] = Curves(provider, "FortniteGame/Content/Balance/DataTables/XPAccountItemLevels.uasset"),
    ["recycleXp"] = Curves(provider, "FortniteGame/Content/Balance/DataTables/XPAccountItemRewards.uasset"),
    ["ratings"] = Curves(provider, "FortniteGame/Content/Items/Datatables/BaseItemRating.uasset"),
    ["recipes"] = recipes
};
if (disassembleRecipes.Count > 0) upgrades["disassembleRecipes"] = disassembleRecipes;
if (craftingRecipes.Count > 0) upgrades["craftingRecipes"] = craftingRecipes;

// The expedition board: each slot (unlocked by its tag on the skill tree) and its generator, and the recipes.
var expeditionRecipes = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, JsonValue.Create("/Game/Expeditions/ExpeditionRecipes.ExpeditionRecipes")))
{
    expeditionRecipes[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["costs"] = Items(row!["RecipeCosts"], assetTypes),
        ["results"] = Items(row["RecipeResults"], assetTypes),
        ["catalysts"] = Strings(row["RequiredCatalysts"])
    };
}
var expeditionSlots = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, manager["ExpeditionSlotsDataTable"]))
{
    expeditionSlots[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["tag"] = row!["SlotTag"]?["TagName"]?.GetValue<string>() ?? "",
        ["generator"] = row["LootTierGroup"]?.GetValue<string>() ?? ""
    };
}
// Bonus criteria (DefaultGameData ExpeditionCriteriaRequirementsData, FortCriteriaRequirementData): the hero tag a squad
// member needs (and the minimum rarity when bRequireRarity), and the rating multiplier it gives (on that member, or on
// the whole squad when bGlobalMod).
var expeditionCriteria = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, gameData["Properties"]!["ExpeditionCriteriaRequirementsData"]))
{
    expeditionCriteria[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["tag"] = row!["RequiredTag"]?["TagName"]?.GetValue<string>() ?? "None",
        ["global"] = row["bGlobalMod"]?.GetValue<bool>() ?? false,
        ["mod"] = row["ModValue"]?.GetValue<double>() ?? 0,
        ["rarity"] = row["bRequireRarity"]?.GetValue<bool>() == true ? Enum(row["RequiredRarity"]) ?? "Handmade" : ""
    };
}

// The collection book (CollectionBook/Data/CollectionBookData): pages and their profile, sections, slots and the
// items each takes, the slot XP weights (FortCollectionBookSlotData: Constant + level x ItemLevel + rarity factor x
// Rarity + rating x ItemRating), the rarity factor curve (by rarity, Handmade = 0) and the book levels' rewards.
static object BookRewards(JsonNode? rewards, AssetTypes assetTypes) => new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["standard"] = Items(rewards?["StandardRewards"], assetTypes),
    ["hidden"] = Items(rewards?["HiddenRewards"], assetTypes),
    ["selectable"] = (rewards?["SelectableRewards"]?.AsArray() ?? []).Select(group => Items(group?["Rewards"], assetTypes)).ToList()
};
var book = LoadExport(provider, JsonValue.Create("/Game/CollectionBook/Data/CollectionBookData.CollectionBookData"), "FortCollectionBookData")["Properties"]!;
var bookPages = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, book["PageData"]))
    bookPages[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["profile"] = (row!["ProfileId"]?.GetValue<string>() ?? "").ToLowerInvariant(),
        ["sections"] = Strings(row["SectionRowNames"]),
        ["rewards"] = BookRewards(row["Rewards"], assetTypes)
    };
var bookSections = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, book["SectionData"]))
    bookSections[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["slots"] = Strings(row!["SlotRowNames"]),
        ["rewards"] = BookRewards(row["Rewards"], assetTypes)
    };
var bookSlots = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, book["SlotData"]))
    bookSlots[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["weight"] = row!["SlotXpWeightName"]?.GetValue<string>() ?? "Default",
        ["items"] = (row["AllowedItems"]?.AsArray() ?? []).Select(path => assetTypes.TemplateId(AssetPath(path))).Where(t => t is not null and not "None").ToList(),
        ["personalities"] = (row["AllowedWorkerPersonalities"]?.AsArray() ?? []).Select(tag => tag?["TagName"]?.GetValue<string>())
            .Where(tag => !string.IsNullOrEmpty(tag) && tag != "None").Distinct().ToList()
    };
var bookWeights = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var (id, row) in LoadRows(provider, book["XPWeightData"]))
    bookWeights[id] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["constant"] = row!["ConstantWeight"]?.GetValue<double>() ?? 0,
        ["rarity"] = row["RarityWeight"]?.GetValue<double>() ?? 0,
        ["level"] = row["ItemLevelWeight"]?.GetValue<double>() ?? 0,
        ["rating"] = row["ItemRatingWeight"]?.GetValue<double>() ?? 0
    };
var rarityCurve = LoadExport(provider, book["SlotRarityFactorData"], "CurveFloat")["Properties"]!["FloatCurve"]!["Keys"]!.AsArray()
    .Select(k => (time: k!["Time"]!.GetValue<double>(), value: k["Value"]!.GetValue<double>())).ToList();
var rarityFactor = Enumerable.Range(0, 7).Select(r => rarityCurve.FirstOrDefault(k => k.time == r).value).ToList();
var bookLevels = new List<object>();
foreach (var (id, row) in LoadRows(provider, book["BookXPData"]).OrderBy(entry => int.Parse(entry.Key)))
    bookLevels.Add(new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["level"] = int.Parse(id),
        ["totalXp"] = row!["TotalXpToGetToThisLevel"]?.GetValue<int>() ?? 0,
        ["rewards"] = BookRewards(row["Rewards"], assetTypes)
    });

// Account levels (FortLevelUpData): the total XP each level needs, how XP shows in the UI, and what reaching it gives
// ("/Game/Items/Tokens/HomebasePoints.HomebasePoints=1", comma separated).
var accountLevels = new List<object>();
foreach (var (id, row) in LoadRows(provider, JsonValue.Create("/Game/Balance/DataTables/XPAccountLevels.XPAccountLevels"))
    .OrderBy(entry => int.Parse(entry.Key)))
{
    var rewards = (row!["ItemRewardsText"]?.GetValue<string>() ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(reward => reward.Split('='))
        .Select(parts => new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["asset"] = parts[0].Split('.').Last(),
            ["quantity"] = parts.Length > 1 && int.TryParse(parts[1], out var quantity) ? quantity : 1
        })
        .ToList();
    accountLevels.Add(new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["level"] = int.Parse(id),
        ["xp"] = row["XP"]?.GetValue<long>() ?? 0,
        ["displayMultiplier"] = row["XPDisplayMultiplier"]?.GetValue<double>() ?? 1,
        ["restXpCap"] = row["RestXPCap"]?.GetValue<int>() ?? 0,
        ["restXpRechargeRate"] = row["RestXPRechargeRate"]?.GetValue<int>() ?? 0,
        ["boostXpPerConsumable"] = row["BoostXPPerConsumable"]?.GetValue<int>() ?? 0,
        ["rewards"] = rewards
    });
}

Directory.CreateDirectory(output);
var options = new JsonSerializerOptions { WriteIndented = true };
File.WriteAllText(Path.Combine(output, "accountlevels.json"), JsonSerializer.Serialize(accountLevels, options) + "\n");
File.WriteAllText(Path.Combine(output, "upgrades.json"), JsonSerializer.Serialize(upgrades, options) + "\n");
File.WriteAllText(Path.Combine(output, "expeditions.json"), JsonSerializer.Serialize(new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["expeditions"] = expeditions, ["recipes"] = expeditionRecipes, ["slots"] = expeditionSlots, ["criteria"] = expeditionCriteria
}, options) + "\n");
File.WriteAllText(Path.Combine(output, "collectionbook.json"), JsonSerializer.Serialize(new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["pages"] = bookPages, ["sections"] = bookSections, ["slots"] = bookSlots, ["weights"] = bookWeights,
    ["rarityFactor"] = rarityFactor, ["levels"] = bookLevels
}, options) + "\n");
File.WriteAllText(Path.Combine(output, "quests.json"), JsonSerializer.Serialize(quests, options) + "\n");
File.WriteAllText(Path.Combine(output, "items.json"), JsonSerializer.Serialize(items, options) + "\n");
File.WriteAllText(Path.Combine(output, "dailyrewards.json"), JsonSerializer.Serialize(dailyRewards, options) + "\n");
File.WriteAllText(Path.Combine(output, "characters.json"), JsonSerializer.Serialize(characters, options) + "\n");
File.WriteAllText(Path.Combine(output, "workers.json"), JsonSerializer.Serialize(workerData, options) + "\n");
File.WriteAllText(Path.Combine(output, "newaccount.json"), JsonSerializer.Serialize(newAccount, options) + "\n");
File.WriteAllText(Path.Combine(output, "cardpacks.json"), JsonSerializer.Serialize(cardPacks, options) + "\n");
File.WriteAllText(Path.Combine(output, "homebasenodes.json"), JsonSerializer.Serialize(new SortedDictionary<string, object>(StringComparer.Ordinal) { ["nodes"] = nodes, ["pages"] = pages }, options) + "\n");
File.WriteAllText(Path.Combine(output, "inventory.json"), JsonSerializer.Serialize(new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["nodes"] = inventoryNodes, ["buffs"] = inventoryBuffs
}, options) + "\n");
File.WriteAllText(Path.Combine(output, "research.json"), JsonSerializer.Serialize(new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["collectors"] = collectors, ["nodes"] = researchNodes, ["buffs"] = researchBuffs
}, options) + "\n");
File.WriteAllText(Path.Combine(output, "squads.json"), JsonSerializer.Serialize(squads, options) + "\n");
File.WriteAllText(Path.Combine(output, "banners.json"), JsonSerializer.Serialize(banners, options) + "\n");
File.WriteAllText(Path.Combine(output, "transmog.json"), JsonSerializer.Serialize(transmogKeys, options) + "\n");
File.WriteAllText(Path.Combine(output, "fabricator.json"), JsonSerializer.Serialize(fabricator, options) + "\n");
File.WriteAllText(Path.Combine(output, "objectivestats.json"), JsonSerializer.Serialize(objectiveStats, options) + "\n");
// The Theater.* gameplay tags the build defines (Balance/GameplayTags tables): 1.7.2's ActivitiesTags adds
// Theater.MainProgression, which its quest driven missions (SharedMissionLists TheaterTagQuery) need on a theater.
var theaterTags = new SortedSet<string>(StringComparer.Ordinal);
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("FortniteGame/Content/Balance/GameplayTags/", StringComparison.OrdinalIgnoreCase)))
{
    if (!provider.TryLoadPackage(file, out var tagPackage)) continue;
    var tagTable = tagPackage.GetExports().FirstOrDefault(e => e.ExportType.EndsWith("DataTable"));
    if (tagTable is null) continue;
    foreach (var (_, row) in JsonNode.Parse(JsonConvert.SerializeObject(tagTable))!["Rows"]?.AsObject() ?? [])
    {
        if (row?["Tag"]?.GetValue<string>() is { } tag && tag.StartsWith("Theater.", StringComparison.Ordinal)) theaterTags.Add(tag);
    }
}

var world = new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["zoneThemes"] = zoneThemes, ["missionGenerators"] = missionGenerators, ["primaryMissions"] = primaryMissions, ["questPaths"] = questPaths, ["difficulties"] = difficulties,
    ["mapPins"] = mapPins, ["globeSockets"] = globeSockets, ["missionAlerts"] = missionAlerts,
    ["dailyMissionAlertQuota"] = dailyMissionAlertQuota, ["missionAlertCategories"] = missionAlertCategories,
    ["missionAlertSpreads"] = missionAlertSpreads
};
if (theaterTags.Count > 0) world["theaterTags"] = theaterTags;
File.WriteAllText(Path.Combine(output, "world.json"), JsonSerializer.Serialize(world, options) + "\n");

// Battle Royale's (athena.json), from 1.8 (CL 3724489), the first build with an athena profile; earlier builds write it
// empty. Its cosmetics (Athena/Items/Cosmetics, the test characters of 00_TestAssets left out), its quests
// (Athena/Items/Quests, which the quest loop above doesn't scan: they are granted to the athena profile) and the season
// levels (AthenaGameData's SeasonXpLevelsTable, FAthenaLevelUpData rows).
var athenaCosmetics = new SortedDictionary<string, object>(StringComparer.Ordinal);
var athenaQuests = new SortedDictionary<string, object>(StringComparer.Ordinal);
var athenaLevels = new List<object>();
SortedDictionary<string, object>? athenaSeason = null;
var challengeSchedules = new SortedDictionary<string, object>(StringComparer.Ordinal);
var challengeBundles = new SortedDictionary<string, object>(StringComparer.Ordinal);
var cosmeticKeys = new List<(string TemplateId, string Class, string AssetName, string? Hero, string? Icon, string DisplayName)>();
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("FortniteGame/Content/Athena/Items/", StringComparison.OrdinalIgnoreCase)))
{
    if (file.Path.Contains("/00_TestAssets/", StringComparison.OrdinalIgnoreCase)) continue;
    var gamePath = "/Game/" + file.PathWithoutExtension["FortniteGame/Content/".Length..];
    var assetName = gamePath.Split('/').Last();
    if (!provider.TryLoadPackage(file, out var package)) continue;
    var export = package.GetExports().FirstOrDefault(e => e.Name.Equals(assetName, StringComparison.OrdinalIgnoreCase));
    if (export is null) continue;
    var properties = JsonNode.Parse(JsonConvert.SerializeObject(export))!["Properties"] ?? new JsonObject();
    if (export.ExportType == "FortQuestItemDefinition")
    {
        var quest = (SortedDictionary<string, object>)Quest(properties, assetTypes);
        if (properties["Category"]?["RowName"]?.GetValue<string>() is { } category and not "None") quest["category"] = category;
        if (properties["Weight"]?.GetValue<float>() is float weight) quest["weight"] = weight;
        // 3.0's (CL 3901517) challenge bundles' quests (EFortQuestType::AthenaChallengeBundleQuest) can be done by some of
        // their objectives: "Land at different named locations" lists all 18 and is done at ObjectiveCompletionCount.
        if ((string)quest["type"] == "AthenaChallengeBundleQuest" && properties["ObjectiveCompletionCount"]?.GetValue<int>() is int completionCount and > 0)
            quest["objectiveCompletionCount"] = completionCount;
        athenaQuests[export.Name.ToLowerInvariant()] = quest;
        continue;
    }
    // 3.0's (CL 3901517, Season 3) challenges: UFortChallengeBundleScheduleDefinition (Athena/Items/ChallengeBundleSchedules)
    // and UFortChallengeBundleItemDefinition (Athena/Items/ChallengeBundles), written below when the season grants any.
    if (export.ExportType == "FortChallengeBundleScheduleDefinition")
    {
        challengeSchedules[export.Name.ToLowerInvariant()] = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["category"] = properties["CategoryID"]?.GetValue<string>() ?? "",
            ["bundles"] = (properties["ScheduleEntries"]?.AsArray() ?? []).Select(entry => (object)new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                ["bundle"] = AssetName(AssetPath(entry!["ChallengeBundle"])).ToLowerInvariant(),
                ["unlockType"] = Enum(entry["UnlockType"]) ?? "OnScheduleGranted",
                ["unlockValue"] = entry["UnlockValue"]?.GetValue<int>() ?? 0
            }).ToList()
        };
        continue;
    }
    if (export.ExportType == "FortChallengeBundleItemDefinition")
    {
        challengeBundles[export.Name.ToLowerInvariant()] = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["quests"] = (properties["QuestInfos"]?.AsArray() ?? []).Select(info => (object)new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                ["quest"] = AssetName(AssetPath(info!["QuestDefinition"])).ToLowerInvariant(),
                ["grantWithBundle"] = info["bGrantWithBundle"]?.GetValue<bool>() ?? false
            }).ToList(),
            ["completionThreshold"] = properties["CompletionThreshold"]?.GetValue<int>() ?? 0,
            ["completionRewards"] = RewardList(properties["CompletionRewards"]?["Rewards"], assetTypes),
            ["visualStyle"] = Enum(properties["VisualStyle"]) ?? ""
        };
        continue;
    }
    if (!ItemClasses.AthenaCosmetics.Contains(export.ExportType)) continue;
    var cosmeticId = assetTypes.TemplateId($"{gamePath}.{export.Name}", export.ExportType, false)!;
    var displayName = properties["DisplayName"]?["LocalizedString"]?.GetValue<string>() ?? export.Name;
    athenaCosmetics[cosmeticId] = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["class"] = export.ExportType,
        ["name"] = displayName,
        ["rarity"] = Enum(properties["Rarity"]) ?? "Ordinary"
    };
    // The back bling parts (CustomCharacterPart, CharacterPartType Backpack) an outfit wears built in, through its hero's
    // specializations (FortHeroSpecialization CharacterParts), and a back bling's own CharacterParts, as part names: 3.0
    // (CL 3901517) took 2.5's built-in back blings off their outfits (HS_032's Male_Commando_10) and made them back blings
    // of their own (BID_001_BlueSquire wears Male_Commando_10), which owners of the outfit were given (Core-Backend #203).
    if (export.ExportType == "AthenaCharacterItemDefinition" && properties["HeroDefinition"] is { } heroReference
        && BuiltInBackpackParts(provider, heroReference) is { Count: > 0 } builtIn)
        ((SortedDictionary<string, object>)athenaCosmetics[cosmeticId])["backpackParts"] = builtIn;
    if (export.ExportType == "AthenaBackpackItemDefinition" && (properties["CharacterParts"] as JsonArray)?.Count > 0)
        ((SortedDictionary<string, object>)athenaCosmetics[cosmeticId])["parts"] = properties["CharacterParts"]!.AsArray()
            .Where(part => part is not null).Select(part => AssetName(PackageFile(part)[..^".uasset".Length]).ToLowerInvariant()).ToList();
    // An outfit's hero (HID_027_Athena_Commando_F): its featured tile art is named after it.
    var hero =properties["HeroDefinition"]?["ObjectPath"]?.GetValue<string>()?.Split('/').Last().Split('.')[0];
    // Its locker icon (LargePreviewImage, a soft path, else SmallPreviewImage): T-Icon-Glider-001-L is Glider_ID_001's,
    // whose featured tile art is T-Featured-Glider-001.
    var icon = (properties["LargePreviewImage"]?.GetValueKind() == JsonValueKind.String ? properties["LargePreviewImage"]!.GetValue<string>()
        : properties["SmallPreviewImage"]?["ObjectPath"]?.GetValue<string>())?.Split('/').Last().Split('.')[0];
    cosmeticKeys.Add((cosmeticId, export.ExportType, export.Name, hero, icon is null ? null : IconKey(icon), displayName));
}
// The item shop's display assets: Catalog/DisplayAssets' FortMtxOfferData whose TileImage is Battle Royale art
// (UI/Foundation/Textures/BattleRoyale, or the locker icons of the emotes' DA_EID_<name>, UI/Foundation/Textures/Icons; the
// others are Save the World's founders and V-Bucks tiles), by the cosmetic they
// show, as the object path an offer's displayAssetPath names (src/store/itemshop.js). Nothing in either asset points to
// the other, so a display asset is matched by its names, DA_Featured_<key> and its tile T-Featured-<key> or
// T-AthenaSoldiers-<key>, compared without case or separators, the first rule with exactly one cosmetic winning:
// - the tile is the cosmetic's locker icon's featured twin, T-Featured-<key> for T-Icon-<key>(-L): the art itself, so it
//   comes first (1.8.2's DA_Featured_GliderMiG shows T-Featured-Glider-001, Aerial Assault One, Glider_ID_001's
//   T-Icon-Glider-001-L, not Raptor's Glider_MiG camo);
// - the key is the cosmetic's asset name (DA_Featured_GliderVoyager is Glider_Voyager; later builds' DA_Featured_CID_...),
//   then the same with the numbers' leading zeros dropped (1.11's DA_Featured_Pickaxe_ID_11_Medieval is Pickaxe_ID_011_Medieval);
// - the key is an outfit's hero (T-AthenaSoldiers-HID-029-Athena-Commando-F-Halloween is CID_029's HID_029_...), then
//   names the hero's number (1.11's DA_Featured_SMaleHID050, tile T-AthenaSoldiers-HID-050-M, is HID_050's Crackshot);
// - the key is the cosmetic's type and a word of its asset name (PickaxeHalloween is HalloweenScythe, Reaper, the one
//   pickaxe with "halloween" in it; Batsickle is SickleBatPickaxe). A word, not a number: 1.11's tile T-Featured-Pickaxe-11
//   isn't Pickaxe_ID_011 (it is Pickaxe_ID_019_Heart's, Tat Axe, whose locker icon is T-Icon-Pickaxes-SK-Pickaxe-11-L);
// - the key is the cosmetic's type and its display name (2.1's DA_Featured_PickaxeCliffhanger, tile
//   T-Featured-PickaxeCliffhanger, is SkiIcePickaxe, "Cliffhanger").
// Not every shop cosmetic has a display asset: 2.2's paks have none for Tracker, Desperado and the other Season 1 outfits
// whose art is their hero's locker icon (HID 009 to 016, 018, 021 to 023, 025), nor for most gliders (Raptor's Glider_MiG,
// Hot Rod...) and a few pickaxes; those keep the locker icon (Core-Backend #183).
// A display asset no rule matches, or two that match one cosmetic, is left out and listed, for a new rule.
static string Key(string name) => new string(name.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
static string WithoutPrefix(string name, params string[] prefixes) =>
    prefixes.FirstOrDefault(p => name.StartsWith(p, StringComparison.OrdinalIgnoreCase)) is { } prefix ? name[prefix.Length..] : name;
// A key with its numbers' leading zeros dropped: 1.11's DA_Featured_Pickaxe_ID_11_Medieval is Pickaxe_ID_011_Medieval
// (Axecalibur; its tile, T-Featured-Pickaxe-20, is the featured twin of its locker icon T-Icon-Pickaxes-SK-Pickaxe-20-L).
static string Unpadded(string key) => Regex.Replace(key, @"(?<!\d)0+(?=\d)", "");
// The hero number in a name: an outfit's hero HID_024_Athena_Commando_F, 1.11's DA_Featured_SFemaleHID024 and its tile
// T-AthenaSoldiers-HID-024-Athena-Commando-F-L (Recon Specialist) all have 024.
static string? HeroNumber(string? name) => name is null ? null : Regex.Match(Key(name), @"hid(\d{3})") is { Success: true } m ? m.Groups[1].Value : null;
// A locker icon's name without its T-Icon- prefix and -L (large) suffix, as a key.
static string IconKey(string icon)
{
    var name = WithoutPrefix(icon, "T-Icon-", "T-Icon_", "T-");
    return Key(name.EndsWith("-L", StringComparison.OrdinalIgnoreCase) ? name[..^2] : name);
}
var athenaDisplayAssets = new SortedDictionary<string, string>(StringComparer.Ordinal);
var unmatchedDisplayAssets = new List<string>();
var displayAssetOwners = new Dictionary<string, string>(StringComparer.Ordinal);
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("FortniteGame/Content/Catalog/DisplayAssets/", StringComparison.OrdinalIgnoreCase)))
{
    var gamePath = "/Game/" + file.PathWithoutExtension["FortniteGame/Content/".Length..];
    var assetName = gamePath.Split('/').Last();
    if (!provider.TryLoadPackage(file, out var package)) continue;
    var export = package.GetExports().FirstOrDefault(e => e.ExportType == "FortMtxOfferData" && e.Name.Equals(assetName, StringComparison.OrdinalIgnoreCase));
    if (export is null) continue;
    var tile = JsonNode.Parse(JsonConvert.SerializeObject(export))!["Properties"]?["TileImage"]?["ResourceObject"]?["ObjectPath"]?.GetValue<string>();
    if (tile is null || !(tile.StartsWith("FortniteGame/Content/UI/Foundation/Textures/BattleRoyale/", StringComparison.OrdinalIgnoreCase)
        || tile.StartsWith("FortniteGame/Content/UI/Foundation/Textures/Icons/", StringComparison.OrdinalIgnoreCase))) continue;
    var tileName = tile.Split('/').Last().Split('.')[0];
    var keys = new[]
    {
        Key(WithoutPrefix(export.Name, "DA_Featured_", "DA_")),
        Key(WithoutPrefix(tileName, "T-Featured-", "T-AthenaSoldiers-", "T-"))
    }.Distinct().ToArray();
    // The tile as a locker icon's key: a featured tile is the featured twin of a locker icon, an icon tile (the emotes'
    // DA_EID_Dab, T-Icon-Emotes-E-Dab-L) is the locker icon itself.
    var featuredKey = tileName.StartsWith("T-Featured-", StringComparison.OrdinalIgnoreCase) ? Key(tileName["T-Featured-".Length..])
        : tileName.StartsWith("T-Icon-", StringComparison.OrdinalIgnoreCase) ? IconKey(tileName) : null;
    // A cosmetic class's type word: AthenaPickaxeItemDefinition's "pickaxe", AthenaCharacterItemDefinition's "character".
    static string TypeWord(string cosmeticClass) => Key(cosmeticClass.Replace("ItemDefinition", "").Replace("Athena", ""));
    Func<(string TemplateId, string Class, string AssetName, string? Hero, string? Icon, string DisplayName), bool>[] rules =
    [
        c => featuredKey is not null && c.Icon == featuredKey,
        c => keys.Contains(Key(c.AssetName)),
        c => keys.Select(Unpadded).Contains(Unpadded(Key(c.AssetName))),
        c => c.Hero is not null && keys.Contains(Key(c.Hero)),
        c => HeroNumber(c.Hero) is { } number && keys.Any(k => HeroNumber(k) == number),
        c => keys.Any(k => k.StartsWith(TypeWord(c.Class)) && k.Length > TypeWord(c.Class).Length
            && k[TypeWord(c.Class).Length..].Any(char.IsLetter) && Key(c.AssetName).Contains(k[TypeWord(c.Class).Length..])),
        c => keys.Contains(TypeWord(c.Class) + Key(c.DisplayName)),
    ];
    var match = rules.Select(rule => cosmeticKeys.Where(rule).ToList()).FirstOrDefault(found => found.Count == 1)?[0];
    var objectPath = $"{gamePath}.{export.Name}";
    if (match is null)
    {
        unmatchedDisplayAssets.Add(export.Name);
    }
    else if (displayAssetOwners.TryGetValue(match.Value.TemplateId, out var other))
    {
        athenaDisplayAssets.Remove(match.Value.TemplateId);
        unmatchedDisplayAssets.Add($"{export.Name} and {other} (both {match.Value.TemplateId})");
    }
    else
    {
        displayAssetOwners[match.Value.TemplateId] = export.Name;
        athenaDisplayAssets[match.Value.TemplateId] = objectPath;
    }
}
if (provider.TryLoadPackage("FortniteGame/Content/Balance/AthenaGameData.uasset", out var athenaGameData))
{
    var athenaData = JsonNode.Parse(JsonConvert.SerializeObject(athenaGameData.GetExports().First(e => e.ExportType == "AthenaGameData")))!["Properties"];
    // 1.11 (CL 3807424, Season 2) takes AthenaGameData's SeasonXpLevelsTable out: each season's AthenaSeasonItemDefinition
    // (Athena/Items/Seasons/AthenaSeason<n>) names its own SeasonXpCurve, so the newest season's levels are taken.
    // 2.5 (CL 3889387, still Season 2) ships AthenaSeason3 ahead of its season: it names AthenaSeason2's SeasonXpCurve and
    // BookXpCurve (Athena_Season2_XP, Athena_Season2_BP) and copies its reward schedules, with SeasonNumber 3 and the
    // BRSeason3 storefront. A season whose curves an earlier season already names is such a stand-in, not the build's
    // season, so the newest season with curves of its own is taken; earlier builds have no stand-in.
    var seasons = athenaData!["SeasonXpLevelsTable"] is not null ? [] : provider.Files.Values
        .Where(f => f.Extension == "uasset" && Regex.IsMatch(f.Path, @"^FortniteGame/Content/Athena/Items/Seasons/AthenaSeason\d+\.uasset$", RegexOptions.IgnoreCase))
        .OrderByDescending(f => int.Parse(Regex.Match(f.Path, @"(\d+)\.uasset$").Groups[1].Value))
        .Select(f => LoadExport(provider, f.Path, "AthenaSeasonItemDefinition")["Properties"])
        .Where(properties => properties?["SeasonXpCurve"] is not null)
        .ToList();
    string SeasonCurves(JsonNode season) => $"{season["SeasonXpCurve"]?["ObjectPath"]}|{season["BookXpCurve"]?["ObjectPath"]}";
    var newestSeason = seasons.Select((season, index) => (season, index))
        .Where(entry => !seasons.Skip(entry.index + 1).Any(earlier => SeasonCurves(earlier!) == SeasonCurves(entry.season!)))
        .Select(entry => entry.season)
        .FirstOrDefault();
    var seasonXpTable = athenaData["SeasonXpLevelsTable"] ?? newestSeason?["SeasonXpCurve"];
    // That season's Battle Pass (UAthenaSeasonItemDefinition): its number, level and tier counts, the storefront its
    // offers are in, the tiers' Battle Stars (BookXpCurve, FAthenaLevelUpData rows) and the reward schedules
    // (FAthenaRewardSchedule {Levels: [{Rewards: [FAthenaRewardItemReference {ItemDefinition, TemplateId, Quantity}]}]},
    // indexed by level): what each season level gives (SeasonXpScheduleFree: Battle Stars) and each tier gives the free
    // pass (BookXpScheduleFree) and the Battle Pass (BookXpSchedulePaid). Levels with nothing are left out.
    if (newestSeason is not null)
    {
        List<object> Schedule(JsonNode? schedule) => (schedule?["Levels"]?.AsArray() ?? []).Select((level, index) => (level, index))
            .Select(entry => (entry.index, rewards: (entry.level?["Rewards"]?.AsArray() ?? []).Select(reward => new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                ["templateId"] = reward!["TemplateId"]?.GetValue<string>() is { Length: > 0 } templateId ? templateId : assetTypes.TemplateId(ObjectPath(AssetPath(reward["ItemDefinition"]))),
                ["quantity"] = reward["Quantity"]?.GetValue<int>() ?? 1
            }).Where(reward => (string)reward["templateId"] is not ("" or "None")).ToList()))
            .Where(entry => entry.rewards.Count > 0)
            .Select(entry => (object)new SortedDictionary<string, object>(StringComparer.Ordinal) { ["level"] = entry.index, ["rewards"] = entry.rewards })
            .ToList();
        athenaSeason = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["seasonNumber"] = newestSeason["SeasonNumber"]!.GetValue<int>(),
            ["numSeasonLevels"] = newestSeason["NumSeasonLevels"]!.GetValue<int>(),
            ["numBookLevels"] = newestSeason["NumBookLevels"]!.GetValue<int>(),
            ["storefront"] = newestSeason["SeasonStorefront"]?.GetValue<string>() ?? "",
            ["bookLevels"] = LoadRows(provider, newestSeason["BookXpCurve"]).OrderBy(r => r.Value!["Level"]!.GetValue<int>())
                .Select(r => (object)new SortedDictionary<string, object>(StringComparer.Ordinal)
                {
                    ["level"] = r.Value!["Level"]!.GetValue<int>(), ["xpToNextLevel"] = r.Value["XpToNextLevel"]!.GetValue<int>(),
                    ["xpTotal"] = r.Value["XpTotal"]!.GetValue<int>()
                }).ToList(),
            ["seasonRewards"] = Schedule(newestSeason["SeasonXpScheduleFree"]),
            ["bookFreeRewards"] = Schedule(newestSeason["BookXpScheduleFree"]),
            ["bookPaidRewards"] = Schedule(newestSeason["BookXpSchedulePaid"])
        };
        // From 3.0 (CL 3901517, Season 3) the season names its challenges: the schedules the challenges tab always shows
        // (ChallengeSchedulesAlwaysShown: Season3_Challenge_Schedule, the Battle Pass's weekly challenges), the Battle Pass's
        // own schedule when set (ChallengeSchedulePaid, unset in 3.0), what a first win in the season gives
        // (SeasonFirstWinRewards: the Paper Parasol) and the tier offer (BattlePassLevelOfferID). Only such a season takes
        // them (2.5's AthenaSeason2 has no ChallengeSchedulesAlwaysShown), so earlier seasons extract as before.
        static string ObjectName(JsonNode reference) => reference["ObjectPath"]!.GetValue<string>().Split('/').Last().Split('.')[0].ToLowerInvariant();
        var shownSchedules = (newestSeason["ChallengeSchedulesAlwaysShown"]?.AsArray() ?? []).OfType<JsonObject>().Select(ObjectName).ToList();
        if (shownSchedules.Count > 0)
        {
            athenaSeason["challengeSchedulesAlwaysShown"] = shownSchedules;
            if (newestSeason["ChallengeSchedulePaid"] is JsonObject paidSchedule) athenaSeason["challengeSchedulePaid"] = ObjectName(paidSchedule);
            athenaSeason["firstWinRewards"] = RewardList(newestSeason["SeasonFirstWinRewards"]?["Rewards"], assetTypes);
            athenaSeason["battlePassLevelOfferId"] = newestSeason["BattlePassLevelOfferID"]?.GetValue<string>() ?? "";
        }
    }
    foreach (var (_, row) in LoadRows(provider, seasonXpTable).OrderBy(r => r.Value!["Level"]!.GetValue<int>()))
    {
        var level = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["level"] = row!["Level"]!.GetValue<int>(),
            ["xpToNextLevel"] = row["XpToNextLevel"]!.GetValue<int>(),
            ["xpTotal"] = row["XpTotal"]!.GetValue<int>()
        };
        if (row["ChaseRewardTemplateId"]?.GetValue<string>() is { Length: > 0 } chaseReward) level["chaseReward"] = chaseReward;
        athenaLevels.Add(level);
    }
}
// The objective stat rows those quests count (the gameserver's quest manager evaluates them; Core matches a reported
// match result against AthenaRank's Athena.Rank condition and the playlist context tags).
var athenaStats = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var quest in athenaQuests.Values.Cast<SortedDictionary<string, object>>())
{
    foreach (var objective in (List<SortedDictionary<string, object>>)quest["objectives"])
    {
        if (objective.TryGetValue("stat", out var stat) && (objectiveStats.TryGetValue((string)stat, out var row) || athenaObjectiveStats.TryGetValue((string)stat, out row)))
            athenaStats[(string)stat] = row;
    }
}
// Battle Royale's loot tables (DefaultGameData's LootTierDataTables and LootPackageDataTables under /Athena:
// AthenaLootTierData_Client, AthenaLootPackages_Client), whole, by object path, every row with every property, in the
// form UDataTable::CreateTableFromJSONString reads back: soft object paths as their path string ("None" for none), the
// rest as the asset has it. The backend serves Epic's content updates as [AssetHotfix] rows built from these
// (src/events/contentupdates.js); the hotfix replaces a table whole, so it needs all of it.
var athenaLoot = new SortedDictionary<string, object>(StringComparer.Ordinal);
static JsonNode? ImportForm(JsonNode? value) => value switch
{
    JsonObject o when o.Count == 2 && o["AssetPathName"] is not null && o["SubPathString"] is not null => JsonValue.Create(o["AssetPathName"]!.GetValue<string>()),
    JsonObject o => new JsonObject(o.Select(p => KeyValuePair.Create(p.Key, ImportForm(p.Value)))),
    JsonArray a => new JsonArray(a.Select(ImportForm).ToArray()),
    _ => value?.DeepClone()
};
foreach (var reference in (gameData["Properties"]?["LootTierDataTables"]?.AsArray() ?? []).Concat(gameData["Properties"]?["LootPackageDataTables"]?.AsArray() ?? []))
{
    var tablePath = AssetPath(reference);
    if (!tablePath.StartsWith("/Game/Items/Datatables/Athena", StringComparison.OrdinalIgnoreCase)) continue;
    var rows = LoadRows(provider, reference);
    athenaLoot[ObjectPath(tablePath)] = new JsonObject(rows.Select(r => KeyValuePair.Create(r.Key, ImportForm(r.Value))));
}
// Shooting Test #1's weapon stats (2.4 to 2.5, src/events/shootingtest.js): the table PlayerPawn_Athena's
// PrototypeShootingModelPerfectAimWhenTargetingMinSpread names (AthenaRangedWeapons_ShootingModel3), which a ranged
// weapon reads its stats from in playlist 15 while UFortGlobals' bShootingTest3Enabled is set. Whole, by object path,
// in the import form: object references (Durability's WeaponDurabilityRarity) as their object path and no reference as
// "None", which CreateTableFromJSONString reads back.
static JsonNode? ImportReference(JsonNode? value) => value switch
{
    null => JsonValue.Create("None"),
    JsonObject o when o.Count == 2 && o["ObjectName"] is not null && o["ObjectPath"] is not null =>
        JsonValue.Create(GamePath(o["ObjectPath"]!.GetValue<string>())),
    JsonObject o => new JsonObject(o.Select(p => KeyValuePair.Create(p.Key, ImportReference(p.Value)))),
    _ => ImportForm(value)
};
SortedDictionary<string, object>? shootingModel = null;
if (provider.TryLoadPackage("FortniteGame/Content/Athena/PlayerPawn_Athena.uasset", out var pawnPackage))
{
    var pawn = JsonNode.Parse(JsonConvert.SerializeObject(pawnPackage.GetExports().First(e => e.Name == "Default__PlayerPawn_Athena_C")))!;
    if (pawn["Properties"]?["PrototypeShootingModelPerfectAimWhenTargetingMinSpread"] is JsonObject reference)
    {
        var rows = LoadRows(provider, reference);
        shootingModel = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["table"] = GamePath(reference["ObjectPath"]!.GetValue<string>()),
            ["rows"] = new JsonObject(rows.Select(r => KeyValuePair.Create(r.Key, ImportReference(r.Value))))
        };
    }
}
var athenaFile = new SortedDictionary<string, object>(StringComparer.Ordinal)
{
    ["cosmetics"] = athenaCosmetics, ["displayAssets"] = athenaDisplayAssets, ["quests"] = athenaQuests, ["levels"] = athenaLevels,
    ["objectiveStats"] = athenaStats
};
if (athenaSeason is not null) athenaFile["season"] = athenaSeason;
// The challenge schedules the season grants (its rewards and the ones it names) and their bundles: 3.0's.
if (athenaSeason is not null && athenaSeason.ContainsKey("challengeSchedulesAlwaysShown"))
{
    var granted = ((List<object>)athenaSeason["bookFreeRewards"]).Concat((List<object>)athenaSeason["bookPaidRewards"])
        .SelectMany(level => (List<SortedDictionary<string, object>>)((SortedDictionary<string, object>)level)["rewards"])
        .Select(reward => (string)reward["templateId"])
        .Where(templateId => templateId.StartsWith("ChallengeBundleSchedule:", StringComparison.OrdinalIgnoreCase))
        .Select(templateId => templateId.Split(':')[1].ToLowerInvariant())
        .Concat((List<string>)athenaSeason["challengeSchedulesAlwaysShown"])
        .Concat(athenaSeason.TryGetValue("challengeSchedulePaid", out var paid) ? [(string)paid] : Array.Empty<string>())
        .Where(challengeSchedules.ContainsKey).Distinct().ToList();
    var grantedSchedules = new SortedDictionary<string, object>(StringComparer.Ordinal);
    var bundles = new SortedDictionary<string, object>(StringComparer.Ordinal);
    foreach (var id in granted)
    {
        grantedSchedules[id] = challengeSchedules[id];
        foreach (var entry in (List<object>)((SortedDictionary<string, object>)challengeSchedules[id])["bundles"])
        {
            var bundle = (string)((SortedDictionary<string, object>)entry)["bundle"];
            if (challengeBundles.TryGetValue(bundle, out var definition)) bundles[bundle] = definition;
        }
    }
    athenaFile["challengeSchedules"] = grantedSchedules;
    athenaFile["challengeBundles"] = bundles;
}
if (athenaLoot.Count > 0) athenaFile["loot"] = athenaLoot;
if (shootingModel is not null) athenaFile["shootingModel"] = shootingModel;
File.WriteAllText(Path.Combine(output, "athena.json"), JsonSerializer.Serialize(athenaFile, options) + "\n");
Console.WriteLine($"Battle Royale: {athenaCosmetics.Count} cosmetics, {athenaDisplayAssets.Count} display assets, {athenaQuests.Count} quests, {athenaLevels.Count} season levels");
if (unmatchedDisplayAssets.Count > 0) Console.WriteLine($"Display assets matched to no one cosmetic: {string.Join(", ", unmatchedDisplayAssets)}");
Console.WriteLine($"{zoneThemes.Count} zone themes, {missionGenerators.Count} mission generators, {difficulties.Count} mission difficulties");
Console.WriteLine($"{characters.Count} characters, {cardPacks.Count} card packs, {nodes.Count} skill tree nodes, {squads.Count} squads, {objectiveStats.Count} objective stats");
Console.WriteLine($"{quests.Count} quests, {items.Count} items and {dailyRewards.Count} daily reward schedules from {version["BranchName"]}-CL-{version["Changelist"]} into {output}");
if (unmapped.Count > 0) Console.WriteLine($"Skipped item classes with no known profile: {string.Join(", ", unmapped)}");
return 0;

static object Quest(JsonNode p, AssetTypes assetTypes)
{
    var quest = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["type"] = Enum(p["QuestType"]) ?? "Task",
        ["objectives"] = (p["Objectives"]?.AsArray() ?? []).Select(o => Objective(o!, assetTypes)).ToList()
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
        quest["prerequisiteQuest"] = AssetName(prerequisiteQuest).ToLowerInvariant();
    var tags = p["Prerequisites"]?.AsArray().Select(t => t!.GetValue<string>()).ToList();
    if (tags is { Count: > 0 }) quest["prerequisites"] = tags;
    if (p["bHidden"]?.GetValue<bool>() == true) quest["hidden"] = true;
    if (p["bDeprecated"]?.GetValue<bool>() == true) quest["deprecated"] = true;
    if (p["bExpandsStormShield"]?.GetValue<bool>() == true) quest["expandsStormShield"] = true;
    if (p["ExpirationDuration"]?.GetValue<int>() is int expiration and > 0) quest["expirationDuration"] = expiration;
    return quest;
}

// Objectives advance on an item event (e.g. Acquire HomebaseNode:x, OpenCardPack CardPack:y) or a stat row.
static SortedDictionary<string, object> Objective(JsonNode o, AssetTypes assetTypes)
{
    var objective = new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["name"] = o["BackendName"]!.GetValue<string>().ToLowerInvariant(),
        ["count"] = o["Count"]?.GetValue<int>() ?? 1
    };
    var itemEvent = Enum(o["ItemEvent"]);
    if (itemEvent is not (null or "Max_None"))
    {
        objective["itemEvent"] = itemEvent;
        var templateOverride = o["ItemTemplateIdOverride"]?.GetValue<string>() ?? "";
        var reference = o["ItemReference"] is null ? "" : AssetPath(o["ItemReference"]);
        if (templateOverride != "") objective["item"] = templateOverride;
        else if (reference is not ("" or "None")) objective["item"] = assetTypes.TemplateId(reference);
    }
    var stat = o["ObjectiveStatHandle"]?["RowName"]?.GetValue<string>();
    if (stat is not (null or "None")) objective["stat"] = stat.ToLowerInvariant();
    if (o["bRequirePrimaryMissionCompletion"]?.GetValue<bool>() == true) objective["requirePrimaryMissionCompletion"] = true;
    return objective;
}

// An object reference's "FortniteGame/Content/Dir/Name.0" as the soft path "/Game/Dir/Name.Name".
static string GamePath(string objectPath)
{
    var package = objectPath.Split('.')[0];
    if (package.StartsWith("FortniteGame/Content/")) package = "/Game/" + package["FortniteGame/Content/".Length..];
    return $"{package}.{package.Split('/').Last()}";
}

// Soft paths come as "/Game/Dir/Name.Name" or just "/Game/Dir/Name".
static string AssetName(string path) => path.Split('/').Last().Split('.').Last();

static List<string> Strings(JsonNode? values) => (values as JsonArray)?.Select(v => v!.GetValue<string>()).ToList() ?? [];

static string PackageFile(JsonNode? reference)
{
    var path = reference switch
    {
        JsonObject o when o["ObjectPath"] is not null => o["ObjectPath"]!.GetValue<string>(),
        JsonObject o => o["AssetPathName"]!.GetValue<string>(),
        _ => reference!.GetValue<string>()
    };
    path = path.Split('.')[0];
    if (path.StartsWith("/Game/")) path = "FortniteGame/Content/" + path["/Game/".Length..];
    return path + ".uasset";
}

// The Backpack-type parts (EFortCustomPartType::Backpack) of a hero's specializations, as lower-case part names.
static List<string> BuiltInBackpackParts(DefaultFileProvider provider, JsonNode heroReference)
{
    var parts = new SortedSet<string>(StringComparer.Ordinal);
    JsonNode? Properties(JsonNode? reference)
    {
        if (reference is null || !provider.TryLoadPackage(PackageFile(reference), out var package)) return null;
        // The asset itself, not its subobjects (a backpack part's CustomCharacterBackpackData comes first).
        var name = AssetName(PackageFile(reference)[..^".uasset".Length]);
        var export = package.GetExports().FirstOrDefault(e => e.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
        return export is null ? null : JsonNode.Parse(JsonConvert.SerializeObject(export))!["Properties"];
    }
    foreach (var specialization in (Properties(heroReference)?["Specializations"] as JsonArray) ?? [])
    {
        foreach (var part in (Properties(specialization)?["CharacterParts"] as JsonArray) ?? [])
        {
            if (part is null || Enum(Properties(part)?["CharacterPartType"]) != "Backpack") continue;
            parts.Add(AssetName(PackageFile(part)[..^".uasset".Length]).ToLowerInvariant());
        }
    }
    return [.. parts];
}

static JsonNode LoadExport(DefaultFileProvider provider, JsonNode? reference, string type)
{
    var file = PackageFile(reference);
    if (!provider.TryLoadPackage(file, out var package)) throw new InvalidOperationException($"{file} not found");
    return JsonNode.Parse(JsonConvert.SerializeObject(package.GetExports().First(e => e.ExportType == type)))!;
}

static JsonObject LoadRows(DefaultFileProvider provider, JsonNode? reference)
{
    var file = PackageFile(reference);
    if (!provider.TryLoadPackage(file, out var package)) throw new InvalidOperationException($"{file} not found");
    var table = package.GetExports().First(e => e.ExportType.EndsWith("DataTable"));
    return JsonNode.Parse(JsonConvert.SerializeObject(table))!["Rows"]!.AsObject();
}

static void AddItems(IDictionary<string, object> target, string key, JsonNode? items, AssetTypes assetTypes)
{
    var list = Items(items, assetTypes);
    if (list.Count > 0) target[key] = list;
}

// FAthenaRewardItemReference {ItemDefinition, TemplateId, Quantity} as {templateId, quantity}: the TemplateId when set,
// else the item definition's.
static List<object> RewardList(JsonNode? rewards, AssetTypes assetTypes) => (rewards?.AsArray() ?? [])
    .Select(reward => new SortedDictionary<string, object>(StringComparer.Ordinal)
    {
        ["templateId"] = reward!["TemplateId"]?.GetValue<string>() is { Length: > 0 } templateId ? templateId : assetTypes.TemplateId(ObjectPath(AssetPath(reward["ItemDefinition"]))),
        ["quantity"] = reward["Quantity"]?.GetValue<int>() ?? 1
    }).Where(reward => (string)reward["templateId"] is not ("" or "None")).Cast<object>().ToList();

static List<SortedDictionary<string, object>> Items(JsonNode? items, AssetTypes assetTypes) =>
    (items?.AsArray() ?? []).Select(i => new SortedDictionary<string, object>
    {
        ["templateId"] = i!["TemplateId"]?.GetValue<string>() ?? assetTypes.TemplateId(AssetPath(i["ItemDefinition"])),
        ["quantity"] = i["Quantity"]?.GetValue<int>() ?? 1
    }).Where(i => (string)i["templateId"] != "None").ToList();

static string? Enum(JsonNode? value) => value?.GetValue<string>().Split("::").Last();

// A soft object path as the game writes it, "/Game/Path/Asset.Asset" (some references come back without the object name).
static string ObjectPath(string path) => path.Contains('.') ? path : $"{path}.{path.Split('/').Last()}";

static string AssetPath(JsonNode? value) =>
    value is JsonObject path ? path["AssetPathName"]!.GetValue<string>() : value!.GetValue<string>();

// Parents from the SDK dump; constructor MaxStackSize defaults read from each class's native constructor.
static class ItemClasses
{
    // Battle Royale's cosmetics (1.8's EAthenaCustomizationCategory slots, besides medals): only athena.json has them.
    public static readonly HashSet<string> AthenaCosmetics =
    [
        "AthenaCharacterItemDefinition", "AthenaHatItemDefinition", "AthenaBackpackItemDefinition", "AthenaPickaxeItemDefinition",
        "AthenaGliderItemDefinition", "AthenaLoadingScreenItemDefinition", "AthenaBattleBusItemDefinition", "AthenaDanceItemDefinition",
        "AthenaConsumableEmoteItemDefinition", "AthenaVictoryPoseItemDefinition",
        // 1.11's emoticons (Athena/Items/Cosmetics/Dances/Emoji, UAthenaEmojiItemDefinition: UAthenaDanceItemDefinition),
        // AthenaDance items that go in the emote slots.
        "AthenaEmojiItemDefinition",
        // 3.0's (CL 3901517) contrails (Athena/Items/Cosmetics/Contrails, EAthenaCustomizationCategory::SkyDiveContrail),
        // which its Battle Pass gives.
        "AthenaSkyDiveContrailItemDefinition"
    ];

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
        // 3.0's (CL 3901517) Hoverboard, PersonalVehicle:VID_Hoverboard (the Hoverboard questline's reward).
        ["FortPersonalVehicleItemDefinition"] = "FortAccountItemDefinition",
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

    // bHasDisintegrationValue / bUsesCraftingRecipeToGetDisintegrationValue as each class's constructor sets them: consumables
    // (sub_5A47F0), ingredients (sub_5A5BA0) and resources (sub_5DAD30) are valued from the fabricator table; weapons
    // (sub_8226F0), ammo (sub_822390) and traps (sub_5DB140) from their recipe; deco (sub_5A49C0) and building pieces
    // (sub_5A4190) clear the first again.
    private static readonly Dictionary<string, bool> ConstructorHasDisintegrationValue = new()
    {
        ["FortWorldItemDefinition"] = false,
        ["FortConsumableItemDefinition"] = true,
        ["FortIngredientItemDefinition"] = true,
        ["FortResourceItemDefinition"] = true,
        ["FortWeaponItemDefinition"] = true,
        ["FortAmmoItemDefinition"] = true,
        ["FortDecoItemDefinition"] = false,
        ["FortBuildingItemDefinition"] = false,
        ["FortTrapItemDefinition"] = true
    };

    private static readonly Dictionary<string, bool> ConstructorUsesCraftingRecipe = new()
    {
        ["FortWorldItemDefinition"] = false,
        ["FortWeaponItemDefinition"] = true,
        ["FortAmmoItemDefinition"] = true,
        ["FortTrapItemDefinition"] = true
    };

    public static bool HasDisintegrationValue(string itemClass) =>
        Lineage(itemClass).Where(ConstructorHasDisintegrationValue.ContainsKey).Select(c => ConstructorHasDisintegrationValue[c]).FirstOrDefault();

    // bNeverPersisted (+0xF4 bit 1, setter thunk 0xA3F760) as the class constructors set it: UFortItemDefinition 0x5A5D60
    // clears it; NeverPersist 0x5DAA90, Backpack 0x5A3FC0 and Emote 0x5A4E60 set it.
    private static readonly Dictionary<string, bool> ConstructorNeverPersisted = new()
    {
        ["FortItemDefinition"] = false,
        ["FortNeverPersistItemDefinition"] = true,
        ["FortBackpackItemDefinition"] = true,
        ["FortEmoteItemDefinition"] = true
    };

    // bInventorySizeLimited (+0x141, UFortItemDefinition::IsInventorySizeLimited 0xA02A10) as the class constructors set
    // it: what counts toward the vault (account items) and backpack (world items) limits.
    private static readonly Dictionary<string, bool> ConstructorInventorySizeLimited = new()
    {
        ["FortItemDefinition"] = false,             // 0x5A5D60
        ["FortWorldItemDefinition"] = true,         // 0x5DB330
        ["FortAlterationItemDefinition"] = true,    // 0x5A3E80
        ["FortSchematicItemDefinition"] = true,     // 0x5DAE20
        ["FortDefenderItemDefinition"] = true,      // 0x5A4C90
        ["FortWorkerType"] = true,                  // 0x5A62C0
        ["FortHeroType"] = true,                    // 0x5A53F0
        ["FortWeaponItemDefinition"] = true,        // 0x8226F0
        ["FortTrapItemDefinition"] = true,          // 0x5DB140
        ["FortConsumableItemDefinition"] = true,    // 0x5A47F0
        ["FortIngredientItemDefinition"] = true,    // 0x5A5BA0
        ["FortMissionItemDefinition"] = true,       // 0x5DAA30
        ["FortNeverPersistItemDefinition"] = false, // 0x5DAA90
        ["FortResourceItemDefinition"] = false,     // 0x5DAD30
        ["FortAmmoItemDefinition"] = false,         // 0x822390
        ["FortBadgeItemDefinition"] = false,        // 0x5A40B0
        ["FortBuildingItemDefinition"] = false,     // 0x5A4190
        ["FortEditToolItemDefinition"] = false      // 0x5A4E10
    };

    public static bool InventorySizeLimitedByDefault(string itemClass) =>
        Lineage(itemClass).Where(ConstructorInventorySizeLimited.ContainsKey).Select(c => ConstructorInventorySizeLimited[c]).First();

    public static bool NeverPersistedByDefault(string itemClass) =>
        Lineage(itemClass).Where(ConstructorNeverPersisted.ContainsKey).Select(c => ConstructorNeverPersisted[c]).First();

    public static bool UsesCraftingRecipeForDisintegration(string itemClass) =>
        Lineage(itemClass).Where(ConstructorUsesCraftingRecipe.ContainsKey).Select(c => ConstructorUsesCraftingRecipe[c]).FirstOrDefault();

    public static IEnumerable<string> Lineage(string itemClass)
    {
        for (var current = itemClass; current is not null; current = Parents.GetValueOrDefault(current))
            yield return current;
    }

    // Outposts and deployable bases (cloud save items) are account items up to 1.2: CreateOrUpgradeOutpostItem,
    // UpdateOutpostCore and CreateDeployableBaseItem are UFortMcpProfileAccount commands, and the client reads the
    // outpost core's level from the account profile. 1.7.2 (CL 3700114) moved them to a profile of their own: those
    // commands are UFortMcpProfileMetadata's, and the cloud save items' MCP template (sub_685410) names
    // static_profile_type "metadata" where the other account items' (sub_653990) name "profile". Only the client
    // shows which builds have it, so the changelist decides.
    public const int FirstMetadataProfileChangelist = 3700114;

    public static string? ProfileType(string itemClass, int changelist)
    {
        var lineage = Lineage(itemClass).ToList();
        if (lineage.Contains("FortCloudSaveItemDefinition") && changelist >= FirstMetadataProfileChangelist) return "metadata";
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
