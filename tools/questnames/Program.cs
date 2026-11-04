using System.Text.Json;
using System.Text.Json.Nodes;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using JsonConvert = Newtonsoft.Json.JsonConvert;

// Maintainer tool: Save the World's quest names (each FortQuestItemDefinition's DisplayName under Content/Quests) for the
// admin panel's quest list (Core-Backend #216), into gamedata/questnames.json:
//
//   dotnet run -c Release --project tools/questnames -- "<build folder with FortniteGame>" <aes key> <4.16|4.19|4.20>
//
// The names are merged into the file's: a build's names replace the ones there, and the quests it lacks keep theirs, so
// running it on older builds first and newer ones last gives every quest its newest name. The committed file is 2.5's
// (CL-3889387) names, then 3.0's (CL-3901517); 1.7.2's Halloween scavenger quests, gone by 2.5, have none.
if (args.Length < 3)
{
    Console.Error.WriteLine("usage: questnames <build folder containing FortniteGame> <aes key> <4.16|4.19|4.20> [output file]");
    return 1;
}
var game = args[2] switch
{
    "4.16" => EGame.GAME_UE4_16,
    "4.19" => EGame.GAME_UE4_19,
    "4.20" => EGame.GAME_UE4_20,
    _ => throw new NotSupportedException($"Engine {args[2]} is not mapped")
};
var output = args.Length > 3 ? args[3]
    : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "gamedata", "questnames.json"));
var aesKey = args[1].StartsWith("0x") ? args[1] : "0x" + args[1];

var provider = new DefaultFileProvider(Path.Combine(args[0], "FortniteGame", "Content", "Paks"), SearchOption.TopDirectoryOnly,
    new VersionContainer(game), StringComparer.OrdinalIgnoreCase);
provider.Initialize();
provider.SubmitKeys([new KeyValuePair<FGuid, FAesKey>(new FGuid(), new FAesKey(aesKey))]);
provider.PostMount();

var names = new SortedDictionary<string, string>(StringComparer.Ordinal);
if (File.Exists(output))
{
    foreach (var (id, name) in JsonNode.Parse(File.ReadAllText(output))!.AsObject()) names[id] = name!.GetValue<string>();
}
var found = 0;
foreach (var file in provider.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("FortniteGame/Content/Quests/", StringComparison.OrdinalIgnoreCase)))
{
    foreach (var export in provider.LoadPackage(file).GetExports())
    {
        if (export.ExportType != "FortQuestItemDefinition") continue;
        var properties = JsonNode.Parse(JsonConvert.SerializeObject(export))!["Properties"] ?? new JsonObject();
        if (properties["DisplayName"]?["SourceString"]?.GetValue<string>() is not { } name || name.Trim().Length == 0) continue;
        names[export.Name.ToLowerInvariant()] = name;
        found++;
    }
}
File.WriteAllText(output, JsonSerializer.Serialize(names, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }).Replace("\r\n", "\n") + "\n");
Console.WriteLine($"{found} quest names from {args[0]}, {names.Count} in {output}");
return 0;
