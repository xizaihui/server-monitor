package main

import (
    "bufio"
    "bytes"
    "context"
    "crypto/sha1"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net"
    "net/http"
    "os"
    osExec "os/exec"
    "runtime"
    "strconv"
    "strings"
    "syscall"
    "time"
)

type Payload struct {
    ServerID     string            `json:"server_id"`
    Hostname     string            `json:"hostname"`
    DisplayName  string            `json:"display_name"`
    IP           string            `json:"ip"`
    OS           string            `json:"os"`
    Arch         string            `json:"arch"`
    InstanceID   string            `json:"instance_id"`
    CPUUsage     float64           `json:"cpu_usage"`
    CPUCount     int               `json:"cpu_count"`
    MemoryUsage  float64           `json:"memory_usage"`
    MemoryUsed   uint64            `json:"memory_used"`
    MemoryTotal  uint64            `json:"memory_total"`
    DiskUsage    float64           `json:"disk_usage"`
    DiskUsed     uint64            `json:"disk_used"`
    DiskTotal    uint64            `json:"disk_total"`
    Ports        map[string]bool   `json:"ports"`
    Metadata     map[string]string `json:"metadata"`
    Diagnostics  *Diagnostics      `json:"diagnostics,omitempty"`
}

type DiagEntry struct {
    Name  string  `json:"name"`
    Value string  `json:"value"`
    Size  string  `json:"size,omitempty"`
    PID   string  `json:"pid,omitempty"`
    Usage float64 `json:"usage"`
}

type Diagnostics struct {
    DiskTop  []DiagEntry `json:"disk_top,omitempty"`
    CPUTop   []DiagEntry `json:"cpu_top,omitempty"`
    MemTop   []DiagEntry `json:"mem_top,omitempty"`
    DiskMounts []DiagEntry `json:"disk_mounts,omitempty"`
    CollectedAt string  `json:"collected_at"`
}

type ActionTask struct {
    TaskID         string                 `json:"task_id"`
    ActionKey      string                 `json:"action_key"`
    Params         map[string]interface{} `json:"params"`
    TimeoutSeconds int                    `json:"timeout_seconds"`
    LeaseToken     string                 `json:"lease_token"`
}

type FetchTaskResponse struct {
    Ok   bool        `json:"ok"`
    Task *ActionTask `json:"task"`
}

type TaskResult struct {
    ServerID      string `json:"server_id"`
    LeaseToken    string `json:"lease_token"`
    Status        string `json:"status"`
    ExitCode      int    `json:"exit_code"`
    ResultCode    string `json:"result_code"`
    ResultSummary string `json:"result_summary"`
    LogExcerpt    string `json:"log_excerpt"`
    ErrorMessage  string `json:"error_message,omitempty"`
}

type ActionDef struct {
    ScriptPath string
    TimeoutSec int
    ParamOrder []string
}

var actionRegistry = map[string]ActionDef{
    "update_xcore": {
        ScriptPath: "/opt/core-service/scripts/update_xcore.sh",
        TimeoutSec: 300,
        ParamOrder: []string{},
    },
    "restart_xagent": {
        ScriptPath: "/opt/core-service/scripts/restart_xagent.sh",
        TimeoutSec: 120,
        ParamOrder: []string{},
    },
    "restart_xbridge": {
        ScriptPath: "/opt/core-service/scripts/restart_xbridge.sh",
        TimeoutSec: 120,
        ParamOrder: []string{},
    },
    "restart_redis": {
        ScriptPath: "/opt/core-service/scripts/restart_redis.sh",
        TimeoutSec: 120,
        ParamOrder: []string{},
    },
    "install_redis": {
        ScriptPath: "/opt/core-service/scripts/install_redis.sh",
        TimeoutSec: 600,
        ParamOrder: []string{},
    },
    "apply_cert": {
        ScriptPath: "/opt/core-service/scripts/apply_cert.sh",
        TimeoutSec: 600,
        ParamOrder: []string{"server_ip"},
    },
    "init_ops_scripts": {
        ScriptPath: "/opt/core-service/scripts/init_ops_scripts.sh",
        TimeoutSec: 600,
        ParamOrder: []string{"ops_scripts_url"},
    },
    "install_ixvpn": {
        ScriptPath: "/opt/core-service/scripts/install_ixvpn.sh",
        TimeoutSec: 600,
        ParamOrder: []string{"server_id", "xagent_download_url", "server_ip"},
    },
    "install_xnftables": {
        ScriptPath: "/opt/core-service/scripts/install_xnftables.sh",
        TimeoutSec: 600,
        ParamOrder: []string{"server_id", "download_url"},
    },
}

func main() {
    apiBase := getEnv("MONITOR_API", "http://127.0.0.1:8080")
    intervalSec := getEnvInt("REPORT_INTERVAL", 10)
    displayName := getEnv("DISPLAY_NAME", "")
    hostname, _ := os.Hostname()
    stableID := machineStableID(hostname)

    go taskLoop(apiBase, stableID)

    for {
        payload, err := collect(displayName, intervalSec)
        if err != nil {
            fmt.Println("collect error:", err)
        } else {
            if err := report(apiBase+"/api/agent/register", payload); err != nil {
                fmt.Println("report error:", err)
            } else {
                fmt.Println("reported:", payload.ServerID, time.Now().Format(time.RFC3339))
            }
        }
        time.Sleep(time.Duration(intervalSec) * time.Second)
    }
}

func taskLoop(apiBase string, serverID string) {
    for {
        task, err := fetchNextTask(apiBase, serverID)
        if err != nil {
            fmt.Println("fetchNextTask error:", err)
            time.Sleep(5 * time.Second)
            continue
        }
        if task == nil {
            time.Sleep(5 * time.Second)
            continue
        }
        fmt.Println("task received:", task.TaskID, task.ActionKey)
        if err := reportTaskStart(apiBase, serverID, task.TaskID, task.LeaseToken); err != nil {
            fmt.Println("reportTaskStart error:", err)
            time.Sleep(3 * time.Second)
            continue
        }
        result := executeTask(serverID, *task)
        if err := reportTaskResult(apiBase, task.TaskID, result); err != nil {
            fmt.Println("reportTaskResult error:", err)
        }
    }
}

func fetchNextTask(apiBase string, serverID string) (*ActionTask, error) {
    caps := make([]string, 0, len(actionRegistry))
    for key := range actionRegistry { caps = append(caps, key) }
    body := map[string]interface{}{"server_id": serverID, "agent_version": "1.5.0", "capabilities": caps}
    raw, _ := json.Marshal(body)
    req, err := http.NewRequest(http.MethodPost, apiBase+"/api/agent/tasks/next", bytes.NewReader(raw))
    if err != nil { return nil, err }
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 8 * time.Second}
    resp, err := client.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 { return nil, fmt.Errorf("unexpected status %d", resp.StatusCode) }
    var result FetchTaskResponse
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil { return nil, err }
    if !result.Ok || result.Task == nil { return nil, nil }
    return result.Task, nil
}

func reportTaskStart(apiBase, serverID, taskID, leaseToken string) error {
    body := map[string]interface{}{"server_id": serverID, "lease_token": leaseToken}
    raw, _ := json.Marshal(body)
    req, err := http.NewRequest(http.MethodPost, apiBase+"/api/agent/tasks/"+taskID+"/start", bytes.NewReader(raw))
    if err != nil { return err }
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 8 * time.Second}
    resp, err := client.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 { data, _ := io.ReadAll(resp.Body); return fmt.Errorf("start status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(data))) }
    return nil
}

func reportTaskResult(apiBase, taskID string, result TaskResult) error {
    raw, _ := json.Marshal(result)
    req, err := http.NewRequest(http.MethodPost, apiBase+"/api/agent/tasks/"+taskID+"/result", bytes.NewReader(raw))
    if err != nil { return err }
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 10 * time.Second}
    resp, err := client.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 { data, _ := io.ReadAll(resp.Body); return fmt.Errorf("result status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(data))) }
    return nil
}

func executeTask(serverID string, task ActionTask) TaskResult {
    if task.ActionKey == "init_ops_scripts" {
        return executeInitOpsScripts(serverID, task)
    }
    def, ok := actionRegistry[task.ActionKey]
    if !ok {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: -1, ResultCode: "unsupported_action", ResultSummary: "action not supported by this agent", ErrorMessage: "unsupported action"}
    }
    args := make([]string, 0, len(def.ParamOrder))
    for _, key := range def.ParamOrder {
        val, exists := task.Params[key]
        if !exists {
            return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: -1, ResultCode: "missing_param", ResultSummary: "missing required param: " + key, ErrorMessage: "missing param"}
        }
        args = append(args, fmt.Sprintf("%v", val))
    }
    if _, err := os.Stat(def.ScriptPath); err != nil {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: -1, ResultCode: "script_not_found", ResultSummary: "script file not found", ErrorMessage: err.Error()}
    }
    timeout := task.TimeoutSeconds
    if timeout <= 0 { timeout = def.TimeoutSec }
    ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
    defer cancel()
    cmd := osExec.CommandContext(ctx, def.ScriptPath, args...)
    var output bytes.Buffer
    cmd.Stdout = &output
    cmd.Stderr = &output
    err := cmd.Run()
    logs := output.String()
    if len(logs) > 8000 { logs = logs[len(logs)-8000:] }
    if ctx.Err() == context.DeadlineExceeded {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "timeout", ExitCode: -1, ResultCode: "timeout", ResultSummary: "任务执行超时", LogExcerpt: logs, ErrorMessage: "task timeout"}
    }
    if err != nil {
        exitCode := 1
        if ee, ok := err.(*osExec.ExitError); ok { exitCode = ee.ExitCode() }
        resultCode := "script_failed"
        resultSummary := "脚本执行失败"
        lowerLogs := strings.ToLower(logs)
        switch {
        case strings.Contains(lowerLogs, "unit xagent.service not found"):
            resultCode = "service_not_found"
            resultSummary = "xagent 服务不存在"
        case strings.Contains(lowerLogs, "unit xvpn-bridge-server.service not found"):
            resultCode = "service_not_found"
            resultSummary = "xbridge 服务不存在"
        case strings.Contains(lowerLogs, "failed to restart") && strings.Contains(lowerLogs, "xagent.service"):
            resultCode = "service_restart_failed"
            resultSummary = "xagent 服务重启失败"
        case strings.Contains(lowerLogs, "failed to restart") && strings.Contains(lowerLogs, "xvpn-bridge-server"):
            resultCode = "service_restart_failed"
            resultSummary = "xbridge 服务重启失败"
        case strings.Contains(lowerLogs, "port 8888 not listening"):
            resultCode = "port_not_ready"
            resultSummary = "xagent 端口 8888 未就绪"
        case strings.Contains(lowerLogs, "port 8789 not listening"):
            resultCode = "port_not_ready"
            resultSummary = "xbridge 端口 8789 未就绪"
        case strings.Contains(lowerLogs, "failed to start xagent.service"):
            resultCode = "service_start_failed"
            resultSummary = "xagent 服务启动失败"
        }
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: exitCode, ResultCode: resultCode, ResultSummary: resultSummary, LogExcerpt: logs, ErrorMessage: err.Error()}
    }
    return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "success", ExitCode: 0, ResultCode: "ok", ResultSummary: "任务执行成功", LogExcerpt: logs}
}

func executeInitOpsScripts(serverID string, task ActionTask) TaskResult {
    urlVal, ok := task.Params["ops_scripts_url"]
    if !ok || strings.TrimSpace(fmt.Sprint(urlVal)) == "" {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: -1, ResultCode: "missing_param", ResultSummary: "missing required param: ops_scripts_url", ErrorMessage: "missing param"}
    }

    opsURL := strings.TrimSpace(fmt.Sprint(urlVal))
    targetDir := "/opt/core-service/scripts"
    currentVersion := readVersionFile(targetDir + "/VERSION")
    backupRoot := "/opt/core-service/backups"
    stamp := time.Now().Format("2006-01-02-150405")
    pkgPath := "/tmp/ops-scripts.zip"
    extractDir := "/tmp/ops-scripts-extract"

    _ = os.Remove(pkgPath)
    _ = os.RemoveAll(extractDir)
    _ = os.MkdirAll(targetDir, 0o755)
    _ = os.MkdirAll(backupRoot, 0o755)

    resp, err := http.Get(opsURL)
    if err != nil {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: -1, ResultCode: "download_failed", ResultSummary: "下载脚本包失败", ErrorMessage: err.Error()}
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: resp.StatusCode, ResultCode: "download_failed", ResultSummary: "下载脚本包失败", ErrorMessage: fmt.Sprintf("unexpected status %d", resp.StatusCode)}
    }

    out, err := os.Create(pkgPath)
    if err != nil {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: -1, ResultCode: "write_failed", ResultSummary: "写入脚本包失败", ErrorMessage: err.Error()}
    }
    if _, err := io.Copy(out, resp.Body); err != nil {
        out.Close()
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: -1, ResultCode: "write_failed", ResultSummary: "写入脚本包失败", ErrorMessage: err.Error()}
    }
    out.Close()

    if hasFiles(targetDir) {
        backupDir := fmt.Sprintf("%s/scripts-%s", backupRoot, stamp)
        if err := os.MkdirAll(backupDir, 0o755); err == nil {
            _, _ = runCommand(120, "bash", "-lc", fmt.Sprintf("cp -a %s/. %s/", shellEscape(targetDir), shellEscape(backupDir)))
        }
    }

    if _, err := runCommand(120, "unzip", "-qo", pkgPath, "-d", extractDir); err != nil {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: 1, ResultCode: "extract_failed", ResultSummary: "解压脚本包失败", ErrorMessage: err.Error()}
    }

    newVersion := readVersionFile(extractDir + "/scripts/VERSION")
    if currentVersion != "" && newVersion != "" && currentVersion == newVersion {
        _ = os.Remove(pkgPath)
        _ = os.RemoveAll(extractDir)
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "success", ExitCode: 0, ResultCode: "already_current", ResultSummary: "脚本版本已是最新", LogExcerpt: fmt.Sprintf("ops scripts version %s already current", currentVersion)}
    }

    if _, err := runCommand(120, "bash", "-lc", fmt.Sprintf("mkdir -p %s && cp -a %s/scripts/. %s/ && find %s -maxdepth 1 -type f -name '*.sh' -exec chmod 755 {} \\;", shellEscape(targetDir), shellEscape(extractDir), shellEscape(targetDir), shellEscape(targetDir))); err != nil {
        return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "failed", ExitCode: 1, ResultCode: "deploy_failed", ResultSummary: "部署脚本失败", ErrorMessage: err.Error()}
    }

    _ = os.Remove(pkgPath)
    _ = os.RemoveAll(extractDir)

    return TaskResult{ServerID: serverID, LeaseToken: task.LeaseToken, Status: "success", ExitCode: 0, ResultCode: "ok", ResultSummary: "脚本初始化成功", LogExcerpt: fmt.Sprintf("ops scripts initialized from %s to %s", opsURL, targetDir)}
}

func hasFiles(dir string) bool {
    entries, err := os.ReadDir(dir)
    if err != nil {
        return false
    }
    for _, entry := range entries {
        if !entry.IsDir() {
            return true
        }
    }
    return false
}

func runCommand(timeoutSec int, name string, args ...string) (string, error) {
    ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
    defer cancel()
    cmd := osExec.CommandContext(ctx, name, args...)
    var buf bytes.Buffer
    cmd.Stdout = &buf
    cmd.Stderr = &buf
    err := cmd.Run()
    if ctx.Err() == context.DeadlineExceeded {
        return buf.String(), fmt.Errorf("timeout")
    }
    if err != nil {
        return buf.String(), fmt.Errorf(strings.TrimSpace(buf.String()))
    }
    return buf.String(), nil
}

func shellEscape(s string) string {
    return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func collect(displayName string, intervalSec int) (*Payload, error) {
    hostname, _ := os.Hostname()
    ip := publicIP()
    if strings.TrimSpace(ip) == "" { ip = firstIP() }
    id := machineStableID(hostname)
    instanceID := readInstanceID("/opt/core-service/xagent-server/etc/xagent.yaml")
    opsVersion := readVersionFile("/opt/core-service/scripts/VERSION")
    cpu1, err := readCPUStat()
    if err != nil { return nil, err }
    time.Sleep(500 * time.Millisecond)
    cpu2, err := readCPUStat()
    if err != nil { return nil, err }
    cpuUsage := calculateCPU(cpu1, cpu2)
    memTotal, memAvail, err := readMemInfo()
    if err != nil { return nil, err }
    memUsed := memTotal - memAvail
    memUsage := percent(memUsed, memTotal)
    diskTotal, diskUsed, err := readDiskUsage("/")
    if err != nil { return nil, err }
    diskUsage := percent(diskUsed, diskTotal)
    ports := map[string]bool{}
    for _, p := range []string{"443", "6379", "8888", "8789"} { ports[p] = checkPort("127.0.0.1:" + p) }

    // Collect diagnostics when thresholds exceeded
    var diag *Diagnostics
    needDiag := cpuUsage > 80 || memUsage > 85 || diskUsage > 55
    if needDiag {
        diag = collectDiagnostics(cpuUsage > 80, memUsage > 85, diskUsage > 55)
    }

    return &Payload{ServerID: id, Hostname: hostname, DisplayName: fallback(displayName, hostname), IP: ip, OS: runtime.GOOS, Arch: runtime.GOARCH, InstanceID: instanceID, CPUUsage: cpuUsage, CPUCount: runtime.NumCPU(), MemoryUsage: memUsage, MemoryUsed: memUsed, MemoryTotal: memTotal, DiskUsage: diskUsage, DiskUsed: diskUsed, DiskTotal: diskTotal, Ports: ports, Metadata: map[string]string{"agent_version": "1.7.0", "report_interval": strconv.Itoa(intervalSec), "ops_scripts_version": opsVersion}, Diagnostics: diag}, nil
}

func collectDiagnostics(cpuAlert, memAlert, diskAlert bool) *Diagnostics {
    diag := &Diagnostics{CollectedAt: time.Now().Format(time.RFC3339)}

    if diskAlert {
        diag.DiskTop = collectDiskTop()
        diag.DiskMounts = collectDiskMounts()
    }
    if cpuAlert {
        diag.CPUTop = collectProcessTop("cpu")
    }
    if memAlert {
        diag.MemTop = collectProcessTop("mem")
    }

    return diag
}

func collectDiskTop() []DiagEntry {
    // Find top 5 largest directories under / (excluding virtual filesystems)
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    cmd := osExec.CommandContext(ctx, "du", "-x", "--max-depth=2", "-B1", "/")
    var out bytes.Buffer
    cmd.Stdout = &out
    cmd.Stderr = nil
    _ = cmd.Run()

    type entry struct {
        size uint64
        path string
    }
    var entries []entry
    scanner := bufio.NewScanner(&out)
    for scanner.Scan() {
        line := scanner.Text()
        fields := strings.Fields(line)
        if len(fields) < 2 { continue }
        size, err := strconv.ParseUint(fields[0], 10, 64)
        if err != nil { continue }
        path := fields[1]
        if path == "/" { continue }
        // Skip virtual filesystems
        if strings.HasPrefix(path, "/proc") || strings.HasPrefix(path, "/sys") || strings.HasPrefix(path, "/dev") || strings.HasPrefix(path, "/run") { continue }
        entries = append(entries, entry{size: size, path: path})
    }

    // Sort descending
    for i := 0; i < len(entries); i++ {
        for j := i + 1; j < len(entries); j++ {
            if entries[j].size > entries[i].size {
                entries[i], entries[j] = entries[j], entries[i]
            }
        }
    }

    limit := 5
    if len(entries) < limit { limit = len(entries) }
    result := make([]DiagEntry, 0, limit)
    for _, e := range entries[:limit] {
        result = append(result, DiagEntry{
            Name:  e.path,
            Size:  formatBytes(e.size),
            Usage: float64(e.size),
        })
    }
    return result
}

func collectDiskMounts() []DiagEntry {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    cmd := osExec.CommandContext(ctx, "df", "-h", "--output=target,size,used,pcent")
    var out bytes.Buffer
    cmd.Stdout = &out
    cmd.Stderr = nil
    _ = cmd.Run()

    var entries []DiagEntry
    scanner := bufio.NewScanner(&out)
    first := true
    for scanner.Scan() {
        if first { first = false; continue } // skip header
        line := scanner.Text()
        fields := strings.Fields(line)
        if len(fields) < 4 { continue }
        mount := fields[0]
        if strings.HasPrefix(mount, "/dev") && !strings.HasPrefix(mount, "/dev/") { continue }
        pctStr := strings.TrimSuffix(fields[3], "%")
        pct, _ := strconv.ParseFloat(pctStr, 64)
        entries = append(entries, DiagEntry{
            Name:  mount,
            Value: fmt.Sprintf("总量 %s / 已用 %s / %s%%", fields[1], fields[2], pctStr),
            Usage: pct,
        })
    }
    return entries
}

func collectProcessTop(mode string) []DiagEntry {
    // Use ps to get top 5 processes by CPU or memory
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    var sortField string
    if mode == "cpu" {
        sortField = "-pcpu"
    } else {
        sortField = "-rss"
    }
    cmd := osExec.CommandContext(ctx, "ps", "aux", "--sort="+sortField)
    var out bytes.Buffer
    cmd.Stdout = &out
    cmd.Stderr = nil
    _ = cmd.Run()

    var entries []DiagEntry
    scanner := bufio.NewScanner(&out)
    first := true
    count := 0
    for scanner.Scan() {
        if first { first = false; continue } // skip header
        if count >= 5 { break }
        line := scanner.Text()
        fields := strings.Fields(line)
        if len(fields) < 11 { continue }
        pid := fields[1]
        cpuPct := fields[2]
        memPct := fields[3]
        rss := fields[5]
        cmdName := strings.Join(fields[10:], " ")
        // Truncate long command
        if len(cmdName) > 80 { cmdName = cmdName[:80] + "..." }

        var usageVal float64
        if mode == "cpu" {
            usageVal, _ = strconv.ParseFloat(cpuPct, 64)
            entries = append(entries, DiagEntry{
                Name:  cmdName,
                PID:   pid,
                Value: fmt.Sprintf("CPU: %s%%  MEM: %s%%  RSS: %sKB", cpuPct, memPct, rss),
                Usage: usageVal,
            })
        } else {
            usageVal, _ = strconv.ParseFloat(memPct, 64)
            rssKB, _ := strconv.ParseUint(rss, 10, 64)
            entries = append(entries, DiagEntry{
                Name:  cmdName,
                PID:   pid,
                Value: fmt.Sprintf("MEM: %s%%  RSS: %s  CPU: %s%%", memPct, formatBytes(rssKB*1024), cpuPct),
                Usage: usageVal,
            })
        }
        count++
    }
    return entries
}

func formatBytes(b uint64) string {
    const (
        KB = 1024
        MB = 1024 * KB
        GB = 1024 * MB
    )
    switch {
    case b >= GB:
        return fmt.Sprintf("%.1fGB", float64(b)/float64(GB))
    case b >= MB:
        return fmt.Sprintf("%.1fMB", float64(b)/float64(MB))
    case b >= KB:
        return fmt.Sprintf("%.0fKB", float64(b)/float64(KB))
    default:
        return fmt.Sprintf("%dB", b)
    }
}

type cpuStat struct { idle, total uint64 }
func readCPUStat() (cpuStat, error) { data, err := os.ReadFile("/proc/stat"); if err != nil { return cpuStat{}, err }; scanner := bufio.NewScanner(bytes.NewReader(data)); for scanner.Scan() { line := scanner.Text(); if strings.HasPrefix(line, "cpu ") { fields := strings.Fields(line); if len(fields) < 8 { return cpuStat{}, fmt.Errorf("invalid /proc/stat") }; var total uint64; vals := make([]uint64, 0, len(fields)-1); for _, f := range fields[1:] { v, _ := strconv.ParseUint(f, 10, 64); vals = append(vals, v); total += v }; idle := vals[3]; if len(vals) > 4 { idle += vals[4] }; return cpuStat{idle: idle, total: total}, nil } }; return cpuStat{}, fmt.Errorf("cpu line not found") }
func calculateCPU(a, b cpuStat) float64 { totald := float64(b.total - a.total); idled := float64(b.idle - a.idle); if totald <= 0 { return 0 }; return (1.0 - idled/totald) * 100 }
func readMemInfo() (uint64, uint64, error) { data, err := os.ReadFile("/proc/meminfo"); if err != nil { return 0, 0, err }; var total, avail uint64; scanner := bufio.NewScanner(bytes.NewReader(data)); for scanner.Scan() { line := scanner.Text(); if strings.HasPrefix(line, "MemTotal:") { fields := strings.Fields(line); total, _ = strconv.ParseUint(fields[1], 10, 64); total *= 1024 }; if strings.HasPrefix(line, "MemAvailable:") { fields := strings.Fields(line); avail, _ = strconv.ParseUint(fields[1], 10, 64); avail *= 1024 } }; if total == 0 { return 0, 0, fmt.Errorf("meminfo parse failed") }; return total, avail, nil }
func readDiskUsage(path string) (uint64, uint64, error) { var stat syscall.Statfs_t; if err := syscall.Statfs(path, &stat); err != nil { return 0, 0, err }; total := stat.Blocks * uint64(stat.Bsize); free := stat.Bavail * uint64(stat.Bsize); used := total - free; return total, used, nil }
func checkPort(addr string) bool { conn, err := net.DialTimeout("tcp", addr, 1200*time.Millisecond); if err != nil { return false }; _ = conn.Close(); return true }
func report(url string, payload *Payload) error { body, _ := json.Marshal(payload); req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body)); req.Header.Set("Content-Type", "application/json"); client := &http.Client{Timeout: 8 * time.Second}; resp, err := client.Do(req); if err != nil { return err }; defer resp.Body.Close(); if resp.StatusCode >= 300 { return fmt.Errorf("unexpected status %d", resp.StatusCode) }; return nil }
func readInstanceID(filePath string) string { data, err := os.ReadFile(filePath); if err != nil { return "" }; scanner := bufio.NewScanner(bytes.NewReader(data)); for scanner.Scan() { line := strings.TrimSpace(scanner.Text()); if strings.HasPrefix(line, "InstanceId:") { return strings.TrimSpace(strings.TrimPrefix(line, "InstanceId:")) } }; return "" }
func readVersionFile(filePath string) string { data, err := os.ReadFile(filePath); if err != nil { return "" }; return strings.TrimSpace(string(data)) }
func machineStableID(hostname string) string { candidates := []string{}; for _, p := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} { if b, err := os.ReadFile(p); err == nil { v := strings.TrimSpace(string(b)); if v != "" { candidates = append(candidates, v); break } } }; if b, err := os.ReadFile("/sys/class/dmi/id/product_uuid"); err == nil { v := strings.TrimSpace(string(b)); if v != "" { candidates = append(candidates, v) } }; candidates = append(candidates, hostname); return stableID(strings.Join(candidates, "|")) }
func stableID(input string) string { sum := sha1.Sum([]byte(input)); return hex.EncodeToString(sum[:12]) }
func publicIP() string { urls := []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://ipv4.icanhazip.com"}; client := &http.Client{Timeout: 4 * time.Second}; for _, url := range urls { req, _ := http.NewRequest(http.MethodGet, url, nil); resp, err := client.Do(req); if err != nil { continue }; data, _ := io.ReadAll(io.LimitReader(resp.Body, 128)); _ = resp.Body.Close(); ip := strings.TrimSpace(string(data)); parsed := net.ParseIP(ip); if parsed != nil && parsed.To4() != nil { return ip } }; return "" }
func firstIP() string { ifaces, err := net.Interfaces(); if err != nil { return "" }; for _, iface := range ifaces { if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 { continue }; addrs, _ := iface.Addrs(); for _, addr := range addrs { var ip net.IP; switch v := addr.(type) { case *net.IPNet: ip = v.IP; case *net.IPAddr: ip = v.IP }; if ip == nil || ip.IsLoopback() { continue }; ipv4 := ip.To4(); if ipv4 != nil { return ipv4.String() } } }; return "" }
func percent(used, total uint64) float64 { if total == 0 { return 0 }; return (float64(used) / float64(total)) * 100 }
func getEnv(key, fallbackVal string) string { val := strings.TrimSpace(os.Getenv(key)); if val == "" { return fallbackVal }; return val }
func getEnvInt(key string, fallbackVal int) int { raw := strings.TrimSpace(os.Getenv(key)); if raw == "" { return fallbackVal }; val, err := strconv.Atoi(raw); if err != nil { return fallbackVal }; return val }
func fallback(v, d string) string { if strings.TrimSpace(v) == "" { return d }; return v }
