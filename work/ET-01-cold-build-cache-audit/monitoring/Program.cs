using System.Security.Cryptography;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Parsers.Kernel;

// One-off Windows x64 ET-01 evidence tool. It never enumerates or deletes cache content.
internal static class Program
{
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1) throw new ArgumentException("One absolute schema1 config path required");
            if (args[0] == "--self-test") { Audit.SelfTest(); Console.WriteLine("PID lifetime, explicit root instance selection and file-object close/reuse checks passed"); return 0; }
            var cp = SafePath(args[0]);
            using var configInput = new FileStream(cp, FileMode.Open, FileAccess.Read, FileShare.Read);
            var c = JsonSerializer.Deserialize<Config>(configInput, Json) ?? throw new ArgumentException("Empty config");
            Validate(c);
            using var etlInput = new FileStream(c.EtlPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (!Hash(etlInput).Equals(c.EtlSha256, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("ETL SHA256 mismatch");
            var configHash = Hash(configInput);
            using var output = new FileStream(c.OutputPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            try
            {
                var audit = new Audit(c);
                var report = audit.Run(configHash);
                JsonSerializer.Serialize(output, report, Json);
                Console.WriteLine(JsonSerializer.Serialize(new { report.DecodeComplete, report.CaptureComplete, report.UnusedClassificationEligible, report.EventsLost, report.UnknownEventCount, files = report.Files.Count }, Json));
                return report.DecodeComplete ? 0 : 2;
            }
            catch (Exception e)
            {
                output.Position = 0; output.SetLength(0);
                JsonSerializer.Serialize(output, new { schema = 1, decodeComplete = false, unusedClassificationEligible = false, error = e.ToString(), etlSha256 = c.EtlSha256, configSha256 = configHash }, Json);
                throw;
            }
        }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
    internal static string Hash(Stream s) { s.Position = 0; return Convert.ToHexString(SHA256.HashData(s)).ToLowerInvariant(); }
    internal static string SafePath(string p)
    {
        if (!Path.IsPathFullyQualified(p) || p.StartsWith(@"\\") || p.StartsWith(@"\\?\")) throw new ArgumentException("Absolute local path required: " + p);
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(p));
        var cursor = full;
        while (!string.IsNullOrEmpty(cursor))
        {
            if ((File.Exists(cursor) || Directory.Exists(cursor)) && (File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("Reparse boundary rejected: " + cursor);
            cursor = Path.GetDirectoryName(cursor);
        }
        return full;
    }
    internal static bool Within(string p, string root) => p.Equals(root, StringComparison.OrdinalIgnoreCase) || p.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
    static void Validate(Config c)
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess) throw new ArgumentException("Windows x64 process required");
        ValidateRootSelection(c);
        c.EtlPath = SafePath(c.EtlPath); c.ReportRoot = SafePath(c.ReportRoot); c.OutputPath = SafePath(c.OutputPath);
        if (!File.Exists(c.EtlPath) || !Regex.IsMatch(c.EtlSha256, "^[a-fA-F0-9]{64}$")) throw new ArgumentException("ETL file and expected SHA256 required");
        if (!Directory.Exists(c.ReportRoot) || !Directory.Exists(Path.GetDirectoryName(c.OutputPath)) || !Within(c.OutputPath, c.ReportRoot) || c.OutputPath == c.ReportRoot || Within(c.EtlPath, c.OutputPath)) throw new ArgumentException("Existing caller reportRoot and contained new output required");
        if (c.CacheRoots.Length == 0 || c.CacheRoots.Any(r => string.IsNullOrWhiteSpace(r.Id) || string.IsNullOrWhiteSpace(r.Kind)) || c.CacheRoots.Select(r => r.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != c.CacheRoots.Length) throw new ArgumentException("Unique identified cacheRoots required");
        foreach (var r in c.CacheRoots) r.Path = SafePath(r.Path);
        if (c.CacheRoots.Select(r => r.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != c.CacheRoots.Length) throw new ArgumentException("Duplicate root paths");
        c.DisallowedWarmRoots = c.DisallowedWarmRoots.Select(SafePath).ToArray();
        if (c.StageRoots.Any(s => s.Pid <= 0 || string.IsNullOrWhiteSpace(s.Purpose)) || c.StageRoots.Select(s => s.Pid).Distinct().Count() != c.StageRoots.Length) throw new ArgumentException("Invalid stageRoots");
        if ((c.CaptureResultPath is null) != (c.CaptureResultSha256 is null)) throw new ArgumentException("Capture path and SHA256 must be supplied together");
        if (c.CaptureResultPath is not null) c.CaptureResultPath = SafePath(c.CaptureResultPath);
    }
    internal static void ValidateRootSelection(Config c)
    {
        if (c.Schema != 1) throw new ArgumentException("schema1 required");
        if (c.RootInstances is not null)
        {
            if (c.RootPids.Length != 0 || c.RootInstances.Length == 0 || c.StageRoots.Length != 0) throw new ArgumentException("Nonempty rootInstances requires empty rootPids and stageRoots");
            foreach (var r in c.RootInstances)
                if (r is null || r.Pid <= 0 || ParseUtc(r.StartAfterUtc) > ParseUtc(r.StartBeforeUtc) || (r.Purpose is not null && string.IsNullOrWhiteSpace(r.Purpose))) throw new ArgumentException("Invalid root instance interval or purpose");
        }
        else if (c.RootPids.Length == 0 || c.RootPids.Any(p => p <= 0) || c.RootPids.Distinct().Count() != c.RootPids.Length) throw new ArgumentException("Unique positive rootPids required");
    }
    // Require explicit ISO UTC (Z or +00:00); retain all supplied precision up to
    // DateTime's 100ns ticks. Bounds are inclusive, with no rounding or tolerance.
    internal static DateTime ParseUtc(string value)
    {
        if (!Regex.IsMatch(value, @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|\+00:00)$") ||
            !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed) || parsed.Offset != TimeSpan.Zero)
            throw new ArgumentException("Explicit ISO UTC timestamp with at most 7 fractional digits required: " + value);
        return parsed.UtcDateTime;
    }
}
internal sealed class Config
{
    public int Schema { get; set; }
    public string EtlPath { get; set; } = "";
    public string EtlSha256 { get; set; } = "";
    public string ReportRoot { get; set; } = "";
    public string OutputPath { get; set; } = "";
    public int[] RootPids { get; set; } = [];
    public RootInstance[]? RootInstances { get; set; }
    public Root[] CacheRoots { get; set; } = [];
    public Stage[] StageRoots { get; set; } = [];
    public string[] DisallowedWarmRoots { get; set; } = [];
    public string? CaptureResultPath { get; set; }
    public string? CaptureResultSha256 { get; set; }
}
internal sealed class Root { public string Id { get; set; } = ""; public string Path { get; set; } = ""; public string Kind { get; set; } = ""; }
internal sealed class Stage { public int Pid { get; set; } public string Purpose { get; set; } = ""; }
internal sealed class RootInstance
{
    public int Pid { get; set; }
    public string StartAfterUtc { get; set; } = "";
    public string StartBeforeUtc { get; set; } = "";
    public string? Purpose { get; set; }
}
internal sealed class Proc
{
    public string Id => $"{Pid}@{StartMSec:R}";
    public int Pid { get; set; }
    public int ParentPid { get; set; }
    public string Name { get; set; } = "";
    public string CommandLine { get; set; } = "";
    public double StartMSec { get; set; }
    public double? StopMSec { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? StoppedAt { get; set; }
    public bool StopObserved { get; set; }
    public bool StartedInTrace { get; set; }
    public bool Tracked { get; set; }
    public bool AuditActor { get; set; }
    public string Purpose { get; set; } = "";
}
internal sealed class Counts
{
    public long Opens { get; set; } public long Reads { get; set; } public long Writes { get; set; }
    public long ReadBytes { get; set; } public long WriteBytes { get; set; } public long Closes { get; set; }
    public long Renames { get; set; } public long Queries { get; set; }
    public void Add(string op, long bytes) { switch(op) { case "open": Opens++; break; case "read": Reads++; ReadBytes += bytes; break; case "write": Writes++; WriteBytes += bytes; break; case "close": Closes++; break; case "rename": Renames++; break; case "query": Queries++; break; } }
}
internal sealed class FileRow
{
    public string Path { get; set; } = "";
    public string? RootId { get; set; }
    public string? RootKind { get; set; }
    public bool UnexpectedCacheShapedAccess { get; set; }
    public bool DisallowedWarmAccess { get; set; }
    public string Observation { get; set; } = "";
    public bool UnusedClassificationEligible { get; set; }
    public Counts Totals { get; } = new();
    public Dictionary<string, Counts> Consumers { get; } = new();
    public HashSet<string> FileObjects { get; } = new();
}
internal sealed class Report
{
    public int Schema => 1;
    public string Scope => "Per-run observed file operations only; no global-unused claim; no deletions or protection changes";
    public string EtlPath { get; set; } = "";
    public string EtlSha256 { get; set; } = "";
    public string ConfigSha256 { get; set; } = "";
    public string Decoder => typeof(ETWTraceEventSource).Assembly.FullName ?? "";
    public object AnalyzerIdentity => Identity(typeof(Program).Assembly.Location);
    public object DecoderIdentity => Identity(typeof(ETWTraceEventSource).Assembly.Location);
    static object Identity(string path) { using var s = File.OpenRead(path); return new { path, sha256 = Program.Hash(s), bytes = s.Length }; }
    public bool DecodeComplete { get; set; }
    public bool CaptureComplete { get; set; }
    public bool UnusedClassificationEligible { get; set; }
    public long EventsLost { get; set; }
    public long UnknownEventCount { get; set; }
    public long UnknownAuditEventCount { get; set; }
    public Dictionary<string, long> UnknownFunctionalByProcess { get; } = [];
    public Dictionary<string, long> UnknownAuditByProcess { get; } = [];
    public Dictionary<string, long> UnknownReadWriteByProcess { get; } = [];
    public List<object> UnknownEvents { get; } = [];
    public List<object> UnknownAuditEvents { get; } = [];
    public List<string> IncompleteReasons { get; } = [];
    public List<Proc> Processes { get; set; } = [];
    public List<FileRow> Files { get; set; } = [];
    public List<FileRow> AuditFiles { get; set; } = [];
    public List<object> RootObservations { get; set; } = [];
    public List<object> RootSelectionSummary { get; } = [];
    public long OutsideNonCacheEvents { get; set; }
}
internal sealed class Audit(Config c)
{
    readonly List<Proc> processes = [];
    readonly Dictionary<int, List<Proc>> byPid = [];
    readonly Dictionary<ulong, string> objects = [];
    readonly Dictionary<string, FileRow> files = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, FileRow> auditFiles = new(StringComparer.OrdinalIgnoreCase);
    readonly Report report = new() { EtlPath = c.EtlPath, EtlSha256 = c.EtlSha256 };
    static readonly Regex CacheShape = new(@"(^|[\\/])(\.?caches?|[^\\/]+-cache|cache-[^\\/]+|target|node_modules|\.cargo|registry|\.npm|\.bun)([\\/]|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    Proc? Find(int pid, double time) => byPid.TryGetValue(pid, out var list) ? list.LastOrDefault(p => p.StartMSec <= time && (p.StopMSec is null || time <= p.StopMSec)) : null;
    void AddProcess(Proc p) { processes.Add(p); if (!byPid.TryGetValue(p.Pid, out var list)) byPid[p.Pid] = list = []; list.Add(p); }
    void Start(ProcessTraceData e, bool actual)
    {
        var time = actual ? e.TimeStampRelativeMSec : 0;
        var previous = Find(e.ProcessID, time);
        if (previous is not null && (!actual || previous.StartMSec == time)) return;
        if (previous is not null) previous.StopMSec = Math.BitDecrement(time);
        var name = e.ImageFileName ?? "";
        var parent = Find(e.ParentID, time);
        var isRoot = c.RootInstances is null && c.RootPids.Contains(e.ProcessID) && !processes.Any(p => p.Pid == e.ProcessID && p.Tracked);
        var explicitStage = c.StageRoots.FirstOrDefault(s => s.Pid == e.ProcessID);
        AddProcess(new Proc { Pid = e.ProcessID, ParentPid = e.ParentID, Name = name, CommandLine = e.CommandLine ?? "", StartMSec = time, StartedAt = actual ? e.TimeStamp.ToUniversalTime() : null, StartedInTrace = actual,
            Tracked = isRoot || (parent?.Tracked ?? false), AuditActor = name.Contains("maintenance_owner", StringComparison.OrdinalIgnoreCase) || (explicitStage?.Purpose.StartsWith("audit", StringComparison.OrdinalIgnoreCase) ?? false) || (explicitStage?.Purpose.StartsWith("maintenance", StringComparison.OrdinalIgnoreCase) ?? false) || (parent?.AuditActor ?? false), Purpose = explicitStage?.Purpose ?? parent?.Purpose ?? (isRoot ? "root" : "unrelated") });
    }
    public Report Run(string configHash)
    {
        report.ConfigSha256 = configHash;
        using (var source = new ETWTraceEventSource(c.EtlPath))
        {
            source.Kernel.ProcessStart += e => Start(e, true);
            source.Kernel.ProcessDCStart += e => Start(e, false);
            source.Kernel.ProcessStop += e => { var p = Find(e.ProcessID, e.TimeStampRelativeMSec); if (p is not null) { p.StopMSec = e.TimeStampRelativeMSec; p.StopObserved = true; p.StoppedAt = e.TimeStamp.ToUniversalTime(); } };
            source.Process(); report.EventsLost = source.EventsLost;
        }
        SelectRoots();
        ResolveDescendants();
        CheckLegacyRoots();
        // A second streaming pass allows attribution of file events whose process rundown arrived later.
        using (var source = new ETWTraceEventSource(c.EtlPath))
        {
            source.Kernel.FileIOCreate += e => { OpenObject(e.FileObject, e.FileName); Observe(e.ProcessID, e.TimeStampRelativeMSec, e.FileObject, e.FileName, "open", 0); };
            source.Kernel.FileIORead += e => Observe(e.ProcessID, e.TimeStampRelativeMSec, e.FileObject, e.FileName, "read", e.IoSize);
            source.Kernel.FileIOWrite += e => Observe(e.ProcessID, e.TimeStampRelativeMSec, e.FileObject, e.FileName, "write", e.IoSize);
            source.Kernel.FileIOClose += e => { Observe(e.ProcessID, e.TimeStampRelativeMSec, e.FileObject, e.FileName, "close", 0); CloseObject(e.FileObject); };
            source.Kernel.FileIORename += e => Observe(e.ProcessID, e.TimeStampRelativeMSec, e.FileObject, e.FileName, "rename", 0);
            source.Kernel.FileIOQueryInfo += e => Observe(e.ProcessID, e.TimeStampRelativeMSec, e.FileObject, e.FileName, "query", 0);
            source.Process(); report.EventsLost = Math.Max(report.EventsLost, source.EventsLost);
        }
        if (report.EventsLost != 0) report.IncompleteReasons.Add("Lost ETW events");
        if (report.UnknownEventCount != 0) report.IncompleteReasons.Add("Unresolved tracked file operations");
        report.DecodeComplete = report.IncompleteReasons.Count == 0;
        if (c.CaptureResultPath is not null)
        {
            using var input = new FileStream(c.CaptureResultPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (!Program.Hash(input).Equals(c.CaptureResultSha256, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Capture result SHA256 mismatch");
            input.Position = 0;
            using var capture = JsonDocument.Parse(input);
            var r = capture.RootElement;
            report.CaptureComplete = r.GetProperty("schema").GetInt32() == 1 && r.GetProperty("completed").GetBoolean() && r.GetProperty("startExitCode").GetInt32() == 0 && r.GetProperty("stopExitCode").GetInt32() == 0 && r.GetProperty("etlPath").GetString() == c.EtlPath && r.GetProperty("etlSha256").GetString()!.Equals(c.EtlSha256, StringComparison.OrdinalIgnoreCase);
            if (report.CaptureComplete)
            {
                var ready = r.GetProperty("recordingReadyAt").GetDateTime().ToUniversalTime();
                var stopped = r.GetProperty("stoppedAt").GetDateTime().ToUniversalTime();
                if (processes.Where(p => p.Tracked && !p.AuditActor).Any(p => p.StartedAt is null || p.StoppedAt is null || p.StartedAt < ready || p.StoppedAt > stopped))
                { report.CaptureComplete = false; report.IncompleteReasons.Add("Functional process lifetime outside recording-ready/stop boundary"); }
            }
        }
        if (!report.CaptureComplete) report.IncompleteReasons.Add("No identity-bound successful capture handshake; capture coverage unproven");
        foreach (var p in processes.Where(p => p.Tracked && !p.AuditActor))
            if (!p.StartedInTrace || !p.StopObserved) report.IncompleteReasons.Add("Functional process lifetime not fully captured: " + p.Id);
        if (files.Values.Any(f => f.DisallowedWarmAccess)) report.IncompleteReasons.Add("Disallowed warm root accessed");
        if (files.Values.Any(f => f.UnexpectedCacheShapedAccess)) report.IncompleteReasons.Add("Cache-shaped access outside declared cache roots requires owner review");
        report.UnusedClassificationEligible = report.DecodeComplete && report.CaptureComplete && report.IncompleteReasons.Count == 0;
        report.Processes = processes.Where(p => p.Tracked).ToList();
        report.Files = Finish(files); report.AuditFiles = Finish(auditFiles);
        report.RootObservations = c.CacheRoots.Select(r => (object)new { r.Id, r.Path, r.Kind, observedFiles = report.Files.Count(f => f.RootId == r.Id), noObservedReadFiles = report.Files.Count(f => f.RootId == r.Id && f.Totals.Reads == 0), coverage = "Observed events only; files absent from this report are not globally unused", report.UnusedClassificationEligible }).ToList();
        return report;
    }
    void ResolveDescendants()
    {
        // Rundown identities can be delivered child-before-parent; resolve to a fixed point.
        for (var pass = 0; pass < processes.Count; pass++)
        {
            var changed = false;
            foreach (var p in processes.Where(p => !p.Tracked))
            {
                var parent = Find(p.ParentPid, p.StartMSec);
                if (parent is null || !parent.Tracked || parent == p) continue;
                p.Tracked = true; p.AuditActor |= parent.AuditActor;
                if (p.Purpose == "unrelated") p.Purpose = parent.Purpose;
                changed = true;
            }
            if (!changed) break;
        }
    }
    void SelectRoots()
    {
        if (c.RootInstances is null) return;
        foreach (var p in processes)
        {
            p.Tracked = false;
            p.Purpose = "unrelated";
            p.AuditActor = p.Name.Contains("maintenance_owner", StringComparison.OrdinalIgnoreCase);
        }
        var selected = new HashSet<Proc>();
        foreach (var r in c.RootInstances)
        {
            var after = Program.ParseUtc(r.StartAfterUtc);
            var before = Program.ParseUtc(r.StartBeforeUtc);
            var candidates = processes.Where(p => p.Pid == r.Pid).ToArray();
            var matches = candidates.Where(p => p.StartedInTrace && p.StartedAt is not null && p.StartedAt >= after && p.StartedAt <= before).ToArray();
            var root = matches.Length == 1 ? matches[0] : null;
            var duplicate = root is not null && !selected.Add(root);
            var reason = duplicate ? "Same process instance selected more than once" : matches.Length == 1 ? "Exactly one actual ETW process start in inclusive UTC interval" : "Expected exactly one actual ETW process start in inclusive UTC interval; found " + matches.Length;
            report.RootSelectionSummary.Add(new { mode = "rootInstances", r.Pid, r.StartAfterUtc, r.StartBeforeUtc, r.Purpose, selectedId = duplicate ? null : root?.Id, reason,
                precision = "UTC DateTime 100ns ticks; inclusive bounds; no tolerance or rounding", candidates = candidates.Select(p => new { p.Id, startUtc = p.StartedAt, p.StartedInTrace, image = p.Name, p.CommandLine, inInterval = matches.Contains(p) }).ToArray() });
            if (root is null || duplicate) { report.IncompleteReasons.Add("Root instance selection failed for PID " + r.Pid + ": " + reason); continue; }
            root.Tracked = true;
            root.Purpose = r.Purpose ?? "root";
            root.AuditActor |= IsAuditPurpose(root.Purpose);
        }
    }
    static bool IsAuditPurpose(string purpose) => purpose.StartsWith("audit", StringComparison.OrdinalIgnoreCase) || purpose.StartsWith("maintenance", StringComparison.OrdinalIgnoreCase);
    void CheckLegacyRoots()
    {
        if (c.RootInstances is not null) return;
        foreach (var pid in c.RootPids)
        {
            if (!processes.Any(p => p.Pid == pid && p.Tracked)) report.IncompleteReasons.Add("Missing root process identity: " + pid);
            if (processes.Count(p => p.Pid == pid) > 1) report.IncompleteReasons.Add("Root PID reused; ambiguous config identity: " + pid);
        }
    }
    void OpenObject(ulong pointer, string? name) { objects.Remove(pointer); if (!string.IsNullOrEmpty(name)) objects[pointer] = name; }
    void CloseObject(ulong pointer) => objects.Remove(pointer);
    internal static void SelfTest()
    {
        var a = new Audit(new Config());
        var first = new Proc { Pid = 17, StartMSec = 1, StopMSec = 4, Tracked = true };
        var reused = new Proc { Pid = 17, StartMSec = 5, StopMSec = 8, Tracked = false };
        a.AddProcess(first); a.AddProcess(reused);
        if (a.Find(17, 2) != first || a.Find(17, 6) != reused || a.Find(17, 4.5) is not null || a.Find(17, 9) is not null) throw new Exception("PID lifetime isolation failed");
        a.OpenObject(0xFFFF000000000001UL, @"C:\first"); a.CloseObject(0xFFFF000000000001UL);
        if (a.objects.Count != 0) throw new Exception("File object close retained stale mapping");
        a.OpenObject(1, @"C:\first"); a.OpenObject(1, null);
        if (a.objects.ContainsKey(1)) throw new Exception("File object reuse inherited stale name");
        a.OpenObject(1, @"C:\second");
        if (a.objects[1] != @"C:\second") throw new Exception("File object replacement failed");
        var utc = Program.ParseUtc("2026-10-30T10:18:00.1234567Z");
        Audit Selection(string after, string before, string? purpose = null)
        {
            var config = new Config { Schema = 1, RootInstances = [new() { Pid = 17, StartAfterUtc = after, StartBeforeUtc = before, Purpose = purpose }] };
            Program.ValidateRootSelection(config);
            var test = new Audit(config);
            test.AddProcess(new Proc { Pid = 17, StartMSec = 1, StopMSec = 4, StartedInTrace = true, StartedAt = utc.AddTicks(-1), Name = "earlier" });
            test.AddProcess(new Proc { Pid = 17, StartMSec = 5, StopMSec = 8, StartedInTrace = true, StartedAt = utc, Name = "selected" });
            test.AddProcess(new Proc { Pid = 17, StartMSec = 9, StopMSec = 12, StartedInTrace = true, StartedAt = utc.AddTicks(1), Name = "later" });
            test.AddProcess(new Proc { Pid = 18, ParentPid = 17, StartMSec = 6, StopMSec = 7, Name = "selected child" });
            test.AddProcess(new Proc { Pid = 19, ParentPid = 17, StartMSec = 10, StopMSec = 11, Name = "unselected child" });
            test.SelectRoots(); test.ResolveDescendants(); test.CheckLegacyRoots();
            return test;
        }
        const string bound = "2026-10-30T10:18:00.1234567Z";
        var unique = Selection(bound, bound, "audit-controller");
        if (unique.report.IncompleteReasons.Count != 0 || unique.processes.Count(p => p.Tracked) != 2 ||
            unique.processes.Any(p => p.Tracked && (!p.AuditActor || p.Purpose != "audit-controller")) ||
            unique.processes.Any(p => !p.Tracked && (p.AuditActor || p.Purpose != "unrelated"))) throw new Exception("Explicit root instance/purpose isolation failed");
        unique.Observe(17, 2, 0, @"C:\cache\before", "read", 1);
        unique.Observe(17, 6, 0, @"C:\cache\selected", "read", 1);
        unique.Observe(17, 10, 0, @"C:\cache\after", "read", 1);
        if (unique.files.Count != 0 || unique.auditFiles.Count != 1 || !unique.auditFiles.ContainsKey(@"C:\cache\selected")) throw new Exception("Explicit root file attribution crossed PID lifetime");
        using (var summary = JsonDocument.Parse(JsonSerializer.Serialize(unique.report.RootSelectionSummary, Program.Json)))
        {
            var row = summary.RootElement[0];
            if (row.GetProperty("selectedId").GetString() != "17@5" || row.GetProperty("candidates").GetArrayLength() != 3 || row.GetProperty("startAfterUtc").GetString() != bound) throw new Exception("Explicit root selection evidence missing");
        }
        var none = Selection("2026-10-30T10:18:01Z", "2026-10-30T10:18:02Z");
        var multiple = Selection("2026-10-30T10:18:00.1234566Z", bound);
        foreach (var failed in new[] { none, multiple })
            if (failed.report.IncompleteReasons.Count == 0 || failed.processes.Any(p => p.Tracked) || failed.report.DecodeComplete || failed.report.UnusedClassificationEligible) throw new Exception("Ambiguous/missing root did not fail closed");
        var rundown = Selection(bound, bound);
        foreach (var p in rundown.processes) p.StartedInTrace = false;
        rundown.report.IncompleteReasons.Clear(); rundown.SelectRoots();
        if (rundown.report.IncompleteReasons.Count == 0 || rundown.processes.Any(p => p.Tracked)) throw new Exception("Rundown selected as actual root start");
        void Reject(Config config)
        {
            try { Program.ValidateRootSelection(config); }
            catch (ArgumentException) { return; }
            throw new Exception("Invalid root selection config accepted");
        }
        foreach (var invalid in new[] { "2026-10-30T10:18:00", "2026-10-30T10:18:00+09:00", "2026-10-30T10:18:00.12345678Z", "2026-02-30T00:00:00Z" })
            Reject(new Config { Schema = 1, RootInstances = [new() { Pid = 17, StartAfterUtc = invalid, StartBeforeUtc = bound }] });
        Reject(new Config { Schema = 1, RootInstances = [new() { Pid = 17, StartAfterUtc = "2026-10-30T10:18:01Z", StartBeforeUtc = bound }] });
        Reject(new Config { Schema = 1, RootPids = [17], RootInstances = [new() { Pid = 17, StartAfterUtc = bound, StartBeforeUtc = bound }] });
        Reject(new Config { Schema = 1, StageRoots = [new() { Pid = 17, Purpose = "audit" }], RootInstances = [new() { Pid = 17, StartAfterUtc = bound, StartBeforeUtc = bound }] });
        Reject(new Config { Schema = 1, RootInstances = [] });
        if (Program.ParseUtc("2026-10-30T10:18:00.1234567+00:00") != utc) throw new Exception("UTC tick precision changed");
        var legacyConfig = new Config { Schema = 1, RootPids = [17] };
        Program.ValidateRootSelection(legacyConfig);
        var legacy = new Audit(legacyConfig);
        legacy.AddProcess(first); legacy.AddProcess(reused); legacy.CheckLegacyRoots();
        if (!legacy.report.IncompleteReasons.Contains("Root PID reused; ambiguous config identity: 17")) throw new Exception("Legacy PID reuse guard lost");
    }
    List<FileRow> Finish(Dictionary<string, FileRow> rows)
    {
        foreach (var f in rows.Values)
        {
            f.Observation = f.Totals.Reads > 0 ? "observed-read" : f.Totals.Writes > 0 ? "written-no-observed-read" : f.Totals.Opens > 0 ? "opened-no-observed-read" : "metadata-only-no-observed-read";
            f.UnusedClassificationEligible = report.UnusedClassificationEligible && f.RootId is not null;
        }
        return rows.Values.OrderBy(f => f.Path, StringComparer.OrdinalIgnoreCase).ToList();
    }
    void Observe(int pid, double time, ulong obj, string? name, string op, long bytes)
    {
        var p = Find(pid, time); if (p is null || !p.Tracked) return;
        if (string.IsNullOrEmpty(name)) objects.TryGetValue(obj, out name);
        var pointer = "0x" + obj.ToString("X");
        if (string.IsNullOrEmpty(name) || !Path.IsPathFullyQualified(name))
        {
            if (!p.AuditActor) report.UnknownEventCount++; else report.UnknownAuditEventCount++;
            var unknownCounts = p.AuditActor ? report.UnknownAuditByProcess : report.UnknownFunctionalByProcess;
            unknownCounts[p.Id] = unknownCounts.GetValueOrDefault(p.Id) + 1;
            if (!p.AuditActor && (op == "read" || op == "write")) report.UnknownReadWriteByProcess[p.Id] = report.UnknownReadWriteByProcess.GetValueOrDefault(p.Id) + 1;
            var samples = p.AuditActor ? report.UnknownAuditEvents : report.UnknownEvents;
            if (samples.Count < 256) samples.Add(new { process = p.Id, p.AuditActor, timeMSec = time, fileObject = pointer, operation = op, bytes, unresolvedName = name });
            return;
        }
        name = Path.GetFullPath(name).TrimEnd('\\');
        var root = c.CacheRoots.Where(r => Program.Within(name, r.Path)).OrderByDescending(r => r.Path.Length).FirstOrDefault();
        var warm = c.DisallowedWarmRoots.Any(r => Program.Within(name, r));
        var shaped = root is null && CacheShape.IsMatch(name);
        if (root is null && !warm && !shaped) { report.OutsideNonCacheEvents++; return; }
        var rows = p.AuditActor ? auditFiles : files;
        if (!rows.TryGetValue(name, out var f)) rows[name] = f = new FileRow { Path = name, RootId = root?.Id, RootKind = root?.Kind, UnexpectedCacheShapedAccess = shaped, DisallowedWarmAccess = warm };
        f.Totals.Add(op, bytes); f.FileObjects.Add(pointer);
        if (!f.Consumers.TryGetValue(p.Id, out var counts)) f.Consumers[p.Id] = counts = new Counts();
        counts.Add(op, bytes);
    }
}
